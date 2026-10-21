import type { GameState, MovementCommand, PlayerId, PlayerLimit } from "../game/types";
import { createClientId } from "./clientId";
import { resolveRoomApiUrl } from "./connectionInfo";
import type {
  ClientMessage,
  PublicRoomSummary,
  RoomSnapshot,
  RoomVisibility,
  ServerMessage,
} from "./protocol";

export type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "offline";

export interface RoomClientSnapshot {
  connection: ConnectionStatus;
  room: RoomSnapshot | null;
  gameState: GameState | null;
  playerId: PlayerId | null;
  latencyMs: number | null;
  error: string | null;
  stateVersion: number;
}

type Listener = () => void;
type SessionIntent =
  | {
      kind: "create";
      requestId: string;
      name: string;
      playerLimit: PlayerLimit;
      visibility: RoomVisibility;
    }
  | { kind: "join"; requestId: string; name: string; roomCode: string };
type SyncCommand = Extract<
  ClientMessage,
  { type: "set_ready" | "movement_input" | "deploy_anchor" | "request_rematch" }
>;

interface RoomApiEnvelope {
  messages: ServerMessage[];
  serverTime: number;
}

interface PublicRoomListEnvelope {
  rooms: PublicRoomSummary[];
  serverTime: number;
}

const RETRY_DELAYS = [250, 500, 1_000, 2_000, 4_000];
const REQUEST_TIMEOUT_MS = 8_000;
const PLAYING_POLL_INTERVAL_MS = 125;
const IDLE_POLL_INTERVAL_MS = 500;
const LATENCY_PUBLISH_INTERVAL_MS = 750;
const LATENCY_SIGNIFICANT_CHANGE_MS = 40;
const MAX_SYNC_COMMANDS = 64;
const MAX_INITIAL_CONNECTION_ATTEMPTS = 3;
const MAX_RECONNECT_ATTEMPTS = 5;
const SERVER_UNREACHABLE_MESSAGE =
  "The multiplayer room service could not be reached. Check your connection and try again.";
const SERVER_UNRESPONSIVE_MESSAGE =
  "The multiplayer room service did not return a valid response. Try again.";
const ROOM_CONNECTION_LOST_MESSAGE =
  "Connection to the room was lost. Try reconnecting while your slot is still reserved.";
const PUBLIC_ROOMS_UNAVAILABLE_MESSAGE =
  "Public rooms could not be loaded. Check your connection and try again.";

export interface RoomClientOptions {
  fetch?: typeof fetch;
  getApiUrl?: () => string;
  /** Retained for callers that previously supplied the WebSocket server URL. */
  getServerUrl?: () => string;
  /** @deprecated HTTP transport no longer constructs browser WebSockets. */
  createSocket?: (url: string) => WebSocket;
  requestTimeoutMs?: number;
  /** @deprecated Use requestTimeoutMs. */
  socketOpenTimeoutMs?: number;
  /** @deprecated Use requestTimeoutMs. */
  handshakeTimeoutMs?: number;
  maxInitialConnectionAttempts?: number;
  maxReconnectAttempts?: number;
  retryDelays?: readonly number[];
  retryJitterMs?: number;
  playingPollIntervalMs?: number;
  idlePollIntervalMs?: number;
}

export function getRoomApiUrl() {
  return resolveRoomApiUrl(window.location, import.meta.env.VITE_ROOM_API_URL);
}

/** Backwards-compatible name used by the connection-details UI. */
export const getRoomServerUrl = getRoomApiUrl;

export class RoomClient {
  private snapshot: RoomClientSnapshot = {
    connection: "idle",
    room: null,
    gameState: null,
    playerId: null,
    latencyMs: null,
    error: null,
    stateVersion: 0,
  };

  private readonly listeners = new Set<Listener>();
  private intent: SessionIntent | null = null;
  private sessionToken: string | null = null;
  private pendingCommands: SyncCommand[] = [];
  private inFlightCommands: SyncCommand[] = [];
  private retryAttempt = 0;
  private connectionAttempts = 0;
  private retryTimer: number | null = null;
  private pollTimer: number | null = null;
  private movementTimer: number | null = null;
  private pendingMovementCommand: MovementCommand | null = null;
  private lastMovementSentAt = 0;
  private lastMovementType: MovementCommand["type"] | null = null;
  private shouldRun = false;
  private requestInFlight = false;
  private activeRequest: AbortController | null = null;
  private lifecycle = 0;
  private inputSequence = 0;
  private readonly pendingActions = new Set<string>();
  private lastConnectionError = SERVER_UNREACHABLE_MESSAGE;
  private smoothedLatencyMs: number | null = null;
  private lastLatencyPublishedAt = Number.NEGATIVE_INFINITY;
  private updateBatchDepth = 0;
  private updateBatchBaseline: RoomClientSnapshot | null = null;

  constructor(private readonly options: RoomClientOptions = {}) {}

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  createRoom(
    name: string,
    playerLimit: PlayerLimit = 2,
    visibility: RoomVisibility = "private",
  ) {
    this.begin(
      {
        kind: "create",
        requestId: createClientId(),
        name: name.trim(),
        playerLimit,
        visibility,
      },
      null,
    );
  }

  async listPublicRooms(): Promise<PublicRoomSummary[]> {
    const controller = new AbortController();
    const timeoutMs = this.options.requestTimeoutMs ??
      this.options.handshakeTimeoutMs ??
      this.options.socketOpenTimeoutMs ??
      REQUEST_TIMEOUT_MS;
    const timeoutTimer = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.fetcher()(`${this.apiUrl()}/public`, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      const value: unknown = await response.json();
      if (!response.ok || !isPublicRoomListEnvelope(value)) {
        throw new Error(PUBLIC_ROOMS_UNAVAILABLE_MESSAGE);
      }
      return value.rooms;
    } catch {
      throw new Error(PUBLIC_ROOMS_UNAVAILABLE_MESSAGE);
    } finally {
      window.clearTimeout(timeoutTimer);
    }
  }

  joinRoom(roomCode: string, name: string) {
    const code = roomCode.trim().toUpperCase();
    const saved = this.readSession(code);
    this.begin(
      {
        kind: "join",
        requestId: createClientId(),
        roomCode: code,
        name: (saved?.name ?? name).trim(),
      },
      saved?.token ?? null,
    );
  }

  resumeRoom(roomCode: string) {
    const code = roomCode.trim().toUpperCase();
    const saved = this.readSession(code);
    if (!saved) return false;
    this.begin(
      {
        kind: "join",
        requestId: createClientId(),
        roomCode: code,
        name: saved.name,
      },
      saved.token,
    );
    return true;
  }

  retry() {
    if (!this.intent) return false;

    this.startNewLifecycle();
    this.restoreInFlightCommands();
    this.requeuePendingActions();
    this.retryAttempt = 0;
    this.connectionAttempts = 0;
    this.lastConnectionError = this.snapshot.room
      ? ROOM_CONNECTION_LOST_MESSAGE
      : SERVER_UNREACHABLE_MESSAGE;
    this.shouldRun = true;
    this.update({
      connection: this.snapshot.room ? "reconnecting" : "connecting",
      error: null,
    });
    this.startRequestForCurrentSession();
    return true;
  }

  setReady(ready: boolean) {
    this.enqueue({ type: "set_ready", ready });
    this.requestSyncNow();
  }

  sendMovementCommand(command: MovementCommand) {
    const now = performance.now();
    const elapsed = now - this.lastMovementSentAt;
    const continuous = command.type === "walk" ||
      command.type === "walk_direction" ||
      command.type === "charge" ||
      command.type === "charge_direction" ||
      command.type === "tank_charge";
    const sameContinuousGesture = continuous && command.type === this.lastMovementType;
    if (!sameContinuousGesture || elapsed >= 50) {
      this.clearMovementTimer();
      this.sendMovementCommandNow(command);
      return;
    }

    this.pendingMovementCommand = command;
    if (this.movementTimer === null) {
      this.movementTimer = window.setTimeout(() => {
        const pending = this.pendingMovementCommand;
        this.movementTimer = null;
        this.pendingMovementCommand = null;
        if (pending) this.sendMovementCommandNow(pending);
      }, 50 - elapsed);
    }
  }

  deployAnchor() {
    const actionId = createClientId();
    this.pendingActions.add(actionId);
    this.enqueue({ type: "deploy_anchor", actionId });
    this.requestSyncNow();
  }

  requestRematch() {
    this.enqueue({ type: "request_rematch" });
    this.requestSyncNow();
  }

  leave() {
    const roomCode = this.snapshot.room?.code;
    const sessionToken = this.sessionToken;
    const apiUrl = this.apiUrl();

    this.shouldRun = false;
    this.startNewLifecycle();
    this.intent = null;
    this.sessionToken = null;
    this.pendingCommands = [];
    this.inFlightCommands = [];
    this.retryAttempt = 0;
    this.connectionAttempts = 0;
    this.inputSequence = 0;
    this.lastMovementType = null;
    this.pendingActions.clear();
    this.resetLatencyTracking();
    if (roomCode) this.removeSession(roomCode);
    this.update({
      connection: "idle",
      room: null,
      gameState: null,
      playerId: null,
      latencyMs: null,
      error: null,
      stateVersion: 0,
    });

    if (roomCode && sessionToken) {
      const fetcher = this.fetcher();
      void fetcher(`${apiUrl}/${encodeURIComponent(roomCode)}/leave`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ type: "leave_room" }),
        keepalive: true,
      }).catch(() => {
        // Leaving is immediate locally; the hosted room expires the slot if this best-effort request fails.
      });
    }
  }

  private begin(intent: SessionIntent, sessionToken: string | null) {
    this.shouldRun = false;
    this.startNewLifecycle();
    this.intent = intent;
    this.sessionToken = sessionToken;
    this.pendingCommands = [];
    this.inFlightCommands = [];
    this.retryAttempt = 0;
    this.connectionAttempts = 0;
    this.inputSequence = 0;
    this.lastMovementType = null;
    this.pendingActions.clear();
    this.resetLatencyTracking();
    this.shouldRun = true;
    this.lastConnectionError = SERVER_UNREACHABLE_MESSAGE;
    this.update({
      connection: "connecting",
      room: null,
      gameState: null,
      playerId: null,
      latencyMs: null,
      error: null,
      stateVersion: 0,
    });
    this.performInitialRequest(this.lifecycle);
  }

  private startRequestForCurrentSession() {
    if (this.snapshot.room && this.sessionToken) {
      this.performSync(this.lifecycle);
    } else {
      this.performInitialRequest(this.lifecycle);
    }
  }

  private async performInitialRequest(lifecycle: number) {
    if (!this.shouldRun || !this.intent || this.requestInFlight || lifecycle !== this.lifecycle) {
      return;
    }

    this.requestInFlight = true;
    this.connectionAttempts += 1;
    const startedAt = performance.now();
    let connected = false;
    try {
      const intent = this.intent;
      const endpoint = intent.kind === "create"
        ? `${this.apiUrl()}/create`
        : `${this.apiUrl()}/${encodeURIComponent(intent.roomCode)}/join`;
      const body: ClientMessage = intent.kind === "create"
        ? {
            type: "create_room",
            requestId: intent.requestId,
            name: intent.name,
            playerLimit: intent.playerLimit,
            visibility: intent.visibility,
          }
        : {
            type: "join_room",
            requestId: intent.requestId,
            code: intent.roomCode,
            name: intent.name,
            sessionToken: this.sessionToken ?? undefined,
          };
      const result = await this.post(endpoint, body, null, lifecycle);
      if (lifecycle !== this.lifecycle || !this.shouldRun) return;

      this.batchUpdates(() => {
        const outcome = this.processMessages(result.envelope.messages);
        if (!this.shouldRun || this.snapshot.connection === "offline") return;
        if (!result.ok) {
          this.handleRequestFailure();
          return;
        }
        if (!outcome.welcomed || !this.snapshot.room || !this.sessionToken) {
          this.lastConnectionError = SERVER_UNRESPONSIVE_MESSAGE;
          this.handleRequestFailure();
          return;
        }

        if (this.smoothedLatencyMs === null) {
          this.updateLatency(performance.now() - startedAt);
        }
        this.retryAttempt = 0;
        this.connectionAttempts = 0;
        this.update({ connection: "connected", error: outcome.hadError ? this.snapshot.error : null });
        connected = true;
      });
    } catch {
      if (lifecycle === this.lifecycle && this.shouldRun) {
        this.batchUpdates(() => this.handleRequestFailure());
      }
    } finally {
      if (lifecycle === this.lifecycle) this.requestInFlight = false;
      if (connected && lifecycle === this.lifecycle && this.shouldRun) {
        this.scheduleSync(this.pollInterval());
      }
    }
  }

  private async performSync(lifecycle: number) {
    const room = this.snapshot.room;
    const sessionToken = this.sessionToken;
    if (
      !this.shouldRun ||
      !room ||
      !sessionToken ||
      this.requestInFlight ||
      lifecycle !== this.lifecycle
    ) {
      return;
    }

    this.requestInFlight = true;
    this.connectionAttempts += 1;
    this.inFlightCommands = this.pendingCommands.splice(0, MAX_SYNC_COMMANDS);
    const sentAt = performance.now();
    let synchronized = false;
    try {
      const result = await this.post(
        `${this.apiUrl()}/${encodeURIComponent(room.code)}/sync`,
        {
          knownRoomRevision: room.revision,
          knownStateVersion: this.snapshot.stateVersion,
          commands: this.inFlightCommands,
          sentAt,
        },
        sessionToken,
        lifecycle,
      );
      if (lifecycle !== this.lifecycle || !this.shouldRun) return;

      this.batchUpdates(() => {
        const outcome = this.processMessages(result.envelope.messages);
        if (!this.shouldRun || this.snapshot.connection === "offline") {
          this.inFlightCommands = [];
          return;
        }
        if (!result.ok) {
          this.restoreInFlightCommands();
          this.handleRequestFailure();
          return;
        }

        this.inFlightCommands = [];
        this.retryAttempt = 0;
        this.connectionAttempts = 0;
        this.update({ connection: "connected", error: outcome.hadError ? this.snapshot.error : null });
        synchronized = true;
      });
    } catch {
      if (lifecycle === this.lifecycle && this.shouldRun) {
        this.batchUpdates(() => {
          this.restoreInFlightCommands();
          this.handleRequestFailure();
        });
      }
    } finally {
      if (lifecycle === this.lifecycle) this.requestInFlight = false;
      if (synchronized && lifecycle === this.lifecycle && this.shouldRun) {
        const timeUntilNextPoll = Math.max(
          0,
          this.pollInterval() - (performance.now() - sentAt),
        );
        this.scheduleSync(this.pendingCommands.length > 0 ? 0 : timeUntilNextPoll);
      }
    }
  }

  private processMessages(messages: readonly ServerMessage[]) {
    let welcomed = false;
    let hadError = false;
    for (const message of messages) {
      if (message.type === "welcome") welcomed = true;
      if (message.type === "error") hadError = true;
      this.handleMessage(message);
    }
    return { welcomed, hadError };
  }

  private handleMessage(message: ServerMessage) {
    if (message.type === "welcome") {
      this.sessionToken = message.sessionToken;
      this.storeSession(message.room.code, message.sessionToken, this.currentName());
      this.update({
        connection: "connected",
        room: message.room,
        playerId: message.playerId,
        error: null,
      });
      return;
    }
    if (message.type === "room_state") {
      if (!this.snapshot.room || message.room.revision > this.snapshot.room.revision) {
        this.update({ room: message.room });
      }
      return;
    }
    if (message.type === "game_state") {
      const localPlayerId = this.snapshot.playerId;
      const acknowledgedInput = localPlayerId
        ? message.lastProcessedInput[localPlayerId]
        : undefined;
      if (acknowledgedInput !== undefined) {
        this.inputSequence = Math.max(this.inputSequence, acknowledgedInput);
      }
      if (!this.snapshot.gameState || message.stateVersion > this.snapshot.stateVersion) {
        this.update({ gameState: message.state, stateVersion: message.stateVersion });
      }
      return;
    }
    if (message.type === "action_ack") {
      this.pendingActions.delete(message.actionId);
      return;
    }
    if (message.type === "pong") {
      this.updateLatency(performance.now() - message.sentAt);
      return;
    }
    if (message.type === "error") {
      this.update({ error: message.message });
      if (!message.recoverable) {
        const roomCode = this.snapshot.room?.code ??
          (this.intent?.kind === "join" ? this.intent.roomCode : null);
        if (roomCode) this.removeSession(roomCode);
        this.sessionToken = null;
        this.shouldRun = false;
        this.clearNetworkTimers();
        this.update({ connection: "offline" });
      }
    }
  }

  private enqueue(command: SyncCommand) {
    if (!this.intent || !this.snapshot.room) return;
    const previousIndex = this.pendingCommands.length - 1;
    const previous = this.pendingCommands[previousIndex];
    if (canCoalesceMovementInput(previous, command)) {
      this.pendingCommands[previousIndex] = command;
      return;
    }
    this.pendingCommands.push(command);
  }

  private sendMovementCommandNow(command: MovementCommand) {
    this.inputSequence += 1;
    this.lastMovementSentAt = performance.now();
    this.lastMovementType = command.type;
    this.enqueue({ type: "movement_input", seq: this.inputSequence, command });
    this.requestSyncNow();
  }

  /**
   * Gameplay commands should not wait behind the background snapshot cadence.
   * If a request is already running, performSync's completion path notices the
   * queued command and starts the next request immediately.
   */
  private requestSyncNow() {
    if (!this.shouldRun || !this.snapshot.room || !this.sessionToken) return;
    if (this.pollTimer !== null) {
      window.clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (!this.requestInFlight) this.scheduleSync(0);
  }

  private scheduleSync(delay: number) {
    if (!this.shouldRun || !this.snapshot.room || !this.sessionToken || this.pollTimer !== null) {
      return;
    }
    this.pollTimer = window.setTimeout(() => {
      this.pollTimer = null;
      this.performSync(this.lifecycle);
    }, delay);
  }

  private handleRequestFailure() {
    if (!this.shouldRun || !this.intent) return;
    this.lastConnectionError = this.snapshot.error ?? (this.snapshot.room
      ? ROOM_CONNECTION_LOST_MESSAGE
      : this.lastConnectionError);
    if (this.connectionAttempts >= this.connectionAttemptLimit()) {
      this.failConnection();
      return;
    }

    this.update({
      connection: this.snapshot.room ? "reconnecting" : "connecting",
    });
    const retryDelays = this.options.retryDelays ?? RETRY_DELAYS;
    const baseDelay = retryDelays[Math.min(this.retryAttempt, retryDelays.length - 1)] ?? 0;
    const jitter = Math.round(Math.random() * (this.options.retryJitterMs ?? 120));
    this.retryAttempt += 1;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.startRequestForCurrentSession();
    }, baseDelay + jitter);
  }

  private failConnection() {
    this.shouldRun = false;
    this.clearNetworkTimers();
    this.activeRequest?.abort();
    this.activeRequest = null;
    this.update({ connection: "offline", error: this.lastConnectionError });
  }

  private async post(
    endpoint: string,
    body: unknown,
    sessionToken: string | null,
    lifecycle: number,
  ) {
    const controller = new AbortController();
    this.activeRequest = controller;
    let timeoutTimer: number | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timeoutTimer = window.setTimeout(() => {
        controller.abort();
        reject(new Error("Room request timed out"));
      }, this.options.requestTimeoutMs ??
        this.options.handshakeTimeoutMs ??
        this.options.socketOpenTimeoutMs ??
        REQUEST_TIMEOUT_MS);
    });
    const request = (async () => {
      const response = await this.fetcher()(endpoint, {
        method: "POST",
        headers: {
          ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const value: unknown = await response.json();
      if (!isRoomApiEnvelope(value)) throw new Error("Invalid room service response");
      return { ok: response.ok, envelope: value };
    })();

    try {
      return await Promise.race([request, timeout]);
    } finally {
      if (timeoutTimer !== null) window.clearTimeout(timeoutTimer);
      if (lifecycle === this.lifecycle && this.activeRequest === controller) {
        this.activeRequest = null;
      }
    }
  }

  private restoreInFlightCommands() {
    if (this.inFlightCommands.length === 0) return;
    this.pendingCommands = [...this.inFlightCommands, ...this.pendingCommands];
    this.inFlightCommands = [];
  }

  private requeuePendingActions() {
    for (const actionId of this.pendingActions) {
      const alreadyQueued = [...this.inFlightCommands, ...this.pendingCommands].some(
        (command) => command.type === "deploy_anchor" && command.actionId === actionId,
      );
      if (!alreadyQueued) this.pendingCommands.push({ type: "deploy_anchor", actionId });
    }
  }

  private startNewLifecycle() {
    this.lifecycle += 1;
    this.activeRequest?.abort();
    this.activeRequest = null;
    this.requestInFlight = false;
    this.clearNetworkTimers();
    this.clearMovementTimer();
  }

  private clearNetworkTimers() {
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    if (this.pollTimer !== null) window.clearTimeout(this.pollTimer);
    this.retryTimer = null;
    this.pollTimer = null;
  }

  private clearMovementTimer() {
    if (this.movementTimer !== null) window.clearTimeout(this.movementTimer);
    this.movementTimer = null;
    this.pendingMovementCommand = null;
  }

  private updateLatency(roundTrip: number) {
    const measured = Math.max(0, roundTrip);
    const previousSmoothed = this.smoothedLatencyMs;
    const smoothed = previousSmoothed === null
      ? measured
      : previousSmoothed * 0.7 + measured * 0.3;
    this.smoothedLatencyMs = smoothed;

    const now = performance.now();
    const nextVisible = Math.round(smoothed);
    const currentVisible = this.snapshot.latencyMs;
    const publishDue = currentVisible === null ||
      now - this.lastLatencyPublishedAt >= LATENCY_PUBLISH_INTERVAL_MS ||
      Math.abs(nextVisible - currentVisible) >= LATENCY_SIGNIFICANT_CHANGE_MS;
    if (!publishDue) return;

    this.lastLatencyPublishedAt = now;
    this.update({ latencyMs: nextVisible });
  }

  private resetLatencyTracking() {
    this.smoothedLatencyMs = null;
    this.lastLatencyPublishedAt = Number.NEGATIVE_INFINITY;
  }

  private currentName() {
    return this.intent?.name ?? "Astronaut";
  }

  private update(patch: Partial<RoomClientSnapshot>) {
    const changed = Object.entries(patch).some(([key, value]) =>
      !Object.is(this.snapshot[key as keyof RoomClientSnapshot], value)
    );
    if (!changed) return false;

    this.snapshot = { ...this.snapshot, ...patch };
    if (this.updateBatchDepth > 0) return true;
    this.publish();
    return true;
  }

  private batchUpdates<T>(operation: () => T): T {
    const outermost = this.updateBatchDepth === 0;
    if (outermost) this.updateBatchBaseline = this.snapshot;
    this.updateBatchDepth += 1;
    try {
      return operation();
    } finally {
      this.updateBatchDepth -= 1;
      if (outermost) {
        const baseline = this.updateBatchBaseline;
        this.updateBatchBaseline = null;
        if (baseline && !sameSnapshot(baseline, this.snapshot)) this.publish();
      }
    }
  }

  private publish() {
    for (const listener of this.listeners) listener();
  }

  private apiUrl() {
    return normalizeApiUrl(
      this.options.getApiUrl?.() ?? this.options.getServerUrl?.() ?? getRoomApiUrl(),
    );
  }

  private fetcher() {
    return this.options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private pollInterval() {
    return this.snapshot.room?.phase === "playing"
      ? this.options.playingPollIntervalMs ?? PLAYING_POLL_INTERVAL_MS
      : this.options.idlePollIntervalMs ?? IDLE_POLL_INTERVAL_MS;
  }

  private connectionAttemptLimit() {
    return this.snapshot.room
      ? this.options.maxReconnectAttempts ?? MAX_RECONNECT_ATTEMPTS
      : this.options.maxInitialConnectionAttempts ?? MAX_INITIAL_CONNECTION_ATTEMPTS;
  }

  private sessionKey(code: string) {
    return `tetherbound.room.${code}`;
  }

  private storeSession(code: string, token: string, name: string) {
    try {
      sessionStorage.setItem(this.sessionKey(code), JSON.stringify({ token, name }));
    } catch {
      // The live HTTP session still works when tab-scoped browser storage is unavailable.
    }
  }

  private readSession(code: string): { token: string; name: string } | null {
    try {
      const raw = sessionStorage.getItem(this.sessionKey(code));
      if (!raw) return null;
      const value = JSON.parse(raw) as { token?: unknown; name?: unknown };
      if (typeof value.token === "string" && typeof value.name === "string") {
        return { token: value.token, name: value.name };
      }
    } catch {
      // Ignore unavailable or malformed browser storage.
    }
    return null;
  }

  private removeSession(code: string) {
    try {
      sessionStorage.removeItem(this.sessionKey(code));
    } catch {
      // The room still closes when browser storage is unavailable.
    }
  }
}

function canCoalesceMovementInput(
  previous: SyncCommand | undefined,
  next: SyncCommand,
) {
  return previous?.type === "movement_input" &&
    next.type === "movement_input" &&
    isCoalescibleAnalogCommand(previous.command) &&
    previous.command.type === next.command.type;
}

function isCoalescibleAnalogCommand(command: MovementCommand) {
  return command.type === "walk_direction" ||
    command.type === "charge_direction" ||
    command.type === "tank_drive" ||
    command.type === "tank_charge";
}

function sameSnapshot(a: RoomClientSnapshot, b: RoomClientSnapshot) {
  return a.connection === b.connection &&
    a.room === b.room &&
    a.gameState === b.gameState &&
    a.playerId === b.playerId &&
    a.latencyMs === b.latencyMs &&
    a.error === b.error &&
    a.stateVersion === b.stateVersion;
}

function isRoomApiEnvelope(value: unknown): value is RoomApiEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<RoomApiEnvelope>;
  return Array.isArray(candidate.messages) &&
    typeof candidate.serverTime === "number" &&
    Number.isFinite(candidate.serverTime);
}

function isPublicRoomListEnvelope(value: unknown): value is PublicRoomListEnvelope {
  if (!isRecord(value) || !Array.isArray(value.rooms) || !isFiniteNumber(value.serverTime)) {
    return false;
  }
  return value.rooms.every(isPublicRoomSummary);
}

function isPublicRoomSummary(value: unknown): value is PublicRoomSummary {
  if (!isRecord(value)) return false;
  return typeof value.code === "string" && /^[A-HJ-NP-Z2-9]{5}$/.test(value.code) &&
    typeof value.hostName === "string" && value.hostName.trim().length > 0 &&
    typeof value.playerCount === "number" &&
    Number.isSafeInteger(value.playerCount) && value.playerCount >= 1 &&
    (value.playerLimit === 2 || value.playerLimit === 3 || value.playerLimit === 4) &&
    value.playerCount < value.playerLimit &&
    isFiniteNumber(value.updatedAt);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeApiUrl(value: string) {
  return value.replace(/\/+$/, "");
}
