import { describe, expect, it } from "vitest";
import { createMovementState } from "../movement/movement";
import {
  ASTRONAUT_SPRITES,
  getAstronautSpriteFrame,
} from "./astronautSprites";

const TAU = Math.PI * 2;

describe("astronaut sprites", () => {
  it("maps every player slot to its requested team artwork", () => {
    expect(ASTRONAUT_SPRITES.player.idle).toContain("player-1-blue");
    expect(ASTRONAUT_SPRITES.rival.idle).toContain("player-2-red");
    expect(ASTRONAUT_SPRITES.player3.idle).toContain("player-3-green");
    expect(ASTRONAUT_SPRITES.player4.idle).toContain("player-4-yellow-gold");
  });

  it("plays idle, left, idle, right, idle across one gait cycle", () => {
    const expected = [
      "idle",
      "walk-left",
      "idle",
      "walk-right",
      "idle",
    ] as const;

    expected.forEach((frame, index) => {
      expect(getAstronautSpriteFrame(walkingAt((index + 0.5) / 5 * TAU)))
        .toBe(frame);
    });
  });

  it("wraps the gait phase without changing the sequence", () => {
    expect(getAstronautSpriteFrame(walkingAt(TAU * 1.3))).toBe("walk-left");
    expect(getAstronautSpriteFrame(walkingAt(-TAU * 0.3))).toBe("walk-right");
  });

  it("holds idle while stationary, charging, bursting, or given a bad phase", () => {
    expect(getAstronautSpriteFrame({
      ...walkingAt(TAU * 0.3),
      velocity: { x: 0, y: 0 },
    })).toBe("idle");
    expect(getAstronautSpriteFrame({
      ...walkingAt(TAU * 0.3),
      mode: "charging",
    })).toBe("idle");
    expect(getAstronautSpriteFrame({
      ...walkingAt(TAU * 0.3),
      mode: "burst",
    })).toBe("idle");
    expect(getAstronautSpriteFrame(walkingAt(Number.NaN))).toBe("idle");
  });
});

function walkingAt(gaitPhase: number) {
  return {
    ...createMovementState({ x: 0, y: -1 }),
    mode: "walking" as const,
    velocity: { x: 0, y: -1 },
    gaitPhase,
  };
}
