import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { advanceMatch, deployAnchor, getTerritoryScore } from "../src/game/simulation";
import { createInitialGameState } from "../src/game/state";
import type { GameInput, GameState, PlayerId, Vec2 } from "../src/game/types";
import {
  parseClientMessage,
  type ClientMessage,
  type RoomPlayerSummary,
  type RoomSnapshot,
  type ServerMessage,
} from "../src/network/protocol";

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PLAYER_IDS: PlayerId[] = ["player", "rival"];
const MAX_ACTION_HISTORY = 256;
const MAX_REQUEST_KEYS_PER_PLAYER = 16;
const MAX_MESSAGES_PER_SECOND = 120;
const SOFT_BUFFER_LIMIT = 64 * 1024;
const HARD_BUFFER_LIMIT = 512 * 1024;
const LOBBY_IDLE_TTL_MS = 15 * 60 * 1000;
const FINISHED_IDLE_TTL_MS = 10 * 60 * 1000;

interface ConnectedPlayer {
  id: PlayerId;
  name: string;
  ready: boolean;
  connected: boolean;
  sessionToken: string;
  socket: WebSocket | null;
  disconnectedAt: number | null;
  input: GameInput;
  lastInputSeq: number;
  processedActions: Map<string, boolean>;
  requestKeys: Set<string>;
}

interface MatchRoom {
  code: string;
  revision: number;
  stateVersion: number;
  phase: "lobby" | "playing" | "finished";
  playerLimit: number;
  players: Map<PlayerId, ConnectedPlayer>;
  gameState: GameState | null;
  winner: PlayerId | "draw" | null;
  finishReason: "time" | "disconnect" | null;
  lastTickAt: number;
  lastActivityAt: number;
}

interface SocketIdentity {
  roomCode: string;
  playerId: PlayerId;
}

interface SocketTraffic {
  windowStartedAt: number;
  messageCount: number;
}

export interface RoomServerOptions {
  port?: number;
  host?: string;
  tickRate?: number;
  disconnectGraceMs?: number;
}

export class RoomServer {
  readonly webSocketServer: WebSocketServer;
  readonly rooms = new Map<string, MatchRoom>();

  private readonly socketIdentity = new WeakMap<WebSocket, SocketIdentity>();
  private readonly socketAlive = new WeakMap<WebSocket, boolean>();
  private readonly socketTraffic = new WeakMap<WebSocket, SocketTraffic>();
  private readonly requestIdentity = new Map<string, SocketIdentity>();
  private readonly tickRate: number;
  private readonly disconnectGraceMs: number;
  private readonly loop: NodeJS.Timeout;
  private readonly heartbeat: NodeJS.Timeout;

  constructor(options: RoomServerOptions = {}) {
    this.tickRate = options.tickRate ?? 20;
    this.disconnectGraceMs = options.disconnectGraceMs ?? 30_000;
    this.webSocketServer = new WebSocketServer({
      port: options.port ?? 8788,
      host: options.host ?? "0.0.0.0",
      maxPayload: 16 * 1024,
    });

    this.webSocketServer.on("connection", (socket) => this.handleConnection(socket));
    this.loop = setInterval(() => this.tick(), 1000 / this.tickRate);
    this.heartbeat = setInterval(() => this.runHeartbeat(), 10_000);
  }

  get port() {
    const address = this.webSocketServer.address();
    return typeof address === "object" && address ? (address as AddressInfo).port : null;
  }

  async close() {
    clearInterval(this.loop);
    clearInterval(this.heartbeat);
    for (const socket of this.webSocketServer.clients) socket.terminate();
    await new Promise<void>((resolve, reject) => {
      this.webSocketServer.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private handleConnection(socket: WebSocket) {
    this.socketAlive.set(socket, true);
    this.socketTraffic.set(socket, { windowStartedAt: Date.now(), messageCount: 0 });
    socket.on("pong", () => this.socketAlive.set(socket, true));
    socket.on("message", (data) => {
      try {
        this.handleMessage(socket, data);
      } catch {
        this.sendError(socket, "server_error", "The room server rejected that request.", true);
      }
    });
    socket.on("close", () => this.handleDisconnect(socket));
    socket.on("error", () => {
      // The close handler owns room cleanup and reconnection state.
    });
  }

  private handleMessage(socket: WebSocket, data: RawData) {
    if (!this.consumeMessageAllowance(socket)) {
      socket.close(1008, "Message rate limit exceeded");
      return;
    }

    const message = parseClientMessage(data.toString());
    if (!message) {
      this.sendError(socket, "invalid_message", "The server could not read that message.", true);
      return;
    }

    if (message.type === "ping") {
      this.send(socket, { type: "pong", sentAt: message.sentAt, serverTime: Date.now() });
      return;
    }

    if (
      (message.type === "create_room" || message.type === "join_room") &&
      this.socketIdentity.has(socket)
    ) {
      this.sendError(socket, "already_joined", "This connection is already attached to a room.", true);
      return;
    }

    if (message.type === "create_room") {
      this.createRoom(socket, message);
      return;
    }
    if (message.type === "join_room") {
      this.joinRoom(socket, message);
      return;
    }
    const identity = this.socketIdentity.get(socket);
    if (!identity) {
      this.sendError(socket, "not_joined", "Join a room before sending game actions.", true);
      return;
    }
    const room = this.rooms.get(identity.roomCode);
    const player = room?.players.get(identity.playerId);
    if (!room || !player || player.socket !== socket) return;
    room.lastActivityAt = Date.now();

    this.handleRoomMessage(room, player, message);
  }

  private createRoom(socket: WebSocket, message: Extract<ClientMessage, { type: "create_room" }>) {
    if (!this.validName(message.name)) {
      this.sendError(socket, "invalid_name", "Names must contain 1–20 visible characters.", true);
      return;
    }

    const requestKey = `create:${message.requestId}`;
    if (this.resumeRequest(requestKey, socket)) return;

    const code = this.createUniqueRoomCode();
    const now = Date.now();
    const room: MatchRoom = {
      code,
      revision: 1,
      stateVersion: 0,
      phase: "lobby",
      playerLimit: 2,
      players: new Map(),
      gameState: null,
      winner: null,
      finishReason: null,
      lastTickAt: now,
      lastActivityAt: now,
    };
    this.rooms.set(code, room);
    this.addNewPlayer(room, socket, "player", message.name, requestKey);
  }

  private joinRoom(socket: WebSocket, message: Extract<ClientMessage, { type: "join_room" }>) {
    const code = message.code.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) {
      this.sendError(socket, "room_not_found", "That room no longer exists.", false);
      return;
    }

    const requestKey = `join:${code}:${message.requestId}`;
    if (this.resumeRequest(requestKey, socket)) return;

    if (message.sessionToken) {
      const returningPlayer = [...room.players.values()].find(
        (player) => player.sessionToken === message.sessionToken,
      );
      if (returningPlayer) {
        this.registerRequest(returningPlayer, room, requestKey);
        this.attachPlayer(room, returningPlayer, socket, true);
        return;
      }
    }

    if (!this.validName(message.name)) {
      this.sendError(socket, "invalid_name", "Names must contain 1–20 visible characters.", true);
      return;
    }
    if (room.phase !== "lobby" || room.players.size >= room.playerLimit) {
      this.sendError(socket, "room_full", "That room is already full or in progress.", false);
      return;
    }

    const playerId = PLAYER_IDS.find((id) => !room.players.has(id));
    if (!playerId) {
      this.sendError(socket, "room_full", "That room is already full.", false);
      return;
    }
    this.addNewPlayer(room, socket, playerId, message.name, requestKey);
  }

  private addNewPlayer(
    room: MatchRoom,
    socket: WebSocket,
    id: PlayerId,
    name: string,
    requestKey: string,
  ) {
    const player: ConnectedPlayer = {
      id,
      name: name.trim().slice(0, 20),
      ready: false,
      connected: true,
      sessionToken: randomBytes(24).toString("base64url"),
      socket,
      disconnectedAt: null,
      input: { moveTarget: null },
      lastInputSeq: 0,
      processedActions: new Map(),
      requestKeys: new Set(),
    };
    room.players.set(id, player);
    this.registerRequest(player, room, requestKey);
    this.attachPlayer(room, player, socket, false);
  }

  private registerRequest(player: ConnectedPlayer, room: MatchRoom, requestKey: string) {
    if (player.requestKeys.size >= MAX_REQUEST_KEYS_PER_PLAYER) {
      const oldestKey = player.requestKeys.values().next().value;
      if (oldestKey) {
        player.requestKeys.delete(oldestKey);
        this.requestIdentity.delete(oldestKey);
      }
    }
    player.requestKeys.add(requestKey);
    this.requestIdentity.set(requestKey, { roomCode: room.code, playerId: player.id });
  }

  private resumeRequest(requestKey: string, socket: WebSocket) {
    const identity = this.requestIdentity.get(requestKey);
    if (!identity) return false;
    const room = this.rooms.get(identity.roomCode);
    const player = room?.players.get(identity.playerId);
    if (!room || !player) {
      this.requestIdentity.delete(requestKey);
      return false;
    }
    this.attachPlayer(room, player, socket, true);
    return true;
  }

  private attachPlayer(
    room: MatchRoom,
    player: ConnectedPlayer,
    socket: WebSocket,
    reconnected: boolean,
  ) {
    if (player.socket && player.socket !== socket && player.socket.readyState === WebSocket.OPEN) {
      player.socket.close(4001, "Session resumed in another connection");
    }
    player.socket = socket;
    player.connected = true;
    player.disconnectedAt = null;
    room.lastActivityAt = Date.now();
    room.revision += 1;
    this.socketIdentity.set(socket, { roomCode: room.code, playerId: player.id });
    this.send(socket, {
      type: "welcome",
      playerId: player.id,
      sessionToken: player.sessionToken,
      room: this.roomSnapshot(room),
      reconnected,
    });
    if (room.gameState) this.sendGameState(room, socket);
    this.broadcastRoom(room);
  }

  private handleRoomMessage(room: MatchRoom, player: ConnectedPlayer, message: ClientMessage) {
    if (message.type === "leave_room") {
      this.removePlayer(room, player, true);
      return;
    }

    if (message.type === "set_ready") {
      if (room.phase !== "lobby") return;
      player.ready = Boolean(message.ready);
      room.revision += 1;
      this.broadcastRoom(room);
      if (
        room.players.size === room.playerLimit &&
        [...room.players.values()].every((candidate) => candidate.ready && candidate.connected)
      ) {
        this.startMatch(room);
      }
      return;
    }

    if (message.type === "request_rematch") {
      if (room.phase !== "finished" || !player.connected) return;
      player.ready = true;
      room.revision += 1;
      room.lastActivityAt = Date.now();
      this.broadcastRoom(room);
      if (
        room.players.size === room.playerLimit &&
        [...room.players.values()].every((candidate) => candidate.ready && candidate.connected)
      ) {
        this.startMatch(room);
      }
      return;
    }

    if (room.phase !== "playing" || !room.gameState) return;

    if (message.type === "move_target") {
      if (message.seq <= player.lastInputSeq || !this.validTarget(message.target)) return;
      player.lastInputSeq = message.seq;
      player.input = { moveTarget: message.target };
      return;
    }

    if (message.type === "deploy_anchor") {
      const priorResult = player.processedActions.get(message.actionId);
      if (priorResult !== undefined) {
        this.send(player.socket, {
          type: "action_ack",
          actionId: message.actionId,
          accepted: priorResult,
        });
        return;
      }

      const nextState = deployAnchor(room.gameState, player.id);
      const accepted = nextState !== room.gameState;
      player.processedActions.set(message.actionId, accepted);
      if (player.processedActions.size > MAX_ACTION_HISTORY) {
        const oldestAction = player.processedActions.keys().next().value;
        if (oldestAction) player.processedActions.delete(oldestAction);
      }
      this.send(player.socket, { type: "action_ack", actionId: message.actionId, accepted });
      if (accepted) {
        room.gameState = nextState;
        room.stateVersion += 1;
        this.broadcastGameState(room);
      }
    }
  }

  private startMatch(room: MatchRoom) {
    room.phase = "playing";
    room.gameState = createInitialGameState();
    room.winner = null;
    room.finishReason = null;
    room.lastTickAt = Date.now();
    room.lastActivityAt = Date.now();
    room.stateVersion += 1;
    room.revision += 1;
    for (const player of room.players.values()) {
      player.ready = false;
      player.input = { moveTarget: null };
    }
    this.broadcastRoom(room);
    this.broadcastGameState(room);
  }

  private finishMatch(
    room: MatchRoom,
    reason: "time" | "disconnect",
    winner?: PlayerId | "draw",
  ) {
    if (room.phase === "finished") return;
    room.phase = "finished";
    room.finishReason = reason;
    room.winner = winner ?? this.scoreWinner(room);
    room.lastActivityAt = Date.now();
    room.revision += 1;
    for (const player of room.players.values()) {
      player.ready = false;
      player.input = { moveTarget: null };
    }
    this.broadcastRoom(room);
  }

  private scoreWinner(room: MatchRoom): PlayerId | "draw" {
    if (!room.gameState) return "draw";
    const playerScore = getTerritoryScore(room.gameState, "player");
    const rivalScore = getTerritoryScore(room.gameState, "rival");
    if (playerScore === rivalScore) return "draw";
    return playerScore > rivalScore ? "player" : "rival";
  }

  private handleDisconnect(socket: WebSocket) {
    const identity = this.socketIdentity.get(socket);
    if (!identity) return;
    const room = this.rooms.get(identity.roomCode);
    const player = room?.players.get(identity.playerId);
    if (!room || !player || player.socket !== socket) return;

    player.socket = null;
    player.connected = false;
    player.disconnectedAt = Date.now();
    player.input = { moveTarget: null };
    room.lastActivityAt = Date.now();
    room.revision += 1;
    this.broadcastRoom(room);
  }

  private tick() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      this.cleanupRoom(room, now);
      if (!this.rooms.has(room.code)) continue;
      if (room.phase !== "playing" || !room.gameState) continue;

      const matchReady =
        room.players.size === room.playerLimit &&
        [...room.players.values()].every((player) => player.connected);
      if (!matchReady) {
        // Keep the match clock, oxygen, and resources frozen during the reconnect grace period.
        room.lastTickAt = now;
        continue;
      }

      const elapsedSeconds = Math.min((now - room.lastTickAt) / 1000, 0.1);
      room.lastTickAt = now;
      const inputs: Partial<Record<PlayerId, GameInput>> = {};
      for (const player of room.players.values()) {
        if (player.connected) inputs[player.id] = player.input;
      }
      room.gameState = advanceMatch(room.gameState, inputs, elapsedSeconds);
      room.stateVersion += 1;
      if (room.gameState.remainingMs <= 0) {
        this.finishMatch(room, "time");
      }
      this.broadcastGameState(room);
    }
  }

  private cleanupRoom(room: MatchRoom, now: number) {
    for (const player of [...room.players.values()]) {
      if (
        !player.connected &&
        player.disconnectedAt !== null &&
        now - player.disconnectedAt > this.disconnectGraceMs
      ) {
        this.removePlayer(room, player, true);
      }
    }
    if (!this.rooms.has(room.code)) return;
    const idleLimit = room.phase === "lobby" ? LOBBY_IDLE_TTL_MS : FINISHED_IDLE_TTL_MS;
    if (room.phase !== "playing" && now - room.lastActivityAt > idleLimit) {
      for (const player of room.players.values()) {
        this.sendError(player.socket, "room_expired", "This inactive room has expired.", false);
        player.socket?.close(4002, "Room expired");
      }
      this.deleteRoom(room);
    }
  }

  private removePlayer(room: MatchRoom, player: ConnectedPlayer, broadcast: boolean) {
    const wasPlaying = room.phase === "playing";
    room.players.delete(player.id);
    if (player.socket) this.socketIdentity.delete(player.socket);
    for (const requestKey of player.requestKeys) this.requestIdentity.delete(requestKey);
    player.socket = null;
    room.lastActivityAt = Date.now();
    room.revision += 1;

    if (wasPlaying) {
      const remaining = [...room.players.values()];
      this.finishMatch(room, "disconnect", remaining.length === 1 ? remaining[0].id : "draw");
    } else if (broadcast) {
      this.broadcastRoom(room);
    }

    if (room.players.size === 0) this.deleteRoom(room);
  }

  private deleteRoom(room: MatchRoom) {
    for (const player of room.players.values()) {
      for (const requestKey of player.requestKeys) this.requestIdentity.delete(requestKey);
    }
    this.rooms.delete(room.code);
  }

  private runHeartbeat() {
    for (const socket of this.webSocketServer.clients) {
      if (this.socketAlive.get(socket) === false) {
        socket.terminate();
        continue;
      }
      this.socketAlive.set(socket, false);
      socket.ping();
    }
  }

  private broadcastRoom(room: MatchRoom) {
    const message: ServerMessage = { type: "room_state", room: this.roomSnapshot(room) };
    for (const player of room.players.values()) {
      if (player.socket) this.send(player.socket, message);
    }
  }

  private broadcastGameState(room: MatchRoom) {
    for (const player of room.players.values()) {
      if (player.socket) this.sendGameState(room, player.socket);
    }
  }

  private sendGameState(room: MatchRoom, socket: WebSocket) {
    if (!room.gameState) return;
    const lastProcessedInput: Partial<Record<PlayerId, number>> = {};
    for (const player of room.players.values()) lastProcessedInput[player.id] = player.lastInputSeq;
    this.send(socket, {
      type: "game_state",
      state: room.gameState,
      stateVersion: room.stateVersion,
      lastProcessedInput,
      serverTime: Date.now(),
    }, true);
  }

  private roomSnapshot(room: MatchRoom): RoomSnapshot {
    const players: RoomPlayerSummary[] = [...room.players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      ready: player.ready,
      connected: player.connected,
    }));
    return {
      code: room.code,
      revision: room.revision,
      playerLimit: room.playerLimit,
      phase: room.phase,
      players,
      winner: room.winner,
      finishReason: room.finishReason,
    };
  }

  private createUniqueRoomCode() {
    for (;;) {
      const bytes = randomBytes(5);
      const code = Array.from(bytes, (byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join("");
      if (!this.rooms.has(code)) return code;
    }
  }

  private validName(name: unknown): name is string {
    return typeof name === "string" && name.trim().length >= 1 && name.trim().length <= 20;
  }

  private validTarget(target: Vec2 | null) {
    return (
      target === null ||
      (typeof target === "object" &&
        Number.isFinite(target.x) &&
        Number.isFinite(target.y) &&
        target.x >= 0 &&
        target.x <= 100 &&
        target.y >= 0 &&
        target.y <= 160)
    );
  }

  private consumeMessageAllowance(socket: WebSocket) {
    const now = Date.now();
    const traffic = this.socketTraffic.get(socket) ?? {
      windowStartedAt: now,
      messageCount: 0,
    };
    if (now - traffic.windowStartedAt >= 1_000) {
      traffic.windowStartedAt = now;
      traffic.messageCount = 0;
    }
    traffic.messageCount += 1;
    this.socketTraffic.set(socket, traffic);
    return traffic.messageCount <= MAX_MESSAGES_PER_SECOND;
  }

  private send(socket: WebSocket | null, message: ServerMessage, volatile = false) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    if (socket.bufferedAmount > HARD_BUFFER_LIMIT) {
      socket.terminate();
      return false;
    }
    if (volatile && socket.bufferedAmount > SOFT_BUFFER_LIMIT) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  private sendError(socket: WebSocket | null, code: string, message: string, recoverable: boolean) {
    this.send(socket, { type: "error", code, message, recoverable });
  }
}
