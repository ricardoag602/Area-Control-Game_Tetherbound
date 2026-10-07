import type { GameState, PlayerId, Vec2 } from "../game/types";

export type RoomPhase = "lobby" | "playing" | "finished";

export interface RoomPlayerSummary {
  id: PlayerId;
  name: string;
  ready: boolean;
  connected: boolean;
}

export interface RoomSnapshot {
  code: string;
  revision: number;
  playerLimit: number;
  phase: RoomPhase;
  players: RoomPlayerSummary[];
  winner: PlayerId | "draw" | null;
  finishReason: "time" | "disconnect" | null;
}

export type ClientMessage =
  | { type: "create_room"; requestId: string; name: string; playerLimit: 2 }
  | { type: "join_room"; requestId: string; code: string; name: string; sessionToken?: string }
  | { type: "set_ready"; ready: boolean }
  | { type: "move_target"; seq: number; target: Vec2 | null }
  | { type: "deploy_anchor"; actionId: string }
  | { type: "request_rematch" }
  | { type: "leave_room" }
  | { type: "ping"; sentAt: number };

export type ServerMessage =
  | {
      type: "welcome";
      playerId: PlayerId;
      sessionToken: string;
      room: RoomSnapshot;
      reconnected: boolean;
    }
  | { type: "room_state"; room: RoomSnapshot }
  | {
      type: "game_state";
      state: GameState;
      stateVersion: number;
      lastProcessedInput: Partial<Record<PlayerId, number>>;
      serverTime: number;
    }
  | { type: "action_ack"; actionId: string; accepted: boolean }
  | { type: "pong"; sentAt: number; serverTime: number }
  | { type: "error"; code: string; message: string; recoverable: boolean };

export function parseClientMessage(value: string): ClientMessage | null {
  try {
    const candidate: unknown = JSON.parse(value);
    if (!isRecord(candidate) || typeof candidate.type !== "string") return null;

    switch (candidate.type) {
      case "create_room":
        return validRequestId(candidate.requestId) && validName(candidate.name) && candidate.playerLimit === 2
          ? {
              type: "create_room",
              requestId: candidate.requestId,
              name: candidate.name,
              playerLimit: 2,
            }
          : null;
      case "join_room":
        return validRequestId(candidate.requestId) &&
          typeof candidate.code === "string" &&
          candidate.code.length <= 8 &&
          validName(candidate.name) &&
          (candidate.sessionToken === undefined ||
            (typeof candidate.sessionToken === "string" && candidate.sessionToken.length <= 128))
          ? {
              type: "join_room",
              requestId: candidate.requestId,
              code: candidate.code,
              name: candidate.name,
              ...(candidate.sessionToken ? { sessionToken: candidate.sessionToken } : {}),
            }
          : null;
      case "set_ready":
        return typeof candidate.ready === "boolean"
          ? { type: "set_ready", ready: candidate.ready }
          : null;
      case "move_target":
        return validSequence(candidate.seq) && validTarget(candidate.target)
          ? { type: "move_target", seq: candidate.seq, target: candidate.target }
          : null;
      case "deploy_anchor":
        return validActionId(candidate.actionId)
          ? { type: "deploy_anchor", actionId: candidate.actionId }
          : null;
      case "request_rematch":
        return { type: "request_rematch" };
      case "leave_room":
        return { type: "leave_room" };
      case "ping":
        return typeof candidate.sentAt === "number" && Number.isFinite(candidate.sentAt)
          ? { type: "ping", sentAt: candidate.sentAt }
          : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 20;
}

function validRequestId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 80;
}

function validActionId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 80;
}

function validSequence(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validTarget(value: unknown): value is Vec2 | null {
  return (
    value === null ||
    (isRecord(value) &&
      typeof value.x === "number" &&
      Number.isFinite(value.x) &&
      typeof value.y === "number" &&
      Number.isFinite(value.y) &&
      value.x >= 0 &&
      value.x <= 100 &&
      value.y >= 0 &&
      value.y <= 160)
  );
}
