import { describe, expect, it } from "vitest";
import {
  calculateThreeAstronautPose,
  getThreeAstronautAnimationState,
} from "./threeAstronautModel";

function movement(overrides: Record<string, unknown> = {}) {
  return {
    mode: "walking" as const,
    velocity: { x: 15.6, y: 0 },
    headingRadians: -Math.PI / 2,
    facing: { x: 0, y: -1 },
    ...overrides,
  };
}

describe("calculateThreeAstronautPose", () => {
  it("accounts for the imported model's forward axis when facing up", () => {
    expect(calculateThreeAstronautPose(movement()).headingRotation).toBeCloseTo(Math.PI);
  });

  it("turns the overhead model toward a rightward game heading", () => {
    const pose = calculateThreeAstronautPose(movement({ headingRadians: 0 }));
    expect(pose.headingRotation).toBeCloseTo(Math.PI / 2);
  });

  it("falls back to the facing vector when continuous heading is malformed", () => {
    const pose = calculateThreeAstronautPose(movement({ headingRadians: Number.NaN }));
    expect(pose.headingRotation).toBeCloseTo(Math.PI);
  });
});

describe("getThreeAstronautAnimationState", () => {
  it("uses Running only for ordinary movement with actual linear speed", () => {
    expect(getThreeAstronautAnimationState(movement())).toBe("running");
    expect(getThreeAstronautAnimationState(movement({ velocity: { x: 0, y: 0 } }))).toBe("idle");
  });

  it("uses Idle_5 while stationary or charging", () => {
    expect(getThreeAstronautAnimationState(movement({ mode: "idle" }))).toBe("idle");
    expect(getThreeAstronautAnimationState(movement({ mode: "charging" }))).toBe("idle");
  });

  it("uses Quad_Jump_Up for every authoritative burst frame", () => {
    expect(getThreeAstronautAnimationState(movement({
      mode: "burst",
      velocity: { x: 0, y: 0 },
    }))).toBe("boosting");
  });

  it("does not animate malformed velocity as running", () => {
    expect(getThreeAstronautAnimationState(movement({
      velocity: { x: Number.NaN, y: 0 },
    }))).toBe("idle");
  });
});
