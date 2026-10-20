import { describe, expect, it } from "vitest";
import { WORLD } from "../constants";
import {
  advanceSmoothedPosition,
  extrapolateMotionPosition,
  MAX_EXTRAPOLATION_MS,
  type MotionSnapshot,
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

  it("keeps 20 Hz snapshots moving uniformly on a 144 Hz render clock", () => {
    const frameMs = 1_000 / 144;
    const snapshotMs = 1_000 / 20;
    const speed = 60;
    let trackTime = 0;
    let receivedAt = 0;
    let nextSnapshotAt = snapshotMs;
    let displayed = { x: 100, y: 100 };
    let correction = { x: 0, y: 0 };
    let motion: MotionSnapshot = {
      position: { ...displayed },
      velocity: { x: speed, y: 0 },
      mode: "walking",
      target: null,
      burstDistanceRemaining: 0,
    };
    const frameDistances: number[] = [];

    for (let frame = 1; frame <= 144; frame += 1) {
      const frameAt = frame * frameMs;
      const prior = displayed;

      // Reconcile at each 20 Hz timestamp, including snapshots that land
      // between 144 Hz frames. Advance the old motion to the handoff first.
      while (nextSnapshotAt <= frameAt) {
        const advanced = advanceSmoothedPosition(
          motion,
          correction,
          nextSnapshotAt - receivedAt,
          nextSnapshotAt - trackTime,
        );
        displayed = advanced.position;
        correction = advanced.correction;

        const authoritative = {
          x: 100 + speed * nextSnapshotAt / 1_000,
          y: 100,
        };
        motion = {
          ...motion,
          position: authoritative,
        };
        receivedAt = nextSnapshotAt;
        correction = {
          x: displayed.x - authoritative.x,
          y: displayed.y - authoritative.y,
        };
        trackTime = nextSnapshotAt;
        nextSnapshotAt += snapshotMs;
      }

      const advanced = advanceSmoothedPosition(
        motion,
        correction,
        frameAt - receivedAt,
        frameAt - trackTime,
      );
      displayed = advanced.position;
      correction = advanced.correction;
      frameDistances.push(displayed.x - prior.x);
      trackTime = frameAt;
    }

    const expectedDistance = speed * frameMs / 1_000;
    expect(Math.min(...frameDistances)).toBeCloseTo(expectedDistance, 7);
    expect(Math.max(...frameDistances)).toBeCloseTo(expectedDistance, 7);
  });
});
