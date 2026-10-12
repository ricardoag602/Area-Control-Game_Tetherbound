import { describe, expect, it } from "vitest";
import { WORLD } from "./constants";
import { createInitialGameState } from "./state";
import { getEnvironmentModifiers } from "./simulation/environment";
import type { PlayerLimit } from "./types";
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

    for (const deposit of state.salvage) {
      const counterpart = rotate(deposit.position);
      expect(state.salvage.some(({ position }) =>
        Math.hypot(position.x - counterpart.x, position.y - counterpart.y) < 1e-9,
      )).toBe(true);
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

  it.each([2, 3, 4] as PlayerLimit[])(
    "places %i players at equal radii with equal starting resources",
    (playerLimit) => {
      const state = createInitialGameState(`fair-${playerLimit}`, playerLimit);
      const center = { x: WORLD.width / 2, y: WORLD.height / 2 };
      const baseRadii = state.activePlayerIds.map((playerId) => {
        const base = state.players[playerId].basePosition;
        return Math.hypot(base.x - center.x, base.y - center.y);
      });
      const spawnRadii = state.activePlayerIds.map((playerId) => {
        const spawn = state.players[playerId].astronaut.position;
        return Math.hypot(spawn.x - center.x, spawn.y - center.y);
      });

      expect(state.activePlayerIds).toHaveLength(playerLimit);
      expect(baseRadii.every((radius) => Math.abs(radius - baseRadii[0]) < 1e-9)).toBe(true);
      expect(spawnRadii.every((radius) => Math.abs(radius - spawnRadii[0]) < 1e-9)).toBe(true);
      expect(state.salvage).toHaveLength(playerLimit * 8);
      expect(state.activePlayerIds.every((playerId) =>
        state.players[playerId].astronaut.tetherKits === 2,
      )).toBe(true);
      const routeEffects = state.activePlayerIds.map((playerId) => {
        const base = state.players[playerId].basePosition;
        return getEnvironmentModifiers(state, {
          x: (base.x + center.x) / 2,
          y: (base.y + center.y) / 2,
        });
      });
      expect(routeEffects.every((effects) =>
        effects.speedMultiplier === routeEffects[0].speedMultiplier &&
        effects.oxygenDrainMultiplier === routeEffects[0].oxygenDrainMultiplier,
      )).toBe(true);
    },
  );

  it("uses an equilateral triangle for three-player matches", () => {
    const state = createInitialGameState("triangle", 3);
    const bases = state.activePlayerIds.map((playerId) => state.players[playerId].basePosition);
    const distances = [
      Math.hypot(bases[0].x - bases[1].x, bases[0].y - bases[1].y),
      Math.hypot(bases[1].x - bases[2].x, bases[1].y - bases[2].y),
      Math.hypot(bases[2].x - bases[0].x, bases[2].y - bases[0].y),
    ];
    expect(distances.every((distance) => Math.abs(distance - distances[0]) < 1e-9)).toBe(true);
  });
});
