import { WORLD } from "../game/constants";
import type { GameState, MovementCommand, PlayerId, Vec2 } from "../game/types";

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
  | { type: "movement_input"; seq: number; command: MovementCommand }
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
      case "movement_input": {
        const command = parseMovementCommand(candidate.command);
        return validSequence(candidate.seq) && command
          ? { type: "movement_input", seq: candidate.seq, command }
          : null;
      }
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

function parseMovementCommand(value: unknown): MovementCommand | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (value.type === "stop") return { type: "stop" };
  if (value.type === "tank_release") return { type: "tank_release" };
  if (
    value.type === "tank_drive" &&
    validTankAxis(value.throttle) &&
    validTankAxis(value.steering) &&
    (value.throttle !== 0 || value.steering !== 0)
  ) {
    return {
      type: "tank_drive",
      throttle: value.throttle,
      steering: value.steering,
    };
  }
  if (
    value.type === "tank_charge" &&
    (value.throttle === -1 || value.throttle === 1) &&
    validTankAxis(value.steering)
  ) {
    return {
      type: "tank_charge",
      throttle: value.throttle,
      steering: value.steering,
    };
  }
  if (value.type === "walk_direction" && validDirection(value.direction)) {
    return { type: "walk_direction", direction: value.direction };
  }
  if (
    (value.type === "charge_direction" || value.type === "release_direction") &&
    validDirection(value.direction)
  ) {
    return { type: value.type, direction: value.direction };
  }
  if (value.type === "walk" && validTarget(value.target) && value.target !== null) {
    return { type: "walk", target: value.target };
  }
  if (
    (value.type === "charge" || value.type === "release") &&
    validAimTarget(value.target)
  ) {
    return { type: value.type, target: value.target };
  }
  return null;
}

function validTankAxis(value: unknown): value is -1 | 0 | 1 {
  return value === -1 || value === 0 || value === 1;
}

function validDirection(value: unknown): value is Vec2 {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y) &&
    Math.abs(value.x) <= 1 &&
    Math.abs(value.y) <= 1 &&
    Math.hypot(value.x, value.y) > 0.000001
  );
}

function validAimTarget(value: unknown): value is Vec2 {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y) &&
    value.x >= -WORLD.width &&
    value.x <= WORLD.width * 2 &&
    value.y >= -WORLD.height &&
    value.y <= WORLD.height * 2
  );
}
