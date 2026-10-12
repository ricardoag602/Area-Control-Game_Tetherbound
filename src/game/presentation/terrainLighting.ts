import { GAME_RULES } from "../constants";
import type { GameState, PlayerId, Vec2 } from "../types";

export const TERRAIN_TEAM_COLORS = {
  player: 0x62e2f8,
  rival: 0xff8a68,
  player3: 0x39e27d,
  player4: 0xffd24a,
} as const satisfies Readonly<Record<PlayerId, number>>;

export interface TerrainLightZone {
  readonly id: string;
  readonly owner: PlayerId;
  readonly position: Vec2;
  readonly radius: number;
  readonly kind: "base" | "anchor";
}

/**
 * Presentation-only illumination follows the authoritative powered network.
 * Bases are always active; severed and disrupted anchors stop revealing terrain.
 */
export function collectTerrainLightZones(
  state: Pick<GameState, "activePlayerIds" | "players" | "anchors">,
): TerrainLightZone[] {
  const activePlayers = new Set(state.activePlayerIds);
  const bases = state.activePlayerIds.map((playerId): TerrainLightZone => ({
    id: `base-${playerId}`,
    owner: playerId,
    position: state.players[playerId].basePosition,
    radius: GAME_RULES.safeZoneRadius,
    kind: "base",
  }));
  const anchors = state.anchors.flatMap((anchor): TerrainLightZone[] => {
    if (!anchor.powered || !activePlayers.has(anchor.owner)) return [];
    return [{
      id: anchor.id,
      owner: anchor.owner,
      position: anchor.position,
      radius: GAME_RULES.safeZoneRadius,
      kind: "anchor",
    }];
  });

  return [...bases, ...anchors];
}
