import { describe, expect, it } from "vitest";
import {
  calculateSupplyDropBlip,
  SUPPLY_DROP_BLIP_DURATION_MS,
} from "./supplyDrop";
import type { BiomeWeatherEvent, SalvageDropEvent } from "../world/timeline";

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
