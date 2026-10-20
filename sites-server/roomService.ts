import { SIMULATION_RULES } from "../src/game/constants";
import { cancelMovement } from "../src/game/movement/movement";
import { advanceMatch } from "../src/game/simulation/match";
import { deployAnchor } from "../src/game/simulation/tetherNetwork";
import { createInitialGameState } from "../src/game/state";
import {
  PLAYER_IDS,
  type GameInput,
  type GameState,
  type MatchFinishReason,
  type PlayerId,
  type PlayerLimit,
} from "../src/game/types";
import {
  parseClientMessage,
  type ClientMessage,
  type PublicRoomSummary,
  type RoomPlayerSummary,
  type RoomSnapshot,
  type RoomVisibility,
  type ServerMessage,
} from "../src/network/protocol";

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{5}$/;
const MAX_CAS_ATTEMPTS = 8;
const MAX_CREATE_ATTEMPTS = 8;
const MAX_ACTION_HISTORY = 256;
const MAX_PENDING_INPUTS = 64;
const MAX_REQUEST_KEYS_PER_PLAYER = 16;
const MAX_SYNC_COMMANDS = 64;
const MAX_PUBLIC_ROOM_RESULTS = 50;
const PRESENCE_LEASE_MS = 10_000;
const DISCONNECT_GRACE_MS = 30_000;
const ACTIVE_ROOM_TTL_MS = 20 * 60 * 1000;
const LOBBY_ROOM_TTL_MS = 15 * 60 * 1000;
const FINISHED_ROOM_TTL_MS = 10 * 60 * 1000;
const FIXED_STEP_MS = 1_000 / SIMULATION_RULES.ticksPerSecond;
const MAX_CATCH_UP_MS = FIXED_STEP_MS * SIMULATION_RULES.maximumCatchUpSteps;

export interface D1ResultLike<T = unknown> {
  results?: T[];
  success?: boolean;
  meta?: {
    changes?: number;
    [key: string]: unknown;
  };
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>>;
  run<T = Record<string, unknown>>(): Promise<D1ResultLike<T>>;
}

/** A deliberately small structural interface so the service is fakeable. */
export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch<T = Record<string, unknown>>(
    statements: D1PreparedStatementLike[],
  ): Promise<D1ResultLike<T>[]>;
}

export type CreateRoomMessage = Extract<ClientMessage, { type: "create_room" }>;
export type JoinRoomMessage = Extract<ClientMessage, { type: "join_room" }>;
export type RoomCommand = Extract<
  ClientMessage,
  {
    type:
      | "set_ready"
      | "movement_input"
      | "deploy_anchor"
      | "request_rematch"
      | "ping";
  }
>;

export interface SyncRoomBody {
  knownRoomRevision?: number;
  knownStateVersion?: number;
  sentAt?: number;
  commands?: RoomCommand[];
}

export interface RoomServiceResponse {
  messages: ServerMessage[];
  serverTime: number;
}

export interface PublicRoomDirectoryResponse {
  rooms: PublicRoomSummary[];
  serverTime: number;
}

export class RoomServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly recoverable: boolean,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = "RoomServiceError";
  }

  toErrorMessage(): Extract<ServerMessage, { type: "error" }> {
    return {
      type: "error",
      code: this.code,
      message: this.message,
      recoverable: this.recoverable,
    };
  }
}

interface PersistedPlayer {
  id: PlayerId;
  name: string;
  ready: boolean;
  connected: boolean;
  sessionToken: string;
  lastSeenAt: number;
  disconnectedAt: number | null;
  pendingInputs: GameInput[];
  lastInputSeq: number;
  processedActions: Array<[actionId: string, accepted: boolean]>;
  requestKeys: string[];
}

interface PersistedRoom {
  schemaVersion: 2;
  code: string;
  revision: number;
  stateVersion: number;
  visibility: RoomVisibility;
  phase: "lobby" | "playing" | "finished";
  playerLimit: PlayerLimit;
  players: PersistedPlayer[];
  gameState: GameState | null;
  winner: PlayerId | "draw" | null;
  finishReason: MatchFinishReason | "disconnect" | null;
  createdAt: number;
  lastSimulatedAt: number;
  lastActivityAt: number;
}

interface RoomRow {
  version: number;
  document: string;
  expires_at: number;
}

interface PublicRoomRow {
  code: string;
  host_name: string;
  player_count: number;
  player_limit: number;
  phase: string;
  updated_at: number;
}

interface MutationResult<T> {
  value: T;
  deleteRoom?: boolean;
}

interface MutationContext {
  now: number;
  version: number;
}

export async function createRoom(
  db: D1DatabaseLike,
  message: CreateRoomMessage,
): Promise<RoomServiceResponse> {
  validateCreateMessage(message);
  const now = Date.now();
  const visibility = message.visibility ?? "private";

  const existing = await findCreateRequest(db, message.requestId);
  if (existing) {
    return resumeCreatedRoom(db, existing, message);
  }

  // Keep abandoned room documents bounded without requiring an in-process
  // interval (Workers may be suspended immediately after a request).
  await deleteExpiredRooms(db, now);

  let lastInsertError: unknown;
  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
    const code = createRoomCode();
    const player = createPlayer("player", message.name, now, `create:${message.requestId}`);
    const room: PersistedRoom = {
      schemaVersion: 2,
      code,
      revision: 2,
      stateVersion: 0,
      visibility,
      phase: "lobby",
      playerLimit: message.playerLimit,
      players: [player],
      gameState: null,
      winner: null,
      finishReason: null,
      createdAt: now,
      lastSimulatedAt: now,
      lastActivityAt: now,
    };

    try {
      const batchResults = await db.batch([
        db.prepare(
          "INSERT INTO rooms (code, version, document, visibility, phase, player_count, player_limit, host_name, host_last_seen_at, created_at, updated_at, expires_at) VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        ).bind(
          code,
          serializeRoom(room),
          room.visibility,
          room.phase,
          room.players.length,
          room.playerLimit,
          roomHostName(room),
          roomHostLastSeenAt(room),
          room.createdAt,
          now,
          roomExpiry(room, now),
        ),
        db.prepare(
          "INSERT INTO create_requests (request_id, room_code, created_at) VALUES (?1, ?2, ?3)",
        ).bind(message.requestId, code, now),
      ]);
      if (batchResults.some((result) => result.success === false)) {
        throw new Error("D1 rejected the atomic room creation batch");
      }

      return response(now, [welcomeMessage(room, player, false)]);
    } catch (error) {
      lastInsertError = error;
      // A concurrent retry with this request ID may have won the transaction.
      const replay = await findCreateRequest(db, message.requestId);
      if (replay) return resumeCreatedRoom(db, replay, message);
      // Otherwise the five-character room code may have collided. Generate a
      // fresh code and retry the whole atomic batch.
    }
  }

  throw new RoomServiceError(
    "server_error",
    lastInsertError instanceof Error
      ? `The room could not be created: ${lastInsertError.message}`
      : "The room could not be created.",
    true,
    500,
  );
}

export async function listPublicRooms(
  db: D1DatabaseLike,
): Promise<PublicRoomDirectoryResponse> {
  const now = Date.now();
  const result = await db.prepare(
    "SELECT code, host_name, player_count, player_limit, phase, updated_at FROM rooms WHERE visibility = 'public' AND phase = 'lobby' AND player_count < player_limit AND expires_at > ?1 AND host_last_seen_at > ?2 ORDER BY updated_at DESC, code ASC LIMIT ?3",
  ).bind(
    now,
    now - PRESENCE_LEASE_MS,
    MAX_PUBLIC_ROOM_RESULTS,
  ).all<PublicRoomRow>();

  const rooms = (result.results ?? []).flatMap((row) => {
    if (!validPublicRoomRow(row)) return [];
    return [{
      code: row.code,
      hostName: row.host_name,
      playerCount: row.player_count,
      playerLimit: row.player_limit,
      updatedAt: row.updated_at,
    }];
  });

  return { rooms, serverTime: now };
}

export async function joinRoom(
  db: D1DatabaseLike,
  message: JoinRoomMessage,
): Promise<RoomServiceResponse> {
  validateJoinMessage(message);
  const code = normalizeRoomCode(message.code);

  return mutateRoom(db, code, (room, { now }) => {
    maintainRoom(room, now);
    const requestKey = `join:${code}:${message.requestId}`;

    const replayPlayer = room.players.find((player) =>
      player.requestKeys.includes(requestKey),
    );
    if (replayPlayer) {
      attachPlayer(room, replayPlayer, now);
      return {
        value: response(now, welcomeAndState(room, replayPlayer, true, now)),
      };
    }

    if (message.sessionToken) {
      const returningPlayer = room.players.find(
        (player) => player.sessionToken === message.sessionToken,
      );
      if (returningPlayer) {
        registerRequestKey(returningPlayer, requestKey);
        attachPlayer(room, returningPlayer, now);
        return {
          value: response(now, welcomeAndState(room, returningPlayer, true, now)),
        };
      }
    }

    if (room.phase !== "lobby" || room.players.length >= room.playerLimit) {
      throw new RoomServiceError(
        "room_full",
        "That room is already full or in progress.",
        false,
        409,
      );
    }

    const playerId = PLAYER_IDS.find(
      (candidate) => !room.players.some((player) => player.id === candidate),
    );
    if (!playerId) {
      throw new RoomServiceError(
        "room_full",
        "That room is already full.",
        false,
        409,
      );
    }

    const player = createPlayer(playerId, message.name, now, requestKey);
    room.players.push(player);
    room.revision += 1;
    room.lastActivityAt = now;
    return {
      value: response(now, welcomeAndState(room, player, false, now)),
    };
  });
}

export async function syncRoom(
  db: D1DatabaseLike,
  roomCode: string,
  sessionToken: string,
  body: SyncRoomBody,
): Promise<RoomServiceResponse> {
  const code = requireRoomCode(roomCode);
  if (!sessionToken || sessionToken.length > 128) {
    throw sessionExpired();
  }
  validateSyncBody(body);

  return mutateRoom(db, code, (room, { now }) => {
    maintainRoom(room, now);
    const player = room.players.find(
      (candidate) => candidate.sessionToken === sessionToken,
    );
    if (!player) throw sessionExpired();

    attachPlayer(room, player, now);
    room.lastActivityAt = now;

    const directMessages: ServerMessage[] = [];
    let hasFreshMovementInput = false;
    for (const rawCommand of body.commands ?? []) {
      const command = validateRoomCommand(rawCommand);
      hasFreshMovementInput =
        applyRoomCommand(room, player, command, now, directMessages) ||
        hasFreshMovementInput;
    }

    if (hasFreshMovementInput) {
      applyPendingRoomInputs(room, now);
    }

    if (typeof body.sentAt === "number" && Number.isFinite(body.sentAt)) {
      directMessages.push({
        type: "pong",
        sentAt: body.sentAt,
        serverTime: now,
      });
    }

    const knownRoomRevision = validKnownVersion(body.knownRoomRevision)
      ? body.knownRoomRevision
      : -1;
    const knownStateVersion = validKnownVersion(body.knownStateVersion)
      ? body.knownStateVersion
      : -1;

    if (room.revision > knownRoomRevision) {
      directMessages.push({ type: "room_state", room: roomSnapshot(room) });
    }
    if (room.gameState && room.stateVersion > knownStateVersion) {
      directMessages.push(gameStateMessage(room, now));
    }

    return { value: response(now, directMessages) };
  });
}

export async function leaveRoom(
  db: D1DatabaseLike,
  roomCode: string,
  sessionToken: string,
): Promise<RoomServiceResponse> {
  const code = requireRoomCode(roomCode);
  const now = Date.now();
  if (!sessionToken || sessionToken.length > 128) return response(now, []);

  try {
    return await mutateRoom(db, code, (room, context) => {
      maintainRoom(room, context.now);
      const player = room.players.find(
        (candidate) => candidate.sessionToken === sessionToken,
      );
      // Leaving is deliberately idempotent: a lost HTTP response can be
      // retried after the player or whole room has already been removed.
      if (!player) return { value: response(context.now, []) };

      removePlayer(room, player, context.now);
      return {
        value: response(context.now, []),
        deleteRoom: room.players.length === 0,
      };
    });
  } catch (error) {
    if (error instanceof RoomServiceError && error.code === "room_not_found") {
      return response(now, []);
    }
    throw error;
  }
}

async function resumeCreatedRoom(
  db: D1DatabaseLike,
  existing: { room: PersistedRoom; player: PersistedPlayer },
  message: CreateRoomMessage,
) {
  try {
    return await joinRoom(db, {
      type: "join_room",
      requestId: message.requestId,
      code: existing.room.code,
      name: existing.player.name,
      sessionToken: existing.player.sessionToken,
    });
  } catch (error) {
    if (!(error instanceof RoomServiceError) || error.code !== "room_not_found") {
      throw error;
    }
    // A stale idempotency record should not permanently prevent room creation.
    await db.prepare(
      "DELETE FROM create_requests WHERE request_id = ?1",
    ).bind(message.requestId).run();
    return createRoom(db, message);
  }
}

async function mutateRoom<T>(
  db: D1DatabaseLike,
  code: string,
  mutation: (room: PersistedRoom, context: MutationContext) => MutationResult<T>,
): Promise<T> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const row = await loadRoomRow(db, code);
    if (!row) throw roomNotFound();

    const loadedAt = Date.now();
    if (row.expires_at <= loadedAt) {
      const deleted = await db.prepare(
        "DELETE FROM rooms WHERE code = ?1 AND version = ?2 RETURNING code",
      ).bind(code, row.version).first<{ code: string }>();
      if (deleted) throw roomNotFound();
      continue;
    }

    const room = parseRoom(row.document, code);
    const now = Date.now();
    const result = mutation(room, { now, version: row.version });

    if (result.deleteRoom) {
      const deleted = await db.prepare(
        "DELETE FROM rooms WHERE code = ?1 AND version = ?2 RETURNING code",
      ).bind(code, row.version).first<{ code: string }>();
      if (deleted) return result.value;
      continue;
    }

    const updated = await db.prepare(
      "UPDATE rooms SET document = ?1, visibility = ?2, phase = ?3, player_count = ?4, player_limit = ?5, host_name = ?6, host_last_seen_at = ?7, created_at = ?8, version = version + 1, updated_at = ?9, expires_at = ?10 WHERE code = ?11 AND version = ?12 RETURNING version",
    ).bind(
      serializeRoom(room),
      room.visibility,
      room.phase,
      room.players.length,
      room.playerLimit,
      roomHostName(room),
      roomHostLastSeenAt(room),
      room.createdAt,
      now,
      roomExpiry(room, now),
      code,
      row.version,
    ).first<{ version: number }>();
    if (updated) return result.value;
  }

  throw new RoomServiceError(
    "server_busy",
    "The room is busy synchronizing. Try again.",
    true,
    503,
  );
}

async function loadRoomRow(db: D1DatabaseLike, code: string) {
  return db.prepare(
    "SELECT version, document, expires_at FROM rooms WHERE code = ?1",
  ).bind(code).first<RoomRow>();
}

async function findCreateRequest(
  db: D1DatabaseLike,
  requestId: string,
): Promise<{ room: PersistedRoom; player: PersistedPlayer } | null> {
  const row = await db.prepare(
    "SELECT rooms.version AS version, rooms.document AS document, rooms.expires_at AS expires_at FROM create_requests JOIN rooms ON rooms.code = create_requests.room_code WHERE create_requests.request_id = ?1",
  ).bind(requestId).first<RoomRow>();
  if (!row) return null;

  const room = parseRoom(row.document);
  if (row.expires_at <= Date.now()) {
    await db.prepare(
      "DELETE FROM rooms WHERE code = ?1 AND version = ?2",
    ).bind(room.code, row.version).run();
    return null;
  }
  const requestKey = `create:${requestId}`;
  const player = room.players.find((candidate) =>
    candidate.requestKeys.includes(requestKey),
  );
  if (player) return { room, player };

  // The original creator may have left while other players kept the room
  // alive. That old request no longer represents a resumable identity.
  await db.prepare(
    "DELETE FROM create_requests WHERE request_id = ?1",
  ).bind(requestId).run();
  return null;
}

async function deleteExpiredRooms(db: D1DatabaseLike, now: number) {
  await db.prepare(
    "DELETE FROM rooms WHERE expires_at <= ?1",
  ).bind(now).run();
}

function applyRoomCommand(
  room: PersistedRoom,
  player: PersistedPlayer,
  command: RoomCommand,
  now: number,
  directMessages: ServerMessage[],
) {
  if (command.type === "ping") {
    directMessages.push({
      type: "pong",
      sentAt: command.sentAt,
      serverTime: now,
    });
    return false;
  }

  if (command.type === "set_ready") {
    if (room.phase !== "lobby") return false;
    if (player.ready !== command.ready) {
      player.ready = command.ready;
      room.revision += 1;
    }
    if (canStartMatch(room)) startMatch(room, now);
    return false;
  }

  if (command.type === "request_rematch") {
    if (room.phase !== "finished" || !player.connected) return false;
    if (!player.ready) {
      player.ready = true;
      room.revision += 1;
    }
    if (canStartMatch(room)) startMatch(room, now);
    return false;
  }

  if (room.phase !== "playing" || !room.gameState) return false;

  if (command.type === "movement_input") {
    if (
      command.seq <= player.lastInputSeq ||
      player.pendingInputs.length >= MAX_PENDING_INPUTS
    ) {
      return false;
    }
    player.lastInputSeq = command.seq;
    player.pendingInputs.push({
      sequence: command.seq,
      command: command.command,
    });
    return true;
  }

  const priorResult = player.processedActions.find(
    ([actionId]) => actionId === command.actionId,
  );
  if (priorResult) {
    directMessages.push({
      type: "action_ack",
      actionId: command.actionId,
      accepted: priorResult[1],
    });
    return false;
  }

  const nextState = deployAnchor(room.gameState, player.id);
  const accepted = nextState !== room.gameState;
  player.processedActions.push([command.actionId, accepted]);
  if (player.processedActions.length > MAX_ACTION_HISTORY) {
    player.processedActions.splice(
      0,
      player.processedActions.length - MAX_ACTION_HISTORY,
    );
  }
  directMessages.push({
    type: "action_ack",
    actionId: command.actionId,
    accepted,
  });
  if (accepted) {
    room.gameState = nextState;
    room.stateVersion += 1;
  }
  return false;
}

function applyPendingRoomInputs(room: PersistedRoom, now: number) {
  if (!room.gameState || room.phase !== "playing" || !matchReady(room)) return;

  const inputs = drainPendingInputs(room);
  if (!inputs) return;

  // The elapsed wall time was advanced before commands were accepted, so apply
  // their state transition at zero elapsed time. This lets the response carry
  // the new authoritative movement mode without retroactively moving a player
  // through time that passed before the server received the command.
  room.gameState = advanceMatch(room.gameState, inputs, 0);
  room.stateVersion += 1;
  if (room.gameState.matchPhase === "finished") {
    finishMatch(
      room,
      room.gameState.matchOutcome?.reason ?? "regulation_score",
      room.gameState.matchOutcome?.winner,
      now,
    );
  }
}

function maintainRoom(room: PersistedRoom, now: number) {
  const wasMatchReady = matchReady(room);
  if (wasMatchReady) {
    const activeUntil = Math.min(
      ...room.players.map((player) => player.lastSeenAt + PRESENCE_LEASE_MS),
    );
    advanceRoomTo(room, Math.min(now, activeUntil));
  }

  const expiredPlayers = room.players.filter(
    (player) => player.connected && player.lastSeenAt + PRESENCE_LEASE_MS <= now,
  );
  if (expiredPlayers.length > 0) {
    for (const player of expiredPlayers) {
      player.connected = false;
      player.disconnectedAt = player.lastSeenAt + PRESENCE_LEASE_MS;
      player.pendingInputs = [];
      if (room.gameState) {
        room.gameState = cancelPlayerMovement(room.gameState, player.id);
      }
    }
    room.revision += 1;
    if (room.gameState) room.stateVersion += 1;
  }

  if (!matchReady(room)) {
    // Wall time while a player is absent is intentionally discarded. A future
    // reconnect resumes from its own request time instead of fast-forwarding.
    room.lastSimulatedAt = now;
  } else if (!wasMatchReady) {
    room.lastSimulatedAt = now;
  }

  for (const player of [...room.players]) {
    if (
      !player.connected &&
      player.disconnectedAt !== null &&
      now - player.disconnectedAt > DISCONNECT_GRACE_MS
    ) {
      removePlayer(room, player, now);
    }
  }
}

function advanceRoomTo(room: PersistedRoom, targetTime: number) {
  if (!room.gameState || room.phase !== "playing" || !matchReady(room)) {
    room.lastSimulatedAt = targetTime;
    return;
  }

  const elapsedMs = Math.max(0, targetTime - room.lastSimulatedAt);
  if (elapsedMs <= 0) return;

  // Mirror the WebSocket server's maximumCatchUpSteps behavior. Long Worker
  // suspension gaps do not trigger an unbounded physics loop.
  const deltaMs = Math.min(elapsedMs, MAX_CATCH_UP_MS);
  const previousRemainder = room.gameState.simulationRemainderMs;
  const fullSteps = Math.floor(
    (previousRemainder + deltaMs + 0.000001) / FIXED_STEP_MS,
  );
  const inputs = drainPendingInputs(room) ?? {};

  room.gameState = advanceMatch(room.gameState, inputs, deltaMs / 1_000);
  // Only move the authoritative cursor through time that was actually
  // simulated. Any excess remains as backlog for a later request rather than
  // making the match clock permanently run slower than wall time.
  room.lastSimulatedAt += deltaMs;
  room.stateVersion += fullSteps;
  if (room.gameState.matchPhase === "finished") {
    finishMatch(
      room,
      room.gameState.matchOutcome?.reason ?? "regulation_score",
      room.gameState.matchOutcome?.winner,
      room.lastSimulatedAt,
    );
  }
}

function drainPendingInputs(
  room: PersistedRoom,
): Partial<Record<PlayerId, GameInput[]>> | null {
  const inputs: Partial<Record<PlayerId, GameInput[]>> = {};
  let hasInputs = false;
  for (const player of room.players) {
    if (player.pendingInputs.length === 0) continue;
    inputs[player.id] = player.pendingInputs.splice(0);
    hasInputs = true;
  }
  return hasInputs ? inputs : null;
}

function startMatch(room: PersistedRoom, now: number) {
  room.phase = "playing";
  room.gameState = createInitialGameState(
    `${room.code}:${room.revision}`,
    room.playerLimit,
  );
  room.winner = null;
  room.finishReason = null;
  room.lastSimulatedAt = now;
  room.lastActivityAt = now;
  room.stateVersion += 1;
  room.revision += 1;
  for (const player of room.players) {
    player.ready = false;
    player.pendingInputs = [];
  }
}

function finishMatch(
  room: PersistedRoom,
  reason: MatchFinishReason | "disconnect",
  winner: PlayerId | "draw" | undefined,
  now: number,
) {
  if (room.phase === "finished") return;
  room.phase = "finished";
  room.finishReason = reason;
  room.winner = winner ?? room.gameState?.matchOutcome?.winner ?? "draw";
  room.lastActivityAt = now;
  room.revision += 1;
  for (const player of room.players) {
    player.ready = false;
    player.pendingInputs = [];
  }
  if (room.gameState) room.gameState = cancelAllMovement(room.gameState);
}

function removePlayer(room: PersistedRoom, player: PersistedPlayer, now: number) {
  const wasPlaying = room.phase === "playing";
  room.players = room.players.filter((candidate) => candidate !== player);
  room.lastActivityAt = now;
  room.revision += 1;
  if (wasPlaying) {
    finishMatch(
      room,
      "disconnect",
      disconnectWinner(room, room.players),
      now,
    );
  }
}

function attachPlayer(room: PersistedRoom, player: PersistedPlayer, now: number) {
  const wasConnected = player.connected;
  player.connected = true;
  player.disconnectedAt = null;
  player.lastSeenAt = now;
  room.lastActivityAt = now;
  if (!wasConnected) room.revision += 1;

  if (matchReady(room) && !wasConnected) {
    room.lastSimulatedAt = now;
  }
  if (room.phase === "finished" && canStartMatch(room)) {
    startMatch(room, now);
  }
}

function createPlayer(
  id: PlayerId,
  name: string,
  now: number,
  requestKey: string,
): PersistedPlayer {
  return {
    id,
    name: name.trim().slice(0, 20),
    ready: false,
    connected: true,
    sessionToken: createSessionToken(),
    lastSeenAt: now,
    disconnectedAt: null,
    pendingInputs: [],
    lastInputSeq: 0,
    processedActions: [],
    requestKeys: [requestKey],
  };
}

function registerRequestKey(player: PersistedPlayer, requestKey: string) {
  if (player.requestKeys.includes(requestKey)) return;
  player.requestKeys.push(requestKey);
  if (player.requestKeys.length > MAX_REQUEST_KEYS_PER_PLAYER) {
    player.requestKeys.splice(
      0,
      player.requestKeys.length - MAX_REQUEST_KEYS_PER_PLAYER,
    );
  }
}

function matchReady(room: PersistedRoom) {
  return (
    room.players.length === room.playerLimit &&
    room.players.every((player) => player.connected)
  );
}

function canStartMatch(room: PersistedRoom) {
  return (
    room.players.length === room.playerLimit &&
    room.players.every((player) => player.connected && player.ready)
  );
}

function roomSnapshot(room: PersistedRoom): RoomSnapshot {
  const players: RoomPlayerSummary[] = room.players.map((player) => ({
    id: player.id,
    name: player.name,
    ready: player.ready,
    connected: player.connected,
  }));
  return {
    code: room.code,
    revision: room.revision,
    playerLimit: room.playerLimit,
    visibility: room.visibility,
    phase: room.phase,
    players,
    winner: room.winner,
    finishReason: room.finishReason,
  };
}

function welcomeMessage(
  room: PersistedRoom,
  player: PersistedPlayer,
  reconnected: boolean,
): Extract<ServerMessage, { type: "welcome" }> {
  return {
    type: "welcome",
    playerId: player.id,
    sessionToken: player.sessionToken,
    room: roomSnapshot(room),
    reconnected,
  };
}

function welcomeAndState(
  room: PersistedRoom,
  player: PersistedPlayer,
  reconnected: boolean,
  serverTime: number,
): ServerMessage[] {
  const messages: ServerMessage[] = [
    welcomeMessage(room, player, reconnected),
  ];
  if (room.gameState) messages.push(gameStateMessage(room, serverTime));
  return messages;
}

function gameStateMessage(
  room: PersistedRoom,
  serverTime: number,
): Extract<ServerMessage, { type: "game_state" }> {
  if (!room.gameState) {
    throw new Error("Cannot create a game-state message without game state");
  }
  const lastProcessedInput: Partial<Record<PlayerId, number>> = {};
  for (const player of room.players) {
    lastProcessedInput[player.id] = player.lastInputSeq;
  }
  return {
    type: "game_state",
    state: room.gameState,
    stateVersion: room.stateVersion,
    lastProcessedInput,
    serverTime,
  };
}

function cancelPlayerMovement(state: GameState, playerId: PlayerId): GameState {
  const player = state.players[playerId];
  const pendingInputs = { ...state.pendingInputs };
  delete pendingInputs[playerId];
  return {
    ...state,
    pendingInputs,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        astronaut: {
          ...player.astronaut,
          movement: cancelMovement(player.astronaut.movement),
        },
      },
    },
  };
}

function cancelAllMovement(state: GameState): GameState {
  return state.activePlayerIds.reduce(
    (nextState, playerId) => cancelPlayerMovement(nextState, playerId),
    state,
  );
}

function disconnectWinner(
  room: PersistedRoom,
  remaining: readonly PersistedPlayer[],
): PlayerId | "draw" {
  if (remaining.length === 0) return "draw";
  if (remaining.length === 1) return remaining[0].id;
  if (!room.gameState) return "draw";

  const bestScore = Math.max(
    ...remaining.map((player) => room.gameState!.scores[player.id]),
  );
  const leaders = remaining.filter(
    (player) => Math.abs(room.gameState!.scores[player.id] - bestScore) <= 1e-9,
  );
  return leaders.length === 1 ? leaders[0].id : "draw";
}

function validateCreateMessage(message: CreateRoomMessage) {
  const parsed = parseClientMessage(JSON.stringify(message));
  if (parsed?.type !== "create_room") throw invalidMessage();
}

function validateJoinMessage(message: JoinRoomMessage) {
  const parsed = parseClientMessage(JSON.stringify(message));
  if (parsed?.type !== "join_room") throw invalidMessage();
  requireRoomCode(message.code);
}

function validateSyncBody(body: SyncRoomBody) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw invalidMessage();
  }
  if (
    body.commands !== undefined &&
    (!Array.isArray(body.commands) || body.commands.length > MAX_SYNC_COMMANDS)
  ) {
    throw invalidMessage();
  }
  if (
    body.sentAt !== undefined &&
    (typeof body.sentAt !== "number" || !Number.isFinite(body.sentAt))
  ) {
    throw invalidMessage();
  }
}

function validateRoomCommand(value: unknown): RoomCommand {
  const parsed = parseClientMessage(JSON.stringify(value));
  if (
    !parsed ||
    parsed.type === "create_room" ||
    parsed.type === "join_room" ||
    parsed.type === "leave_room"
  ) {
    throw invalidMessage();
  }
  return parsed;
}

function requireRoomCode(value: string) {
  const code = normalizeRoomCode(value);
  if (!ROOM_CODE_PATTERN.test(code)) {
    throw new RoomServiceError(
      "room_not_found",
      "That room no longer exists.",
      false,
      404,
    );
  }
  return code;
}

function normalizeRoomCode(value: string) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function validKnownVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function roomExpiry(room: PersistedRoom, now: number) {
  const ttl = room.phase === "playing"
    ? ACTIVE_ROOM_TTL_MS
    : room.phase === "lobby"
      ? LOBBY_ROOM_TTL_MS
      : FINISHED_ROOM_TTL_MS;
  return now + ttl;
}

function serializeRoom(room: PersistedRoom) {
  return JSON.stringify(room);
}

function parseRoom(raw: string, expectedCode?: string): PersistedRoom {
  try {
    const parsed = JSON.parse(raw) as Partial<Omit<PersistedRoom, "schemaVersion">> & {
      schemaVersion?: number;
    };
    if (
      (parsed?.schemaVersion !== 1 && parsed?.schemaVersion !== 2) ||
      typeof parsed.code !== "string" ||
      !Array.isArray(parsed.players) ||
      (expectedCode && parsed.code !== expectedCode)
    ) {
      throw new Error("Unsupported room document");
    }
    const room = parsed as PersistedRoom;
    // Rooms created before visibility was introduced must remain private.
    room.schemaVersion = 2;
    room.visibility = room.visibility === "public" ? "public" : "private";
    room.createdAt = Number.isFinite(room.createdAt)
      ? room.createdAt
      : room.lastActivityAt;
    return room;
  } catch {
    throw new RoomServiceError(
      "server_error",
      "The room data could not be read.",
      true,
      500,
    );
  }
}

function roomHostName(room: PersistedRoom) {
  return room.players.find((player) => player.id === "player")?.name ??
    room.players[0]?.name ??
    "Unknown host";
}

function roomHostLastSeenAt(room: PersistedRoom) {
  const host = room.players.find((player) => player.id === "player") ??
    room.players[0];
  return host?.lastSeenAt ?? 0;
}

function validPublicRoomRow(row: PublicRoomRow): row is PublicRoomRow & {
  player_limit: PlayerLimit;
  phase: "lobby";
} {
  return (
    typeof row.code === "string" &&
    ROOM_CODE_PATTERN.test(row.code) &&
    typeof row.host_name === "string" &&
    row.host_name.length > 0 &&
    Number.isSafeInteger(row.player_count) &&
    row.player_count >= 1 &&
    (row.player_limit === 2 || row.player_limit === 3 || row.player_limit === 4) &&
    row.player_count < row.player_limit &&
    row.phase === "lobby" &&
    Number.isSafeInteger(row.updated_at) &&
    row.updated_at >= 0
  );
}

function createRoomCode() {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return Array.from(
    bytes,
    (byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length],
  ).join("");
}

function createSessionToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function response(
  serverTime: number,
  messages: ServerMessage[],
): RoomServiceResponse {
  return { messages, serverTime };
}

function roomNotFound() {
  return new RoomServiceError(
    "room_not_found",
    "That room no longer exists.",
    false,
    404,
  );
}

function sessionExpired() {
  return new RoomServiceError(
    "session_expired",
    "Your reserved room slot has expired.",
    false,
    401,
  );
}

function invalidMessage() {
  return new RoomServiceError(
    "invalid_message",
    "The server could not read that request.",
    true,
    400,
  );
}
