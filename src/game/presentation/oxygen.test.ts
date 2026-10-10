import { describe, expect, it } from "vitest";
import {
  calculateOxygenPresentation,
  normalizeOxygen,
  OXYGEN_PRESENTATION_RULES,
} from "./oxygen";

describe("oxygen normalization", () => {
  it.each([
    { oxygen: 100, maximum: 100, expected: 1 },
    { oxygen: 75, maximum: 100, expected: 0.75 },
    { oxygen: 40, maximum: 100, expected: 0.4 },
    { oxygen: 0, maximum: 100, expected: 0 },
    { oxygen: -25, maximum: 100, expected: 0 },
    { oxygen: 125, maximum: 100, expected: 1 },
  ])(
    "normalizes $oxygen of $maximum to $expected",
    ({ oxygen, maximum, expected }) => {
      expect(normalizeOxygen(oxygen, maximum)).toBe(expected);
    },
  );

  it.each([
    { oxygen: 50, maximum: 0 },
    { oxygen: 50, maximum: -100 },
    { oxygen: 50, maximum: Number.NaN },
    { oxygen: 50, maximum: Number.POSITIVE_INFINITY },
    { oxygen: Number.NaN, maximum: 100 },
  ])("uses a safe view for malformed input %#", ({ oxygen, maximum }) => {
    expect(normalizeOxygen(oxygen, maximum)).toBe(1);
  });

  it("clamps infinite oxygen amounts to the appropriate endpoint", () => {
    expect(normalizeOxygen(Number.POSITIVE_INFINITY, 100)).toBe(1);
    expect(normalizeOxygen(Number.NEGATIVE_INFINITY, 100)).toBe(0);
  });
});

describe("oxygen presentation", () => {
  it("preserves the normal view at and above the safe threshold", () => {
    for (const oxygen of [100, 75, 40]) {
      expect(calculateOxygenPresentation(oxygen, 100)).toEqual({
        normalizedOxygen: oxygen / 100,
        lowOxygenIntensity: 0,
        cameraZoomOffset: 0,
        cameraZoomMultiplier: 1,
        redVignetteOpacity: 0,
        redWashOpacity: 0,
      });
    }
  });

  it("reaches the exact bounded effect caps at zero oxygen", () => {
    const presentation = calculateOxygenPresentation(0, 100);

    expect(presentation).toEqual({
      normalizedOxygen: 0,
      lowOxygenIntensity: 1,
      cameraZoomOffset:
        OXYGEN_PRESENTATION_RULES.maximumCameraZoomOffset,
      cameraZoomMultiplier:
        1 + OXYGEN_PRESENTATION_RULES.maximumCameraZoomOffset,
      redVignetteOpacity:
        OXYGEN_PRESENTATION_RULES.maximumRedVignetteOpacity,
      redWashOpacity: OXYGEN_PRESENTATION_RULES.maximumRedWashOpacity,
    });
  });

  it("uses a gentle eased midpoint below the warning threshold", () => {
    const presentation = calculateOxygenPresentation(20, 100);

    expect(presentation.normalizedOxygen).toBe(0.2);
    expect(presentation.lowOxygenIntensity).toBeCloseTo(0.5, 10);
    expect(presentation.cameraZoomOffset).toBeCloseTo(0.025, 10);
    expect(presentation.cameraZoomMultiplier).toBeCloseTo(1.025, 10);
    expect(presentation.redVignetteOpacity).toBeCloseTo(0.36, 10);
    expect(presentation.redWashOpacity).toBeCloseTo(0.035, 10);
  });

  it("eases in and out without a harsh jump at either endpoint", () => {
    const justLow = calculateOxygenPresentation(39, 100);
    const nearlyEmpty = calculateOxygenPresentation(1, 100);

    expect(justLow.lowOxygenIntensity).toBeGreaterThan(0);
    expect(justLow.lowOxygenIntensity).toBeLessThan(0.002);
    expect(nearlyEmpty.lowOxygenIntensity).toBeGreaterThan(0.998);
    expect(nearlyEmpty.lowOxygenIntensity).toBeLessThan(1);
  });

  it("lets the vignette lead the more subtle full-screen wash", () => {
    for (const oxygen of [39, 30, 20, 10, 1]) {
      const presentation = calculateOxygenPresentation(oxygen, 100);

      expect(presentation.redVignetteOpacity).toBeGreaterThan(
        presentation.redWashOpacity,
      );
    }
  });

  it("intensifies monotonically as oxygen depletes", () => {
    const samples = [40, 35, 30, 25, 20, 15, 10, 5, 0].map((oxygen) =>
      calculateOxygenPresentation(oxygen, 100)
    );

    for (let index = 1; index < samples.length; index += 1) {
      const previous = samples[index - 1];
      const current = samples[index];

      expect(current.normalizedOxygen).toBeLessThan(previous.normalizedOxygen);
      expect(current.lowOxygenIntensity).toBeGreaterThan(
        previous.lowOxygenIntensity,
      );
      expect(current.cameraZoomMultiplier).toBeGreaterThan(
        previous.cameraZoomMultiplier,
      );
      expect(current.redVignetteOpacity).toBeGreaterThan(
        previous.redVignetteOpacity,
      );
      expect(current.redWashOpacity).toBeGreaterThan(
        previous.redWashOpacity,
      );
    }
  });

  it("returns finite, bounded values across malformed and extreme inputs", () => {
    const values = [
      Number.NEGATIVE_INFINITY,
      -Number.MAX_VALUE,
      -1,
      0,
      Number.MIN_VALUE,
      1,
      Number.MAX_VALUE,
      Number.POSITIVE_INFINITY,
      Number.NaN,
    ];

    for (const oxygen of values) {
      for (const maximum of values) {
        const presentation = calculateOxygenPresentation(oxygen, maximum);
        const allValues = Object.values(presentation);

        expect(allValues.every(Number.isFinite)).toBe(true);
        expect(presentation.normalizedOxygen).toBeGreaterThanOrEqual(0);
        expect(presentation.normalizedOxygen).toBeLessThanOrEqual(1);
        expect(presentation.lowOxygenIntensity).toBeGreaterThanOrEqual(0);
        expect(presentation.lowOxygenIntensity).toBeLessThanOrEqual(1);
        expect(presentation.cameraZoomOffset).toBeGreaterThanOrEqual(0);
        expect(presentation.cameraZoomOffset).toBeLessThanOrEqual(
          OXYGEN_PRESENTATION_RULES.maximumCameraZoomOffset,
        );
        expect(presentation.cameraZoomMultiplier).toBeGreaterThanOrEqual(1);
        expect(presentation.cameraZoomMultiplier).toBeLessThanOrEqual(
          1 + OXYGEN_PRESENTATION_RULES.maximumCameraZoomOffset,
        );
        expect(presentation.redVignetteOpacity).toBeGreaterThanOrEqual(0);
        expect(presentation.redVignetteOpacity).toBeLessThanOrEqual(
          OXYGEN_PRESENTATION_RULES.maximumRedVignetteOpacity,
        );
        expect(presentation.redWashOpacity).toBeGreaterThanOrEqual(0);
        expect(presentation.redWashOpacity).toBeLessThanOrEqual(
          OXYGEN_PRESENTATION_RULES.maximumRedWashOpacity,
        );
      }
    }
  });
});
