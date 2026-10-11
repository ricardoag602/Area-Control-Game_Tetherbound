import { describe, expect, it } from "vitest";
import { WORLD } from "./constants";
import { createInitialGameState } from "./state";
import { getBiomeEffects, WORLD_BASE_SLOTS } from "./world/map";

describe("initial arena fairness", () => {
  it("rotates bases, salvage, and event zones into exact counterparts", () => {
    const state = createInitialGameState("rotational-fairness");
    const rotate = ({ x, y }: { x: number; y: number }) => ({
      x: WORLD.width - x,
      y: WORLD.height - y,
    });

    expect(WORLD_BASE_SLOTS.south.basePosition).toEqual(
      rotate(WORLD_BASE_SLOTS.north.basePosition),
    );
    expect(WORLD_BASE_SLOTS.south.spawnPosition).toEqual(
      rotate(WORLD_BASE_SLOTS.north.spawnPosition),
    );

    const salvagePositions = new Set(
      state.salvage.map(({ position }) => `${position.x},${position.y}`),
    );
    for (const deposit of state.salvage) {
      const counterpart = rotate(deposit.position);
      expect(salvagePositions.has(`${counterpart.x},${counterpart.y}`)).toBe(true);
    }

    for (const region of state.worldTimeline.rules.biomeRegions) {
      const counterpart = state.worldTimeline.rules.biomeRegions.find(
        (candidate) =>
          candidate.x === WORLD.width - region.x - region.width &&
          candidate.y === WORLD.height - region.y - region.height &&
          candidate.width === region.width &&
          candidate.height === region.height,
      );
      expect(counterpart, `missing rotated event zone for ${region.id}`).toBeDefined();
      expect(getBiomeEffects(counterpart!.biome)).toEqual(
        getBiomeEffects(region.biome),
      );
    }
  });
});
