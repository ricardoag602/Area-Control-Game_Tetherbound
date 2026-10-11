import { describe, expect, it } from "vitest";
import {
  calculateCameraViewBox,
  CAMERA_RULES,
  chargeZoomTarget,
  stepCameraZoomSpring,
  type CameraZoomSpring,
} from "./camera";
import { WORLD } from "../constants";

describe("camera framing", () => {
  it("uses a responsive view centered directly on the local player", () => {
    const view = calculateCameraViewBox({ x: 50, y: 80 }, 0.5, 1);

    expect(view).toEqual({ x: 26, y: 32, width: 48, height: 96 });
  });

  it("keeps the player center-locked by allowing overscan at world edges", () => {
    const center = { x: WORLD.width / 2, y: WORLD.height - 15 };
    const view = calculateCameraViewBox(center, 0.5, 1);

    expect(view.y).toBe(center.y - 48);
    expect(view.y + view.height).toBe(WORLD.height + 33);
  });

  it("fits very wide viewports to the world width", () => {
    const view = calculateCameraViewBox(
      { x: WORLD.width / 2, y: WORLD.height / 2 },
      3,
      1,
    );

    expect(view).toEqual({
      x: 0,
      y: WORLD.height / 2 - WORLD.width / 6,
      width: WORLD.width,
      height: WORLD.width / 3,
    });
  });

  it("falls back safely for invalid aspect, center, and zoom values", () => {
    const view = calculateCameraViewBox(
      { x: Number.NaN, y: Number.POSITIVE_INFINITY },
      0,
      Number.NaN,
    );

    expect(view.x).toBeCloseTo(WORLD.width / 2 - 28.8, 10);
    expect(view.y).toBeCloseTo(WORLD.height / 2 - 48, 10);
    expect(view.width).toBeCloseTo(57.6, 10);
    expect(view.height).toBeCloseTo(96, 10);
    expect(Object.values(view).every(Number.isFinite)).toBe(true);
  });

  it("shrinks the visible area uniformly as zoom increases", () => {
    const resting = calculateCameraViewBox({ x: 50, y: 80 }, 0.5, 1);
    const charged = calculateCameraViewBox({ x: 50, y: 80 }, 0.5, 1.1);

    expect(charged.width).toBeCloseTo(resting.width / 1.1, 10);
    expect(charged.height).toBeCloseTo(resting.height / 1.1, 10);
    expect(charged.x + charged.width / 2).toBeCloseTo(50, 10);
    expect(charged.y + charged.height / 2).toBeCloseTo(80, 10);
  });

  it("reveals a meaningfully wider route at full boost charge", () => {
    const resting = calculateCameraViewBox({ x: 50, y: 80 }, 0.5, 1);
    const charged = calculateCameraViewBox(
      { x: 50, y: 80 },
      0.5,
      chargeZoomTarget(1),
    );

    expect(charged.height).toBeGreaterThan(resting.height * 1.15);
    expect(charged.width).toBeGreaterThan(resting.width * 1.15);
  });
});

describe("charge zoom curve", () => {
  it("has exact resting and fully charged endpoints", () => {
    expect(chargeZoomTarget(0)).toBe(1);
    expect(chargeZoomTarget(1)).toBeCloseTo(
      1 - CAMERA_RULES.maximumChargeZoomOut,
      12,
    );
  });

  it("clamps invalid and out-of-range progress", () => {
    expect(chargeZoomTarget(Number.NaN)).toBe(1);
    expect(chargeZoomTarget(-1)).toBe(1);
    expect(chargeZoomTarget(2)).toBeCloseTo(
      1 - CAMERA_RULES.maximumChargeZoomOut,
      12,
    );
  });

  it("falls monotonically with diminishing outward increments", () => {
    const samples = [0, 0.25, 0.5, 0.75, 1].map(chargeZoomTarget);
    const increments = samples.slice(1).map(
      (sample, index) => samples[index] - sample,
    );

    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]).toBeLessThan(samples[index - 1]);
    }
    for (let index = 1; index < increments.length; index += 1) {
      expect(increments[index]).toBeLessThan(increments[index - 1]);
    }
  });
});

describe("camera zoom spring", () => {
  it("settles smoothly on a charged target", () => {
    const target = chargeZoomTarget(1);
    let spring: CameraZoomSpring = { zoom: 1, velocity: 0 };

    for (let frame = 0; frame < 180; frame += 1) {
      spring = stepCameraZoomSpring(spring, target, 1 / 60);
      expect(spring.zoom).toBeGreaterThanOrEqual(CAMERA_RULES.minimumSpringZoom);
      expect(spring.zoom).toBeLessThanOrEqual(CAMERA_RULES.maximumSpringZoom);
    }

    expect(spring).toEqual({ zoom: target, velocity: 0 });
  });

  it("springs back to rest after launch", () => {
    let spring: CameraZoomSpring = {
      zoom: chargeZoomTarget(1),
      velocity: 0,
    };

    for (let frame = 0; frame < 180; frame += 1) {
      spring = stepCameraZoomSpring(spring, 1, 1 / 60);
    }

    expect(spring).toEqual({ zoom: 1, velocity: 0 });
  });

  it("caps delayed frames to a stable integration step", () => {
    const spring = { zoom: 1, velocity: 0 };
    const target = chargeZoomTarget(1);

    expect(stepCameraZoomSpring(spring, target, 10)).toEqual(
      stepCameraZoomSpring(
        spring,
        target,
        CAMERA_RULES.maximumSpringDeltaSeconds,
      ),
    );
  });

  it("sanitizes invalid state and never leaves its zoom bounds", () => {
    const sanitized = stepCameraZoomSpring(
      { zoom: Number.NaN, velocity: Number.NaN },
      Number.POSITIVE_INFINITY,
      Number.NaN,
    );
    const bounded = stepCameraZoomSpring(
      { zoom: CAMERA_RULES.maximumSpringZoom, velocity: 100 },
      chargeZoomTarget(1),
      1 / 30,
    );

    expect(sanitized).toEqual({ zoom: 1, velocity: 0 });
    expect(bounded.zoom).toBe(CAMERA_RULES.maximumSpringZoom);
    expect(bounded.velocity).toBe(0);
  });
});
