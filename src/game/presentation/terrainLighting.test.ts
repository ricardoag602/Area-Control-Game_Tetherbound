import { describe, expect, it } from "vitest";
import { GAME_RULES } from "../constants";
import { createInitialGameState } from "../state";
import type { Anchor, PlayerLimit } from "../types";
import {
  collectTerrainLightZones,
  getTerrainIlluminationFactor,
  type TerrainLightZone,
} from "./terrainLighting";

describe("terrain illumination", () => {
  it.each([2, 3, 4] as PlayerLimit[])(
    "creates one illuminated base for each of %i active players",
    (playerLimit) => {
      const state = createInitialGameState(`terrain-${playerLimit}`, playerLimit);
      const zones = collectTerrainLightZones(state);

      expect(zones).toHaveLength(playerLimit);
      expect(zones.every((zone) => zone.kind === "base")).toBe(true);
      expect(zones.every((zone) => zone.radius === GAME_RULES.safeZoneRadius)).toBe(true);
      expect(zones.map((zone) => zone.position)).toEqual(
        state.activePlayerIds.map((playerId) => state.players[playerId].basePosition),
      );
    },
  );

  it("reveals only powered anchors belonging to active players", () => {
    const state = createInitialGameState("terrain-anchors", 2);
    state.anchors = [
      anchor("powered", "player", true),
      anchor("disrupted", "rival", false),
      anchor("inactive-slot", "player3", true),
    ];

    const zones = collectTerrainLightZones(state);

    expect(zones.map((zone) => zone.id)).toEqual([
      "base-player",
      "base-rival",
      "powered",
    ]);
  });

  it("matches the feathered reveal from daylight to dusk", () => {
    const zone: TerrainLightZone = {
      id: "base-player",
      owner: "player",
      kind: "base",
      position: { x: 50, y: 50 },
      radius: 20,
    };

    expect(getTerrainIlluminationFactor([zone], { x: 50, y: 50 }, 5)).toBe(1);
    expect(getTerrainIlluminationFactor([zone], { x: 70, y: 50 }, 5)).toBeCloseTo(0.5);
    expect(getTerrainIlluminationFactor([zone], { x: 75, y: 50 }, 5)).toBe(0);
  });

  it("uses the strongest reveal where powered zones overlap", () => {
    const zones: TerrainLightZone[] = [
      { id: "near", owner: "player", kind: "base", position: { x: 0, y: 0 }, radius: 10 },
      { id: "far", owner: "rival", kind: "anchor", position: { x: 20, y: 0 }, radius: 10 },
    ];

    expect(getTerrainIlluminationFactor(zones, { x: 4, y: 0 }, 5)).toBeGreaterThan(0.5);
  });
});

function anchor(id: string, owner: Anchor["owner"], powered: boolean): Anchor {
  return {
    id,
    owner,
    position: { x: 120, y: 140 },
    parentId: `base-${owner}`,
    powered,
    disruptedUntilMs: powered ? null : 10_000,
    protectedUntilMs: null,
    overloadProgress: 0,
    repairProgress: 0,
  };
}
