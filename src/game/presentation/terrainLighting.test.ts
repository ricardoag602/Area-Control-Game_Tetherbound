import { describe, expect, it } from "vitest";
import { GAME_RULES } from "../constants";
import { createInitialGameState } from "../state";
import type { Anchor, PlayerLimit } from "../types";
import { collectTerrainLightZones } from "./terrainLighting";

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
