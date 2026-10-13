import { describe, expect, it } from "vitest";
import { MOVEMENT_RULES } from "../movement/movement";
import type { BiomeId } from "../world/map";
import {
  AUDIO_BIOMES,
  AUDIO_PREFERENCE_KEY,
  FOOTSTEP_ASSET_URLS,
  GAME_AUDIO_RULES,
  calculateBiomeAudioBlend,
  getFootstepTriggerIndices,
  readAudioPreference,
} from "./gameAudio";

describe("biome audio blending", () => {
  const biomeCenters = {
    neutral: { x: 175, y: 175 },
    base_corridor: { x: 175, y: 30 },
    water: { x: 80, y: 80 },
    jungle: { x: 270, y: 80 },
    desert: { x: 80, y: 270 },
    taiga: { x: 270, y: 270 },
  } as const satisfies Readonly<Record<BiomeId, { x: number; y: number }>>;

  it.each(AUDIO_BIOMES)("is normalized and one-hot at the %s center", (biome) => {
    const blend = calculateBiomeAudioBlend(biomeCenters[biome]);

    expect(sumBlend(blend)).toBeCloseTo(1, 10);
    expect(blend[biome]).toBeCloseTo(1, 10);
    for (const otherBiome of AUDIO_BIOMES) {
      if (otherBiome !== biome) expect(blend[otherBiome]).toBe(0);
    }
  });

  it("mixes a terrain biome gradually with the neighboring neutral corridor", () => {
    const blend = calculateBiomeAudioBlend({ x: 164, y: 100 });

    expect(sumBlend(blend)).toBeCloseTo(1, 10);
    expect(blend.water).toBeCloseTo(14.2 / 19.2, 10);
    expect(blend.neutral).toBeCloseTo(5 / 19.2, 10);
    expect(blend.base_corridor).toBe(0);
    expect(blend.jungle).toBe(0);
    expect(blend.desert).toBe(0);
    expect(blend.taiga).toBe(0);
  });
});

describe("footstep trigger cadence", () => {
  const halfCycle = MOVEMENT_RULES.stepCycleDistance / 2;

  it("emits one alternating contact index for each crossed half-cycle", () => {
    expect(getFootstepTriggerIndices(
      halfCycle - 0.01,
      halfCycle,
      "walking",
      MOVEMENT_RULES.walkMaximumSpeed,
    )).toEqual([1]);
    expect(getFootstepTriggerIndices(
      halfCycle,
      halfCycle * 2,
      "walking",
      MOVEMENT_RULES.walkMaximumSpeed,
    )).toEqual([2]);
  });

  it("supports a final walking-to-idle contact through the effective walking mode", () => {
    const beforeContact = halfCycle - 0.01;

    expect(getFootstepTriggerIndices(
      beforeContact,
      halfCycle,
      "walking",
      MOVEMENT_RULES.walkMaximumSpeed,
    )).toEqual([1]);
    expect(getFootstepTriggerIndices(
      beforeContact,
      halfCycle,
      "idle",
      MOVEMENT_RULES.walkMaximumSpeed,
    )).toEqual([]);
  });

  it("does not emit grounded footsteps during a burst", () => {
    expect(getFootstepTriggerIndices(
      0,
      halfCycle * 2,
      "burst",
      MOVEMENT_RULES.burstSpeed,
    )).toEqual([]);
  });

  it("stays silent when gait distance moves backwards or resets", () => {
    expect(getFootstepTriggerIndices(
      halfCycle * 3,
      0,
      "walking",
      MOVEMENT_RULES.walkMaximumSpeed,
    )).toEqual([]);
  });

  it("retains only the newest contacts when a snapshot catches up", () => {
    const finalIndex = GAME_AUDIO_RULES.maximumFootstepsPerUpdate + 4;
    const expectedFirst = finalIndex - GAME_AUDIO_RULES.maximumFootstepsPerUpdate + 1;

    expect(getFootstepTriggerIndices(
      0,
      halfCycle * finalIndex + 0.001,
      "walking",
      MOVEMENT_RULES.walkMaximumSpeed,
    )).toEqual(
      Array.from(
        { length: GAME_AUDIO_RULES.maximumFootstepsPerUpdate },
        (_, index) => expectedFirst + index,
      ),
    );
  });
});

describe("footstep assets", () => {
  it("maps every reference recording to its lowercase public URL", () => {
    expect(FOOTSTEP_ASSET_URLS).toEqual({
      forest: "/assets/audio/footsteps/walk_forest.mp3",
      sand: "/assets/audio/footsteps/walk_sand.mp3",
      snow: "/assets/audio/footsteps/walk_snow.mp3",
      water: "/assets/audio/footsteps/walk_water.mp3",
    });
  });

  it.each(Object.entries(FOOTSTEP_ASSET_URLS))(
    "uses the requested walk_<biome>.mp3 naming for %s",
    (_sample, assetUrl) => {
      expect(assetUrl).toMatch(/^\/assets\/audio\/footsteps\/walk_[a-z]+\.mp3$/);
    },
  );
});

describe("audio preference", () => {
  it("defaults to enabled when no preference has been stored", () => {
    expect(readAudioPreference(null)).toBe(true);
    expect(readAudioPreference({ getItem: () => null })).toBe(true);
  });

  it("honors the explicit disabled preference", () => {
    const storage = {
      getItem: (key: string) => key === AUDIO_PREFERENCE_KEY ? "false" : null,
    };

    expect(readAudioPreference(storage)).toBe(false);
  });
});

function sumBlend(blend: Readonly<Record<BiomeId, number>>) {
  return AUDIO_BIOMES.reduce((total, biome) => total + blend[biome], 0);
}
