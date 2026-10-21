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

const MAX_CACHED_TERRAIN_LIGHT_TOPOLOGIES = 128;
const terrainLightZoneCache = new Map<string, readonly TerrainLightZone[]>();

/**
 * Stable description of the geometry that can change terrain illumination.
 * Match-clock, movement, oxygen, and interaction progress intentionally do not
 * participate, so their frequent updates can reuse the same zone collection.
 */
export function getTerrainLightTopologyKey(
  state: Pick<GameState, "activePlayerIds" | "players" | "anchors">,
) {
  const activePlayerIds = [...state.activePlayerIds].sort();
  const activePlayers = new Set(activePlayerIds);
  const bases = activePlayerIds.map((playerId) => {
    const position = state.players[playerId].basePosition;
    return [playerId, finiteCoordinate(position.x), finiteCoordinate(position.y)];
  });
  const anchors = state.anchors
    .filter((anchor) => anchor.powered && activePlayers.has(anchor.owner))
    .map((anchor) => [
      anchor.id,
      anchor.owner,
      finiteCoordinate(anchor.position.x),
      finiteCoordinate(anchor.position.y),
    ] as const)
    .sort((left, right) => left[0].localeCompare(right[0]));

  return JSON.stringify([activePlayerIds, bases, anchors]);
}

/**
 * Presentation-only illumination follows the authoritative powered network.
 * Bases are always active; severed and disrupted anchors stop revealing terrain.
 */
export function collectTerrainLightZones(
  state: Pick<GameState, "activePlayerIds" | "players" | "anchors">,
): readonly TerrainLightZone[] {
  const topologyKey = getTerrainLightTopologyKey(state);
  const cached = terrainLightZoneCache.get(topologyKey);
  if (cached) return cached;

  const activePlayers = new Set(state.activePlayerIds);
  const bases = state.activePlayerIds.map((playerId): TerrainLightZone => ({
    id: `base-${playerId}`,
    owner: playerId,
    position: { ...state.players[playerId].basePosition },
    radius: GAME_RULES.safeZoneRadius,
    kind: "base",
  }));
  const anchors = state.anchors.flatMap((anchor): TerrainLightZone[] => {
    if (!anchor.powered || !activePlayers.has(anchor.owner)) return [];
    return [{
      id: anchor.id,
      owner: anchor.owner,
      position: { ...anchor.position },
      radius: GAME_RULES.safeZoneRadius,
      kind: "anchor",
    }];
  });

  const zones = [...bases, ...anchors];
  terrainLightZoneCache.set(topologyKey, zones);
  if (terrainLightZoneCache.size > MAX_CACHED_TERRAIN_LIGHT_TOPOLOGIES) {
    const oldestKey = terrainLightZoneCache.keys().next().value;
    if (oldestKey !== undefined) terrainLightZoneCache.delete(oldestKey);
  }
  return zones;
}

/**
 * Approximates the feathered Pixi reveal at a world point without adding GPU
 * lights. The edge of a powered zone is half-lit and fades smoothly to dusk.
 */
export function getTerrainIlluminationFactor(
  zones: readonly TerrainLightZone[],
  position: Vec2,
  featherWorldUnits: number,
) {
  const feather = Math.max(0.001, featherWorldUnits);
  let illumination = 0;
  for (const zone of zones) {
    const distance = Math.hypot(
      position.x - zone.position.x,
      position.y - zone.position.y,
    );
    const linear = clamp(
      (zone.radius + feather - distance) / (feather * 2),
      0,
      1,
    );
    const smoothed = linear * linear * (3 - 2 * linear);
    illumination = Math.max(illumination, smoothed);
  }
  return illumination;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteCoordinate(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}
