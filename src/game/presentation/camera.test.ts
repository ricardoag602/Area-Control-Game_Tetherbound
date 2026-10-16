import { describe, expect, it } from "vitest";
import {
  calculateCameraViewBox,
  calculateOverviewViewBox,
  calculateViewportBufferZoom,
  CAMERA_RULES,
  chargeZoomTarget,
  easeMatchEndOverview,
  interpolateCameraViewBox,
  stepCameraZoomSpring,
  type CameraZoomSpring,
} from "./camera";
import { WORLD } from "../constants";

describe("camera framing", () => {
  it("uses a responsive view centered directly on the local player", () => {
    const view = calculateCameraViewBox({ x: 50, y: 80 }, 0.5, 1);

    expect(view).toEqual({ x: 24, y: 28, width: 52, height: 104 });
  });

  it.each([
    ["top-left", { x: 0, y: 0 }, { x: 0, y: 0 }],
    [
      "bottom-right",
      { x: WORLD.width, y: WORLD.height },
      { x: WORLD.width - 52, y: WORLD.height - 104 },
    ],
  ])("locks the follow camera to the %s world edge", (_, center, origin) => {
    const view = calculateCameraViewBox(center, 0.5, 1);

    expect(view).toEqual({ ...origin, width: 52, height: 104 });
    expect(view.x).toBeGreaterThanOrEqual(0);
    expect(view.y).toBeGreaterThanOrEqual(0);
    expect(view.x + view.width).toBeLessThanOrEqual(WORLD.width);
    expect(view.y + view.height).toBeLessThanOrEqual(WORLD.height);
  });

  it("stops following near an edge so the player can move across the screen", () => {
    const center = { x: WORLD.width / 2, y: WORLD.height - 15 };
    const view = calculateCameraViewBox(center, 0.5, 1);

    expect(view.y).toBe(WORLD.height - view.height);
    expect(view.y + view.height).toBe(WORLD.height);
    expect(center.y).toBeGreaterThan(view.y + view.height / 2);
  });

  it("keeps the expanded arena zoomed for very wide viewports", () => {
    const view = calculateCameraViewBox(
      { x: WORLD.width / 2, y: WORLD.height / 2 },
      3,
      1,
    );

    expect(view).toEqual({ x: 19, y: 123, width: 312, height: 104 });
  });

  it("fits an ultrawide zoomed-out view inside the world", () => {
    const view = calculateCameraViewBox(
      { x: WORLD.width / 2, y: WORLD.height / 2 },
      4,
      CAMERA_RULES.minimumSpringZoom,
    );

    expect(view.width).toBeCloseTo(WORLD.width, 10);
    expect(view.height).toBeCloseTo(WORLD.width / 4, 10);
    expect(view.width / view.height).toBeCloseTo(4, 10);
    expect(view.x).toBeCloseTo(0, 10);
    expect(view.y).toBeGreaterThanOrEqual(0);
    expect(view.y + view.height).toBeLessThanOrEqual(WORLD.height);
  });

  it("keeps a phone portrait view within every world edge while zoomed out", () => {
    const view = calculateCameraViewBox(
      { x: WORLD.width, y: 0 },
      390 / 844,
      CAMERA_RULES.minimumSpringZoom,
    );

    expect(view.x + view.width).toBeCloseTo(WORLD.width, 10);
    expect(view.y).toBe(0);
    expect(view.x).toBeGreaterThanOrEqual(0);
    expect(view.y + view.height).toBeLessThanOrEqual(WORLD.height);
  });

  it("falls back safely for invalid aspect, center, and zoom values", () => {
    const view = calculateCameraViewBox(
      { x: Number.NaN, y: Number.POSITIVE_INFINITY },
      0,
      Number.NaN,
    );

    expect(view.x).toBeCloseTo(WORLD.width / 2 - 52, 10);
    expect(view.y).toBeCloseTo(WORLD.height / 2 - 52, 10);
    expect(view.width).toBeCloseTo(104, 10);
    expect(view.height).toBeCloseTo(104, 10);
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

describe("match-end overview", () => {
  it.each([0.5, 1, 2])(
    "centers and fits the entire arena at aspect ratio %s",
    (aspectRatio) => {
      const view = calculateOverviewViewBox(aspectRatio);

      expect(view.x + view.width / 2).toBeCloseTo(WORLD.width / 2, 10);
      expect(view.y + view.height / 2).toBeCloseTo(WORLD.height / 2, 10);
      expect(view.width).toBeGreaterThan(WORLD.width);
      expect(view.height).toBeGreaterThan(WORLD.height);
      expect(view.width / view.height).toBeCloseTo(aspectRatio, 10);
    },
  );

  it("pulls back quickly before easing into the overview", () => {
    expect(easeMatchEndOverview(0)).toBe(0);
    expect(easeMatchEndOverview(0.25)).toBeGreaterThan(0.65);
    expect(easeMatchEndOverview(0.75)).toBeGreaterThan(0.99);
    expect(easeMatchEndOverview(1)).toBe(1);
  });

  it("interpolates every view-box edge without overshooting", () => {
    const start = { x: 10, y: 20, width: 50, height: 100 };
    const end = { x: -5, y: -10, width: 400, height: 500 };

    expect(interpolateCameraViewBox(start, end, 0)).toEqual(start);
    expect(interpolateCameraViewBox(start, end, 0.5)).toEqual({
      x: 2.5,
      y: 5,
      width: 225,
      height: 300,
    });
    expect(interpolateCameraViewBox(start, end, 2)).toEqual(end);
  });
});

describe("viewport-buffer camera bonus", () => {
  it("keeps mobile and edge-to-edge layouts at the normal zoom", () => {
    expect(calculateViewportBufferZoom(390, 390)).toBe(1);
    expect(calculateViewportBufferZoom(360, 390)).toBe(1);
  });

  it("gradually reveals more arena as desktop side gutters grow", () => {
    const smallBuffer = calculateViewportBufferZoom(1_000, 800);
    const largeBuffer = calculateViewportBufferZoom(1_400, 800);

    expect(smallBuffer).toBeCloseTo(0.985, 10);
    expect(largeBuffer).toBeCloseTo(0.955, 10);
    expect(largeBuffer).toBeLessThan(smallBuffer);
  });

  it("caps the ultrawide bonus and safely ignores invalid measurements", () => {
    const maximumBonus = 1 - CAMERA_RULES.maximumViewportBufferZoomOut;

    expect(calculateViewportBufferZoom(1_600, 800)).toBe(maximumBonus);
    expect(calculateViewportBufferZoom(4_000, 800)).toBe(maximumBonus);
    expect(calculateViewportBufferZoom(Number.NaN, 0)).toBe(1);
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
