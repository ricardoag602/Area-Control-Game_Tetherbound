import { describe, expect, it } from "vitest";
import {
  CHARGE_STEERING_DEAD_ZONE_RADIANS,
  getDirectTouchChargeTarget,
  getScreenTouchChargeInput,
  getTankChargeInput,
  isTouchBoostDoubleTap,
  isTouchBoostTap,
  usesDirectTouchCharge,
  type TouchBoostTap,
} from "./touchCharge";
import { MOVEMENT_RULES } from "../movement/movement";

const FACING_UP = { x: 0, y: -1 };

describe("screen-wide touch charge", () => {
  it.each(["touch", "pen"])(
    "allows a %s pointer to start a direct charge anywhere",
    (pointerType) => expect(usesDirectTouchCharge(pointerType)).toBe(true),
  );

  it.each(["mouse", "", "unknown"])(
    "does not replace %s pointer controls with screen-wide touch charging",
    (pointerType) => expect(usesDirectTouchCharge(pointerType)).toBe(false),
  );

  describe("double-tap activation", () => {
    const firstTap: TouchBoostTap = {
      pointerType: "touch",
      pressedAt: 1_000,
      releasedAt: 1_100,
      position: { x: 120, y: 240 },
    };

    it("accepts a short first tap followed by a nearby second press", () => {
      expect(isTouchBoostTap(
        firstTap.pressedAt,
        firstTap.releasedAt,
        firstTap.position,
        firstTap.position,
      )).toBe(true);
      expect(isTouchBoostDoubleTap(
        firstTap,
        "touch",
        { x: 140, y: 250 },
        1_260,
      )).toBe(true);
    });

    it("never classifies one long hold as the first tap", () => {
      const releasedAt = firstTap.pressedAt +
        MOVEMENT_RULES.touchBoostTapMaximumMs + 0.001;

      expect(isTouchBoostTap(
        firstTap.pressedAt,
        releasedAt,
        firstTap.position,
        firstTap.position,
      )).toBe(false);
      expect(isTouchBoostDoubleTap(
        { ...firstTap, releasedAt },
        "touch",
        firstTap.position,
        releasedAt + 20,
      )).toBe(false);
    });

    it("measures the complete double tap from the first pointer-down", () => {
      expect(isTouchBoostDoubleTap(
        firstTap,
        "touch",
        firstTap.position,
        firstTap.pressedAt + MOVEMENT_RULES.touchBoostDoubleTapMs,
      )).toBe(true);
      expect(isTouchBoostDoubleTap(
        firstTap,
        "touch",
        firstTap.position,
        firstTap.pressedAt + MOVEMENT_RULES.touchBoostDoubleTapMs + 0.001,
      )).toBe(false);
    });

    it("rejects a distant second touch instead of charging accidentally", () => {
      expect(isTouchBoostDoubleTap(
        firstTap,
        "touch",
        {
          x: firstTap.position.x +
            MOVEMENT_RULES.touchBoostDoubleTapDistancePx + 0.001,
          y: firstTap.position.y,
        },
        1_200,
      )).toBe(false);
    });

    it.each([
      { label: "different pointer type", pointerType: "pen", pressedAt: 1_200 },
      { label: "mouse input", pointerType: "mouse", pressedAt: 1_200 },
      { label: "overlapping timestamps", pointerType: "touch", pressedAt: 1_050 },
      { label: "invalid timestamp", pointerType: "touch", pressedAt: Number.NaN },
    ])("rejects a $label", ({ pointerType, pressedAt }) => {
      expect(isTouchBoostDoubleTap(
        firstTap,
        pointerType,
        firstTap.position,
        pressedAt,
      )).toBe(false);
    });

    it("rejects a first tap that slides beyond touch slop", () => {
      expect(isTouchBoostTap(
        1_000,
        1_100,
        { x: 100, y: 100 },
        { x: 100 + MOVEMENT_RULES.touchGestureSlopPx + 0.001, y: 100 },
      )).toBe(false);
    });
  });

  it.each([
    { touch: { x: 30, y: 10 }, expected: { x: 22, y: 10 } },
    { touch: { x: -10, y: 10 }, expected: { x: -2, y: 10 } },
    { touch: { x: 10, y: 30 }, expected: { x: 10, y: 22 } },
    { touch: { x: 10, y: -10 }, expected: { x: 10, y: -2 } },
  ])("points the charge from the astronaut toward $touch", ({ touch, expected }) => {
    expect(getDirectTouchChargeTarget(
      { x: 10, y: 10 },
      touch,
      FACING_UP,
      12,
    )).toEqual(expected);
  });

  it("normalizes a diagonal screen touch into the same fixed aim distance", () => {
    const target = getDirectTouchChargeTarget(
      { x: 10, y: 10 },
      { x: 30, y: 30 },
      FACING_UP,
      12,
    );

    expect(target.x).toBeCloseTo(10 + Math.SQRT1_2 * 12, 10);
    expect(target.y).toBeCloseTo(10 + Math.SQRT1_2 * 12, 10);
  });

  it.each([
    { label: "the astronaut itself", touch: { x: 10, y: 10 } },
    { label: "an invalid coordinate", touch: { x: Number.NaN, y: 20 } },
  ])("uses the current direction when touching $label", ({ touch }) => {
    expect(getDirectTouchChargeTarget(
      { x: 10, y: 10 },
      touch,
      { x: 1, y: 0 },
      12,
    )).toEqual({ x: 22, y: 10 });
  });

  it.each([
    {
      label: "ahead",
      touch: { x: 10, y: -30 },
      expected: { throttle: 1, steering: 0 },
    },
    {
      label: "left",
      touch: { x: -30, y: 10 },
      expected: { throttle: 1, steering: -1 },
    },
    {
      label: "right",
      touch: { x: 30, y: 10 },
      expected: { throttle: 1, steering: 1 },
    },
  ])("maps a touch $label into desktop tank-charge input", ({ touch, expected }) => {
    expect(getScreenTouchChargeInput(
      FACING_UP,
      { x: 10, y: 10 },
      touch,
      FACING_UP,
    )).toEqual(expected);
  });

  it("settles touch steering when the astronaut faces the finger", () => {
    expect(getScreenTouchChargeInput(
      { x: 1, y: 0 },
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      FACING_UP,
    )).toEqual({ throttle: 1, steering: 0 });
  });
});

describe("tank-style pointer charge steering", () => {
  it("holds a forward charge when the finger stays ahead", () => {
    expect(getTankChargeInput(FACING_UP, FACING_UP, true)).toEqual({
      throttle: 1,
      steering: 0,
    });
  });

  it("turns toward an aimed point on the astronaut's left", () => {
    expect(getTankChargeInput(FACING_UP, { x: -1, y: 0 }, true)).toEqual({
      throttle: 1,
      steering: -1,
    });
  });

  it("turns toward an aimed point on the astronaut's right", () => {
    expect(getTankChargeInput(FACING_UP, { x: 1, y: 0 }, true)).toEqual({
      throttle: 1,
      steering: 1,
    });
  });

  it("keeps steering neutral without a deliberate aim", () => {
    expect(getTankChargeInput(FACING_UP, { x: 1, y: 0 }, false)).toEqual({
      throttle: 1,
      steering: 0,
    });
  });

  it.each([-1, 1])(
    "ignores a %s degree wobble inside the angular dead zone",
    (degrees) => {
      const radians = degrees * Math.PI / 180;
      const aim = {
        x: Math.sin(radians),
        y: -Math.cos(radians),
      };

      expect(getTankChargeInput(FACING_UP, aim, true)).toEqual({
        throttle: 1,
        steering: 0,
      });
    },
  );

  it.each([-1, 1])(
    "stays neutral at the exact %s dead-zone boundary",
    (sign) => {
      const radians = sign * CHARGE_STEERING_DEAD_ZONE_RADIANS;
      const aim = { x: Math.sin(radians), y: -Math.cos(radians) };

      expect(getTankChargeInput(FACING_UP, aim, true)).toEqual({
        throttle: 1,
        steering: 0,
      });
    },
  );

  it.each([-1, 1])(
    "steers at once just beyond the %s dead-zone boundary",
    (sign) => {
      const radians = sign *
        (CHARGE_STEERING_DEAD_ZONE_RADIANS + 0.000001);
      const aim = { x: Math.sin(radians), y: -Math.cos(radians) };

      expect(getTankChargeInput(FACING_UP, aim, true)).toEqual({
        throttle: 1,
        steering: sign,
      });
    },
  );

  it.each([
    { label: "zero-length", aim: { x: 0, y: 0 } },
    { label: "non-finite", aim: { x: Number.NaN, y: Number.POSITIVE_INFINITY } },
  ])("falls back to neutral steering for a $label aim", ({ aim }) => {
    expect(getTankChargeInput(FACING_UP, aim, true)).toEqual({
      throttle: 1,
      steering: 0,
    });
  });
});
