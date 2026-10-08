import { describe, expect, it } from "vitest";
import { MOVEMENT_RULES } from "../movement";
import {
  getKeyboardDirection,
  isKeyboardBoostDoubleTap,
  isKeyboardMovementCode,
  type KeyboardTap,
} from "./keyboardMovement";

const SQRT_HALF = Math.SQRT1_2;

describe("keyboard movement input", () => {
  it.each([
    ["KeyW", { x: 0, y: -1 }],
    ["ArrowUp", { x: 0, y: -1 }],
    ["KeyS", { x: 0, y: 1 }],
    ["ArrowDown", { x: 0, y: 1 }],
    ["KeyA", { x: -1, y: 0 }],
    ["ArrowLeft", { x: -1, y: 0 }],
    ["KeyD", { x: 1, y: 0 }],
    ["ArrowRight", { x: 1, y: 0 }],
  ] as const)("maps %s to its cardinal direction", (code, expected) => {
    expect(isKeyboardMovementCode(code)).toBe(true);
    expect(getKeyboardDirection(new Set([code]))).toEqual(expected);
  });

  it("normalizes diagonal movement so it is not faster than a cardinal direction", () => {
    const direction = getKeyboardDirection(new Set(["KeyW", "KeyD"]));

    expect(direction).not.toBeNull();
    expect(direction?.x).toBeCloseTo(SQRT_HALF, 10);
    expect(direction?.y).toBeCloseTo(-SQRT_HALF, 10);
    expect(Math.hypot(direction?.x ?? 0, direction?.y ?? 0)).toBeCloseTo(1, 10);
  });

  it("treats duplicate aliases as one direction instead of skewing a diagonal", () => {
    const direction = getKeyboardDirection(
      new Set(["KeyW", "ArrowUp", "KeyD"]),
    );

    expect(direction?.x).toBeCloseTo(SQRT_HALF, 10);
    expect(direction?.y).toBeCloseTo(-SQRT_HALF, 10);
  });

  it("cancels opposing keys per axis while preserving the other axis", () => {
    expect(getKeyboardDirection(new Set(["KeyW", "KeyS", "KeyD"]))).toEqual({
      x: 1,
      y: 0,
    });
    expect(getKeyboardDirection(new Set(["KeyA", "KeyD", "ArrowUp"]))).toEqual({
      x: 0,
      y: -1,
    });
    expect(
      getKeyboardDirection(new Set(["KeyW", "KeyS", "KeyA", "KeyD"])),
    ).toBeNull();
  });

  it("ignores unknown codes and returns null when no movement remains", () => {
    expect(isKeyboardMovementCode("Space")).toBe(false);
    expect(isKeyboardMovementCode("w")).toBe(false);
    expect(isKeyboardMovementCode("toString")).toBe(false);
    expect(getKeyboardDirection(new Set(["Space", "ShiftLeft"]))).toBeNull();
    expect(getKeyboardDirection(new Set(["Space", "ArrowRight"]))).toEqual({
      x: 1,
      y: 0,
    });
  });

  describe("double-tap boost gesture", () => {
    const tap: KeyboardTap = {
      code: "KeyW",
      pressedAt: 1_000,
      releasedAt: 1_000 + MOVEMENT_RULES.keyboardBoostTapMaximumMs,
    };

    it("accepts the same physical key at the inclusive timing limits", () => {
      expect(isKeyboardBoostDoubleTap(
        tap,
        "KeyW",
        tap.releasedAt + MOVEMENT_RULES.keyboardBoostDoubleTapMs,
      )).toBe(true);
    });

    it("requires the same event code rather than a directional alias", () => {
      expect(isKeyboardBoostDoubleTap(tap, "ArrowUp", tap.releasedAt + 100))
        .toBe(false);
      expect(isKeyboardBoostDoubleTap(null, "KeyW", tap.releasedAt + 100))
        .toBe(false);
    });

    it.each([
      {
        label: "first press was held too long",
        previousTap: {
          ...tap,
          releasedAt: tap.pressedAt + MOVEMENT_RULES.keyboardBoostTapMaximumMs + 1,
        },
        pressedAt: tap.pressedAt + MOVEMENT_RULES.keyboardBoostTapMaximumMs + 101,
      },
      {
        label: "second press arrived too late",
        previousTap: tap,
        pressedAt: tap.releasedAt + MOVEMENT_RULES.keyboardBoostDoubleTapMs + 1,
      },
      {
        label: "release timestamp predates the first press",
        previousTap: { ...tap, releasedAt: tap.pressedAt - 1 },
        pressedAt: tap.pressedAt + 100,
      },
      {
        label: "second press timestamp predates the first release",
        previousTap: tap,
        pressedAt: tap.releasedAt - 1,
      },
    ])("rejects when the $label", ({ previousTap, pressedAt }) => {
      expect(isKeyboardBoostDoubleTap(previousTap, "KeyW", pressedAt)).toBe(false);
    });
  });
});
