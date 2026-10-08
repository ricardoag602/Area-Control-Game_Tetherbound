import { MOVEMENT_RULES } from "../movement";
import type { Vec2 } from "../types";

const KEY_DIRECTIONS = {
  KeyW: { x: 0, y: -1 },
  ArrowUp: { x: 0, y: -1 },
  KeyS: { x: 0, y: 1 },
  ArrowDown: { x: 0, y: 1 },
  KeyA: { x: -1, y: 0 },
  ArrowLeft: { x: -1, y: 0 },
  KeyD: { x: 1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
} as const satisfies Record<string, Vec2>;

export type KeyboardMovementCode = keyof typeof KEY_DIRECTIONS;

export interface KeyboardTap {
  code: KeyboardMovementCode;
  pressedAt: number;
  releasedAt: number;
}

export function isKeyboardMovementCode(code: string): code is KeyboardMovementCode {
  return Object.prototype.hasOwnProperty.call(KEY_DIRECTIONS, code);
}

export function getKeyboardDirection(codes: Iterable<string>): Vec2 | null {
  const pressed = new Set(codes);
  const left = pressed.has("KeyA") || pressed.has("ArrowLeft");
  const right = pressed.has("KeyD") || pressed.has("ArrowRight");
  const up = pressed.has("KeyW") || pressed.has("ArrowUp");
  const down = pressed.has("KeyS") || pressed.has("ArrowDown");
  const x = Number(right) - Number(left);
  const y = Number(down) - Number(up);

  const length = Math.hypot(x, y);
  if (length === 0) return null;
  return { x: x / length, y: y / length };
}

export function isKeyboardBoostDoubleTap(
  previousTap: KeyboardTap | null,
  code: KeyboardMovementCode,
  pressedAt: number,
) {
  if (!previousTap || previousTap.code !== code) return false;
  const heldFor = previousTap.releasedAt - previousTap.pressedAt;
  const pauseBeforeSecondPress = pressedAt - previousTap.releasedAt;
  return heldFor >= 0 &&
    heldFor <= MOVEMENT_RULES.keyboardBoostTapMaximumMs &&
    pauseBeforeSecondPress >= 0 &&
    pauseBeforeSecondPress <= MOVEMENT_RULES.keyboardBoostDoubleTapMs;
}

export function isKeyboardMovementBlockedTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.tagName === "BUTTON" ||
    (target.tagName === "A" && target.hasAttribute("href"));
}
