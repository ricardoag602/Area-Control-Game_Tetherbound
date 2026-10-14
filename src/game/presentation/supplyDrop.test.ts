import { describe, expect, it } from "vitest";
import {
  calculateSupplyDropBlip,
  calculateSupplyDropToast,
  SUPPLY_DROP_BLIP_DURATION_MS,
  SUPPLY_DROP_TOAST_DURATION_MS,
  SUPPLY_DROP_TOAST_FADE_MS,
} from "./supplyDrop";
import type {
  BiomeWeatherEvent,
  SalvageDropEvent,
  WorldBiome,
} from "../world/timeline";

const drop: SalvageDropEvent = {
  id: "drop-test",
  sequence: 0,
  scheduledTick: 100,
  eventSeed: 1,
  category: "resource_drop",
  kind: "salvage_drop",
  regionId: "desert-test-zone",
  biome: "desert",
  position: { x: 42, y: 84 },
  amount: 2,
};

describe("supply-drop minimap blip", () => {
  it("appears at landing time and fades using authoritative match time", () => {
    const landedAtMs = 5_000;
    const landing = calculateSupplyDropBlip(drop, landedAtMs, 20);
    const fading = calculateSupplyDropBlip(
      drop,
      landedAtMs + SUPPLY_DROP_BLIP_DURATION_MS / 2,
      20,
    );

    expect(landing).toMatchObject({
      event: drop,
      ageMs: 0,
      opacity: 1,
      coreOpacity: 1,
      ringHalfSize: 3.5,
    });
    expect(fading?.opacity).toBeGreaterThan(0);
    expect(fading?.opacity).toBeLessThan(landing?.opacity ?? 0);
    expect(fading?.ringHalfSize).toBeGreaterThan(landing?.ringHalfSize ?? 0);
  });

  it("stays hidden before landing and after its short display window", () => {
    const landedAtMs = 5_000;

    expect(calculateSupplyDropBlip(drop, landedAtMs - 1, 20)).toBeNull();
    expect(calculateSupplyDropBlip(
      drop,
      landedAtMs + SUPPLY_DROP_BLIP_DURATION_MS,
      20,
    )).toBeNull();
  });

  it("ignores non-supply events and invalid clocks", () => {
    const weather: BiomeWeatherEvent = {
      id: "weather-test",
      sequence: 0,
      scheduledTick: 100,
      eventSeed: 2,
      category: "environment",
      kind: "biome_weather",
      regionId: "desert-test-zone",
      biome: "desert",
      effect: "dust_storm",
      intensity: 1,
      durationTicks: 20,
    };

    expect(calculateSupplyDropBlip(weather, 5_000, 20)).toBeNull();
    expect(calculateSupplyDropBlip(drop, Number.NaN, 20)).toBeNull();
    expect(calculateSupplyDropBlip(drop, 5_000, 0)).toBeNull();
  });
});

describe("supply-drop popup", () => {
  it.each<WorldBiome>(["water", "jungle", "desert", "taiga"])(
    "carries the %s biome identity into its presentation",
    (biome) => {
      const event = { ...drop, id: `drop-${biome}`, biome };
      const toast = calculateSupplyDropToast(event, 5_000, 20);

      expect(toast?.event.biome).toBe(biome);
      expect(toast?.label).toContain(
        biome[0].toUpperCase() + biome.slice(1),
      );
    },
  );

  it("stays clear, then fades during the end of its 1.5-second lifetime", () => {
    const landedAtMs = 5_000;
    const fadeStartMs = SUPPLY_DROP_TOAST_DURATION_MS -
      SUPPLY_DROP_TOAST_FADE_MS;

    expect(calculateSupplyDropToast(drop, landedAtMs, 20)).toMatchObject({
      ageMs: 0,
      opacity: 1,
      label: "Supply drop · Desert · 2 salvage",
    });
    expect(calculateSupplyDropToast(
      drop,
      landedAtMs + fadeStartMs,
      20,
    )?.opacity).toBe(1);
    expect(calculateSupplyDropToast(
      drop,
      landedAtMs + fadeStartMs + SUPPLY_DROP_TOAST_FADE_MS / 2,
      20,
    )?.opacity).toBeCloseTo(0.5, 10);
    expect(calculateSupplyDropToast(
      drop,
      landedAtMs + SUPPLY_DROP_TOAST_DURATION_MS - 1,
      20,
    )?.opacity).toBeGreaterThan(0);
    expect(calculateSupplyDropToast(
      drop,
      landedAtMs + SUPPLY_DROP_TOAST_DURATION_MS,
      20,
    )).toBeNull();
  });

  it("stays hidden before landing and rejects non-supply events", () => {
    const weather: BiomeWeatherEvent = {
      id: "weather-toast-test",
      sequence: 0,
      scheduledTick: 100,
      eventSeed: 2,
      category: "environment",
      kind: "biome_weather",
      regionId: "desert-test-zone",
      biome: "desert",
      effect: "dust_storm",
      intensity: 1,
      durationTicks: 20,
    };

    expect(calculateSupplyDropToast(drop, 4_999, 20)).toBeNull();
    expect(calculateSupplyDropToast(weather, 5_000, 20)).toBeNull();
    expect(calculateSupplyDropToast(drop, Number.NaN, 20)).toBeNull();
    expect(calculateSupplyDropToast(drop, 5_000, 0)).toBeNull();
  });
});
