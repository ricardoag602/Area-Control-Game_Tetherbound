import type { GameState, MovementCommand, PlayerId } from "../game/types";
import { createClientId } from "./clientId";
import { resolveRoomServerUrl } from "./connectionInfo";
import type { ClientMessage, RoomSnapshot, ServerMessage } from "./protocol";

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
  | { kind: "create"; requestId: string; name: string; playerLimit: 2 }
  | { kind: "join"; requestId: string; name: string; roomCode: string };

const RETRY_DELAYS = [250, 500, 1_000, 2_000, 4_000];
const HANDSHAKE_TIMEOUT_MS = 5_000;
const CLIENT_ERROR_CLOSE_CODE = 4003;

export function getRoomServerUrl() {
  return resolveRoomServerUrl(window.location, import.meta.env.VITE_WS_URL);
}

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
  private socket: WebSocket | null = null;
  private intent: SessionIntent | null = null;
  private sessionToken: string | null = null;
  private retryAttempt = 0;
  private retryTimer: number | null = null;
  private handshakeTimer: number | null = null;
  private pingTimer: number | null = null;
  private movementTimer: number | null = null;
  private pendingMovementCommand: MovementCommand | null = null;
  private lastMovementSentAt = 0;
  private lastMovementType: MovementCommand["type"] | null = null;
  private shouldReconnect = false;
  private inputSequence = 0;
  private readonly pendingActions = new Set<string>();

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  createRoom(name: string, playerLimit: 2 = 2) {
    this.sessionToken = null;
    this.begin({ kind: "create", requestId: createClientId(), name: name.trim(), playerLimit });
  }

  joinRoom(roomCode: string, name: string) {
    const code = roomCode.trim().toUpperCase();
    const saved = this.readSession(code);
    this.sessionToken = saved?.token ?? null;
    this.begin({
      kind: "join",
      requestId: createClientId(),
      roomCode: code,
      name: (saved?.name ?? name).trim(),
    });
  }

  resumeRoom(roomCode: string) {
    const code = roomCode.trim().toUpperCase();
    const saved = this.readSession(code);
    if (!saved) return false;
    this.sessionToken = saved.token;
    this.begin({
      kind: "join",
      requestId: createClientId(),
      roomCode: code,
      name: saved.name,
    });
    return true;
  }

  setReady(ready: boolean) {
    this.send({ type: "set_ready", ready });
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

  private sendMovementCommandNow(command: MovementCommand) {
    this.inputSequence += 1;
    this.lastMovementSentAt = performance.now();
    this.lastMovementType = command.type;
    this.send({ type: "movement_input", seq: this.inputSequence, command });
  }

  deployAnchor() {
    const actionId = createClientId();
    this.pendingActions.add(actionId);
    this.send({ type: "deploy_anchor", actionId });
  }

  requestRematch() {
    this.send({ type: "request_rematch" });
  }

  leave() {
    const roomCode = this.snapshot.room?.code;
    this.shouldReconnect = false;
    this.clearTimers();
    this.send({ type: "leave_room" });
    this.socket?.close(1000, "Player left room");
    this.socket = null;
    this.intent = null;
    this.sessionToken = null;
    this.retryAttempt = 0;
    this.inputSequence = 0;
    this.lastMovementType = null;
    this.pendingActions.clear();
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
  }

  private begin(intent: SessionIntent) {
    this.shouldReconnect = false;
    this.clearTimers();
    this.socket?.close(1000, "Starting a new session");
    this.intent = intent;
    this.retryAttempt = 0;
    this.inputSequence = 0;
    this.lastMovementType = null;
    this.pendingActions.clear();
    this.shouldReconnect = true;
    this.update({
      connection: "connecting",
      room: null,
      gameState: null,
      playerId: null,
      latencyMs: null,
      error: null,
      stateVersion: 0,
    });
    this.connect();
  }

  private connect() {
    if (!this.intent || !this.shouldReconnect) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.webSocketUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.addEventListener("open", () => {
      if (socket !== this.socket || !this.intent) return;
      const activeCode = this.snapshot.room?.code;
      if (activeCode && this.sessionToken) {
        this.send({
          type: "join_room",
          requestId: this.intent.requestId,
          code: activeCode,
          name: this.currentName(),
          sessionToken: this.sessionToken,
        });
      } else if (this.intent.kind === "create") {
        this.send({
          type: "create_room",
          requestId: this.intent.requestId,
          name: this.intent.name,
          playerLimit: this.intent.playerLimit,
        });
      } else {
        this.send({
          type: "join_room",
          requestId: this.intent.requestId,
          code: this.intent.roomCode,
          name: this.intent.name,
          sessionToken: this.sessionToken ?? undefined,
        });
      }
      this.startHandshakeTimer(socket);
    });

    socket.addEventListener("message", (event) => this.handleMessage(socket, String(event.data)));
    socket.addEventListener("close", () => this.handleClose(socket));
    socket.addEventListener("error", () => {
      // A close event follows and owns retry behavior.
    });
  }

  private handleMessage(socket: WebSocket, raw: string) {
    // A replaced socket can still have a message queued when its close event runs.
    // Never let that stale room mutate the active session.
    if (socket !== this.socket) return;

    let message: ServerMessage;
    try {
      message = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }

    if (message.type === "welcome") {
      this.clearHandshakeTimer();
      this.retryAttempt = 0;
      this.sessionToken = message.sessionToken;
      this.storeSession(message.room.code, message.sessionToken, this.currentName());
      this.update({
        connection: "connected",
        room: message.room,
        playerId: message.playerId,
        error: null,
      });
      this.startPings();
      this.flushPendingActions();
      return;
    }
    if (message.type === "room_state") {
      if (!this.snapshot.room || message.room.revision >= this.snapshot.room.revision) {
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
      if (message.stateVersion >= this.snapshot.stateVersion) {
        this.update({ gameState: message.state, stateVersion: message.stateVersion });
      }
      return;
    }
    if (message.type === "action_ack") {
      this.pendingActions.delete(message.actionId);
      return;
    }
    if (message.type === "pong") {
      const roundTrip = Math.max(0, performance.now() - message.sentAt);
      const latency = this.snapshot.latencyMs;
      this.update({ latencyMs: Math.round(latency === null ? roundTrip : latency * 0.7 + roundTrip * 0.3) });
      return;
    }
    if (message.type === "error") {
      this.update({ error: message.message });
      if (!message.recoverable) {
        this.shouldReconnect = false;
        this.clearTimers();
        this.socket?.close(CLIENT_ERROR_CLOSE_CODE, message.code);
        this.update({ connection: "offline" });
      }
    }
  }

  private handleClose(socket: WebSocket) {
    if (socket !== this.socket) return;
    this.socket = null;
    this.stopPings();
    this.clearHandshakeTimer();
    this.clearMovementTimer();
    this.lastMovementType = null;
    if (!this.shouldReconnect || !this.intent) {
      this.update({ connection: "offline" });
      return;
    }

    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (!this.shouldReconnect || !this.intent || this.retryTimer !== null) return;
    this.update({ connection: this.snapshot.room ? "reconnecting" : "connecting" });
    const baseDelay = RETRY_DELAYS[Math.min(this.retryAttempt, RETRY_DELAYS.length - 1)];
    const jitter = Math.round(Math.random() * 120);
    this.retryAttempt += 1;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, baseDelay + jitter);
  }

  private send(message: ClientMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  private startPings() {
    this.stopPings();
    this.pingTimer = window.setInterval(() => {
      this.send({ type: "ping", sentAt: performance.now() });
    }, 2_000);
  }

  private startHandshakeTimer(socket: WebSocket) {
    this.clearHandshakeTimer();
    this.handshakeTimer = window.setTimeout(() => {
      if (socket === this.socket && this.snapshot.connection !== "connected") {
        socket.close(4000, "Room handshake timed out");
      }
    }, HANDSHAKE_TIMEOUT_MS);
  }

  private clearHandshakeTimer() {
    if (this.handshakeTimer !== null) window.clearTimeout(this.handshakeTimer);
    this.handshakeTimer = null;
  }

  private flushPendingActions() {
    for (const actionId of this.pendingActions) {
      this.send({ type: "deploy_anchor", actionId });
    }
  }

  private stopPings() {
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private clearTimers() {
    this.stopPings();
    this.clearHandshakeTimer();
    this.clearMovementTimer();
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private clearMovementTimer() {
    if (this.movementTimer !== null) window.clearTimeout(this.movementTimer);
    this.movementTimer = null;
    this.pendingMovementCommand = null;
  }

  private currentName() {
    return this.intent?.name ?? "Astronaut";
  }

  private update(patch: Partial<RoomClientSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private webSocketUrl() {
    return getRoomServerUrl();
  }

  private sessionKey(code: string) {
    return `tetherbound.room.${code}`;
  }

  private storeSession(code: string, token: string, name: string) {
    try {
      sessionStorage.setItem(this.sessionKey(code), JSON.stringify({ token, name }));
    } catch {
      // Private browsing may deny storage; the live socket still works.
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
      // Ignore unavailable or malformed storage.
    }
    return null;
  }

  private removeSession(code: string) {
    try {
      sessionStorage.removeItem(this.sessionKey(code));
    } catch {
      // The room still closes even when browser storage is unavailable.
    }
  }
}
