import { MOVEMENT_RULES } from "../movement";
import type { TankAxis, TankInput } from "../types";

const KEY_CONTROLS = {
  KeyW: "forward",
  ArrowUp: "forward",
  KeyS: "reverse",
  ArrowDown: "reverse",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
} as const;

export type KeyboardMovementCode = keyof typeof KEY_CONTROLS;
export type TankBoostCode = "KeyW" | "ArrowUp" | "KeyS" | "ArrowDown";

export interface KeyboardTap {
  code: KeyboardMovementCode;
  pressedAt: number;
  releasedAt: number;
}

export function isKeyboardMovementCode(code: string): code is KeyboardMovementCode {
  return Object.prototype.hasOwnProperty.call(KEY_CONTROLS, code);
}

export function isTankBoostCode(code: string): code is TankBoostCode {
  return code === "KeyW" ||
    code === "ArrowUp" ||
    code === "KeyS" ||
    code === "ArrowDown";
}

export function getTankInput(codes: Iterable<string>): TankInput {
  const pressed = new Set(codes);
  const left = pressed.has("KeyA") || pressed.has("ArrowLeft");
  const right = pressed.has("KeyD") || pressed.has("ArrowRight");
  const forward = pressed.has("KeyW") || pressed.has("ArrowUp");
  const reverse = pressed.has("KeyS") || pressed.has("ArrowDown");

  return {
    throttle: (Number(forward) - Number(reverse)) as TankAxis,
    steering: (Number(right) - Number(left)) as TankAxis,
  };
}

export function isKeyboardBoostDoubleTap(
  previousTap: KeyboardTap | null,
  code: KeyboardMovementCode,
  pressedAt: number,
) {
  if (!isTankBoostCode(code) || !previousTap || previousTap.code !== code) {
    return false;
  }
  const heldFor = previousTap.releasedAt - previousTap.pressedAt;
  const pauseBeforeSecondPress = pressedAt - previousTap.releasedAt;
  return heldFor >= 0 &&
    heldFor <= MOVEMENT_RULES.keyboardBoostTapMaximumMs &&
    pauseBeforeSecondPress >= 0 &&
    pauseBeforeSecondPress <= MOVEMENT_RULES.keyboardBoostDoubleTapMs;
}

export function isGameplayKeyboardBlockedElement(
  tagName: string,
  isContentEditable: boolean,
  role: string | null = null,
) {
  return isContentEditable ||
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT" ||
    role === "textbox";
}

/**
 * Keeps gameplay shortcuts out of fields where a player may be typing or
 * adjusting a value. Ordinary buttons and links deliberately remain eligible:
 * their Enter/Space activation still works, while the game's own keys remain
 * available after a HUD click.
 */
export function isGameplayKeyboardBlockedTarget(target: EventTarget | null) {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) {
    return false;
  }
  return isGameplayKeyboardBlockedElement(
    target.tagName,
    target.isContentEditable,
    target.getAttribute("role"),
  );
}
