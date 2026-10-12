import { describe, expect, it } from "vitest";
import {
  BIOME_DEFINITIONS,
  WORLD_AREA_SCALE_FROM_PROTOTYPE,
  WORLD_BASE_SLOTS,
  WORLD_BOUNDS,
  WORLD_REGIONS,
  getBiomeAt,
  getBiomeEffects,
  getBiomeRegionAt,
  isInsideWorld,
  sampleWorld,
  type BiomeId,
} from "./map";

describe("deterministic world model", () => {
  it("uses an expanded square arena for equal radial starts", () => {
    expect(WORLD_BOUNDS).toEqual({ width: 350, height: 350 });
    expect(WORLD_AREA_SCALE_FROM_PROTOTYPE).toBeCloseTo(7.65625, 8);
    expect(WORLD_AREA_SCALE_FROM_PROTOTYPE).toBeGreaterThan(7);
    expect(WORLD_AREA_SCALE_FROM_PROTOTYPE).toBeLessThanOrEqual(8);
  });

  it.each([
    [{ x: 80, y: 80 }, "water"],
    [{ x: 270, y: 80 }, "jungle"],
    [{ x: 80, y: 270 }, "desert"],
    [{ x: 270, y: 270 }, "taiga"],
    [{ x: 175, y: 100 }, "neutral"],
    [{ x: 100, y: 175 }, "neutral"],
    [WORLD_BASE_SLOTS.north.basePosition, "base_corridor"],
    [WORLD_BASE_SLOTS.south.basePosition, "base_corridor"],
  ] as const)("classifies %o as %s", (position, expectedBiome) => {
    expect(getBiomeAt(position)).toBe(expectedBiome);
  });

  it("uses list order to resolve overlapping corridor boundaries", () => {
    expect(getBiomeRegionAt({ x: 175, y: 62 })?.id).toBe("north-base-corridor");
    expect(getBiomeRegionAt({ x: 175, y: 62.0001 })?.id).toBe(
      "vertical-neutral-corridor",
    );
    expect(getBiomeRegionAt({ x: 100, y: 166 })?.id).toBe(
      "horizontal-neutral-corridor",
    );
    expect(getBiomeRegionAt({ x: 100, y: 184 })?.id).toBe(
      "horizontal-neutral-corridor",
    );
  });

  it("includes every outer edge while rejecting invalid positions", () => {
    expect(isInsideWorld({ x: 0, y: 0 })).toBe(true);
    expect(isInsideWorld({ x: 350, y: 350 })).toBe(true);
    expect(getBiomeAt({ x: 0, y: 0 })).toBe("water");
    expect(getBiomeAt({ x: 350, y: 350 })).toBe("taiga");

    for (const position of [
      { x: -0.0001, y: 10 },
      { x: 350.0001, y: 10 },
      { x: 10, y: -0.0001 },
      { x: 10, y: 350.0001 },
      { x: Number.NaN, y: 10 },
      { x: 10, y: Number.POSITIVE_INFINITY },
    ]) {
      expect(isInsideWorld(position)).toBe(false);
      expect(getBiomeAt(position)).toBeNull();
      expect(sampleWorld(position)).toBeNull();
    }
  });

  it("assigns every integer world coordinate to a biome", () => {
    const knownBiomes = new Set(Object.keys(BIOME_DEFINITIONS));

    for (let y = 0; y <= WORLD_BOUNDS.height; y += 1) {
      for (let x = 0; x <= WORLD_BOUNDS.width; x += 1) {
        const region = getBiomeRegionAt({ x, y });
        expect(region, `missing region at (${x}, ${y})`).not.toBeNull();
        expect(knownBiomes.has(region?.biome ?? "")).toBe(true);
      }
    }
  });

  it("keeps all region geometry inside the arena", () => {
    for (const region of WORLD_REGIONS) {
      expect(region.width).toBeGreaterThan(0);
      expect(region.height).toBeGreaterThan(0);
      expect(isInsideWorld({ x: region.x, y: region.y })).toBe(true);
      expect(
        isInsideWorld({
          x: region.x + region.width,
          y: region.y + region.height,
        }),
      ).toBe(true);
    }
  });

  it("provides valid movement and oxygen tuning for every biome", () => {
    for (const biome of Object.keys(BIOME_DEFINITIONS) as BiomeId[]) {
      const effects = getBiomeEffects(biome);
      expect(effects.movement.speedMultiplier).toBeGreaterThan(0);
      expect(effects.movement.turnRateMultiplier).toBeGreaterThan(0);
      expect(effects.oxygen.drainMultiplier).toBeGreaterThan(0);
      expect(effects.oxygen.recoveryMultiplier).toBeGreaterThan(0);

      if (effects.movement.ambientDrift) {
        expect(effects.movement.ambientDrift.strength).toBeGreaterThan(0);
        expect(effects.movement.ambientDrift.cycleSeconds).toBeGreaterThan(0);
      }
    }
  });

  it("gives rotationally mirrored routes identical gameplay tuning", () => {
    expect(BIOME_DEFINITIONS.water.effects).toEqual(
      BIOME_DEFINITIONS.taiga.effects,
    );
    expect(BIOME_DEFINITIONS.jungle.effects).toEqual(
      BIOME_DEFINITIONS.desert.effects,
    );
  });

  it("keeps terrain effects symmetric across the full arena rotation", () => {
    for (let y = 0; y <= WORLD_BOUNDS.height; y += 1) {
      for (let x = 0; x <= WORLD_BOUNDS.width; x += 1) {
        const effects = sampleWorld({ x, y })?.effects;
        const rotatedEffects = sampleWorld({
          x: WORLD_BOUNDS.width - x,
          y: WORLD_BOUNDS.height - y,
        })?.effects;
        expect(
          rotatedEffects,
          `terrain mismatch at (${x}, ${y}) and its rotated counterpart`,
        ).toEqual(effects);
      }
    }
  });

  it("returns the biome, region, and exact shared effect metadata together", () => {
    const sample = sampleWorld({ x: 80, y: 80 });

    expect(sample).toEqual({
      regionId: "water-shelf",
      biome: "water",
      effects: BIOME_DEFINITIONS.water.effects,
    });
    expect(sample?.effects).toBe(getBiomeEffects("water"));
  });

  it("keeps all exported world data JSON serializable", () => {
    const data = {
      bounds: WORLD_BOUNDS,
      baseSlots: WORLD_BASE_SLOTS,
      biomes: BIOME_DEFINITIONS,
      regions: WORLD_REGIONS,
    };

    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });
});
