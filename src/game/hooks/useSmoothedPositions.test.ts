import { describe, expect, it } from "vitest";
import { WORLD } from "../constants";
import {
  extrapolateMotionPosition,
  MAX_EXTRAPOLATION_MS,
} from "./useSmoothedPositions";

describe("multiplayer position extrapolation", () => {
  it("bridges a short snapshot gap using authoritative velocity", () => {
    const position = extrapolateMotionPosition({
      position: { x: 100, y: 100 },
      velocity: { x: 10, y: -5 },
      mode: "walking",
      target: null,
      burstDistanceRemaining: 0,
    }, 100);

    expect(position.x).toBeCloseTo(101, 8);
    expect(position.y).toBeCloseTo(99.5, 8);
  });

  it("stops predicting at the conservative horizon", () => {
    const motion = {
      position: { x: 100, y: 100 },
      velocity: { x: 10, y: 0 },
      mode: "walking" as const,
      target: null,
      burstDistanceRemaining: 0,
    };

    const atHorizon = extrapolateMotionPosition(
      motion,
      MAX_EXTRAPOLATION_MS,
    );
    const longAfterHorizon = extrapolateMotionPosition(motion, 5_000);

    expect(longAfterHorizon).toEqual(atHorizon);
    expect(atHorizon.x).toBeCloseTo(102, 8);
  });

  it("does not invent motion from an authoritative idle state", () => {
    expect(extrapolateMotionPosition({
      position: { x: 75, y: 80 },
      velocity: { x: 8, y: 0 },
      mode: "idle",
      target: null,
      burstDistanceRemaining: 0,
    }, 150)).toEqual({ x: 75, y: 80 });
  });

  it("never predicts past a walk target or remaining burst distance", () => {
    expect(extrapolateMotionPosition({
      position: { x: 40, y: 50 },
      velocity: { x: 20, y: 0 },
      mode: "walking",
      target: { x: 42, y: 50 },
      burstDistanceRemaining: 0,
    }, 200)).toEqual({ x: 42, y: 50 });

    expect(extrapolateMotionPosition({
      position: { x: 40, y: 50 },
      velocity: { x: 70, y: 0 },
      mode: "burst",
      target: null,
      burstDistanceRemaining: 3,
    }, 200)).toEqual({ x: 43, y: 50 });
  });

  it("keeps cosmetic prediction inside authoritative world bounds", () => {
    expect(extrapolateMotionPosition({
      position: { x: WORLD.width - 1, y: 0.5 },
      velocity: { x: 20, y: -20 },
      mode: "walking",
      target: null,
      burstDistanceRemaining: 0,
    }, 200)).toEqual({ x: WORLD.width, y: 0 });
  });
});
