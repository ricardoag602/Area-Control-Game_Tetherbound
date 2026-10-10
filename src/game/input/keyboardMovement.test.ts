import { describe, expect, it } from "vitest";
import { MOVEMENT_RULES } from "../movement/movement";
import {
  getTankInput,
  isGameplayKeyboardBlockedElement,
  isKeyboardBoostDoubleTap,
  isKeyboardBoostTap,
  isKeyboardMovementCode,
  isTankBoostCode,
  type KeyboardTap,
} from "./keyboardMovement";

describe("keyboard movement input", () => {
  it.each([
    ["KeyW", { throttle: 1, steering: 0 }],
    ["ArrowUp", { throttle: 1, steering: 0 }],
    ["KeyS", { throttle: -1, steering: 0 }],
    ["ArrowDown", { throttle: -1, steering: 0 }],
    ["KeyA", { throttle: 0, steering: -1 }],
    ["ArrowLeft", { throttle: 0, steering: -1 }],
    ["KeyD", { throttle: 0, steering: 1 }],
    ["ArrowRight", { throttle: 0, steering: 1 }],
  ] as const)("maps %s to its tank-control axis", (code, expected) => {
    expect(isKeyboardMovementCode(code)).toBe(true);
    expect(getTankInput(new Set([code]))).toEqual(expected);
  });

  it("keeps throttle and steering independent for a moving turn", () => {
    expect(getTankInput(new Set(["KeyW", "KeyD"]))).toEqual({
      throttle: 1,
      steering: 1,
    });
    expect(getTankInput(new Set(["KeyS", "KeyA"]))).toEqual({
      throttle: -1,
      steering: -1,
    });
  });

  it("treats duplicate aliases as one input instead of doubling an axis", () => {
    expect(getTankInput(new Set(["KeyW", "ArrowUp", "KeyD", "ArrowRight"])))
      .toEqual({ throttle: 1, steering: 1 });
  });

  it("cancels opposing keys per axis while preserving the other axis", () => {
    expect(getTankInput(new Set(["KeyW", "KeyS", "KeyD"]))).toEqual({
      throttle: 0,
      steering: 1,
    });
    expect(getTankInput(new Set(["KeyA", "KeyD", "ArrowUp"]))).toEqual({
      throttle: 1,
      steering: 0,
    });
    expect(
      getTankInput(new Set(["KeyW", "KeyS", "KeyA", "KeyD"])),
    ).toEqual({ throttle: 0, steering: 0 });
  });

  it("ignores unknown codes and returns neutral axes when no input remains", () => {
    expect(isKeyboardMovementCode("Space")).toBe(false);
    expect(isKeyboardMovementCode("w")).toBe(false);
    expect(isKeyboardMovementCode("toString")).toBe(false);
    expect(getTankInput(new Set(["Space", "ShiftLeft"]))).toEqual({
      throttle: 0,
      steering: 0,
    });
    expect(getTankInput(new Set(["Space", "ArrowRight"]))).toEqual({
      throttle: 0,
      steering: 1,
    });
  });

  it.each(["INPUT", "TEXTAREA", "SELECT"])(
    "blocks gameplay shortcuts from a %s field",
    (tagName) => {
      expect(isGameplayKeyboardBlockedElement(tagName, false)).toBe(true);
    },
  );

  it("blocks editable and textbox-role targets", () => {
    expect(isGameplayKeyboardBlockedElement("DIV", true)).toBe(true);
    expect(isGameplayKeyboardBlockedElement("DIV", false, "textbox")).toBe(true);
  });

  it.each(["BUTTON", "A", "DIV", "SVG"])(
    "keeps gameplay shortcuts active from a %s target",
    (tagName) => {
      expect(isGameplayKeyboardBlockedElement(tagName, false)).toBe(false);
    },
  );

  it.each(["KeyW", "ArrowUp", "KeyS", "ArrowDown"])(
    "allows %s to trigger a tank boost",
    (code) => expect(isTankBoostCode(code)).toBe(true),
  );

  it.each(["KeyA", "ArrowLeft", "KeyD", "ArrowRight", "Space"])(
    "does not allow %s to trigger a tank boost",
    (code) => expect(isTankBoostCode(code)).toBe(false),
  );

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
        tap.pressedAt + MOVEMENT_RULES.keyboardBoostDoubleTapMs,
      )).toBe(true);
    });

    it("only classifies the short opening press as a tap", () => {
      expect(isKeyboardBoostTap(
        1_000,
        1_000 + MOVEMENT_RULES.keyboardBoostTapMaximumMs,
      )).toBe(true);
      expect(isKeyboardBoostTap(
        1_000,
        1_000 + MOVEMENT_RULES.keyboardBoostTapMaximumMs + 0.001,
      )).toBe(false);
      expect(isKeyboardBoostTap(1_000, Number.POSITIVE_INFINITY)).toBe(false);
    });

    it("does not let holding the first press extend the double-tap window", () => {
      const secondPress = tap.releasedAt + 170;

      expect(secondPress - tap.releasedAt).toBeLessThan(
        MOVEMENT_RULES.keyboardBoostDoubleTapMs,
      );
      expect(secondPress - tap.pressedAt).toBeGreaterThan(
        MOVEMENT_RULES.keyboardBoostDoubleTapMs,
      );
      expect(isKeyboardBoostDoubleTap(tap, "KeyW", secondPress)).toBe(false);
    });

    it.each(["KeyW", "ArrowUp", "KeyS", "ArrowDown"] as const)(
      "accepts a short same-key %s double tap",
      (code) => {
        const directionalTap: KeyboardTap = {
          code,
          pressedAt: 1_000,
          releasedAt: 1_080,
        };
        expect(isKeyboardBoostDoubleTap(
          directionalTap,
          code,
          directionalTap.releasedAt + 80,
        )).toBe(true);
      },
    );

    it("requires the same event code rather than a directional alias", () => {
      expect(isKeyboardBoostDoubleTap(tap, "ArrowUp", tap.releasedAt + 100))
        .toBe(false);
      expect(isKeyboardBoostDoubleTap(null, "KeyW", tap.releasedAt + 100))
        .toBe(false);
    });

    it("never arms a boost from a steering key", () => {
      const steeringTap: KeyboardTap = {
        code: "KeyA",
        pressedAt: 1_000,
        releasedAt: 1_100,
      };

      expect(isKeyboardBoostDoubleTap(steeringTap, "KeyA", 1_200)).toBe(false);
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
        pressedAt: tap.pressedAt + MOVEMENT_RULES.keyboardBoostDoubleTapMs + 1,
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
      {
        label: "first press timestamp is not finite",
        previousTap: { ...tap, pressedAt: Number.NaN },
        pressedAt: tap.releasedAt + 100,
      },
      {
        label: "first release timestamp is not finite",
        previousTap: { ...tap, releasedAt: Number.POSITIVE_INFINITY },
        pressedAt: tap.releasedAt + 100,
      },
      {
        label: "second press timestamp is not finite",
        previousTap: tap,
        pressedAt: Number.NaN,
      },
    ])("rejects when the $label", ({ previousTap, pressedAt }) => {
      expect(isKeyboardBoostDoubleTap(previousTap, "KeyW", pressedAt)).toBe(false);
    });

    it("rejects both timing windows immediately beyond their boundaries", () => {
      const tooLongTap: KeyboardTap = {
        ...tap,
        releasedAt:
          tap.pressedAt + MOVEMENT_RULES.keyboardBoostTapMaximumMs + 0.001,
      };

      expect(isKeyboardBoostDoubleTap(
        tooLongTap,
        "KeyW",
        tooLongTap.releasedAt,
      )).toBe(false);
      expect(isKeyboardBoostDoubleTap(
        tap,
        "KeyW",
        tap.pressedAt + MOVEMENT_RULES.keyboardBoostDoubleTapMs + 0.001,
      )).toBe(false);
    });
  });
});
