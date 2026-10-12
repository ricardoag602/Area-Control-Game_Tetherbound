import type { Vec2 } from "../types";

/**
 * The square arena is 7.66 times the area of the 100 x 160 prototype.
 * Keeping this data separate from the renderer lets the simulation, server, and
 * any future GPU renderer consume exactly the same world definition.
 */
export const WORLD_BOUNDS = {
  width: 350,
  height: 350,
} as const;

export const WORLD_AREA_SCALE_FROM_PROTOTYPE =
  (WORLD_BOUNDS.width * WORLD_BOUNDS.height) / (100 * 160);

export type BiomeId =
  | "neutral"
  | "base_corridor"
  | "water"
  | "jungle"
  | "desert"
  | "taiga";

export interface AmbientDriftEffect {
  /** Maximum world-space displacement contributed per second. */
  readonly strength: number;
  /** Period for a future deterministic, match-clock-driven drift curve. */
  readonly cycleSeconds: number;
}

export interface BiomeEffects {
  readonly movement: {
    /** Applies to all terrain-sensitive translation, including bursts. */
    readonly speedMultiplier: number;
    readonly turnRateMultiplier: number;
    /** Metadata only; the authoritative simulation will apply this later. */
    readonly ambientDrift: AmbientDriftEffect | null;
  };
  readonly oxygen: {
    readonly drainMultiplier: number;
    readonly recoveryMultiplier: number;
  };
}

export interface BiomeDefinition {
  readonly id: BiomeId;
  readonly effects: BiomeEffects;
}

// The arena uses different art in each quadrant, while all four terrain themes
// share authoritative tuning. Radial routes therefore stay mechanically equal
// for two-, three-, and four-player spawn layouts.
const BALANCED_TERRAIN_EFFECTS = {
  movement: {
    speedMultiplier: 0.8,
    turnRateMultiplier: 0.8,
    ambientDrift: null,
  },
  oxygen: { drainMultiplier: 1.21, recoveryMultiplier: 0.89 },
} as const satisfies BiomeEffects;

/**
 * Simulation-facing terrain tuning. Values are deliberately modest so terrain
 * changes decisions without replacing the movement feel that already works.
 */
export const BIOME_DEFINITIONS = {
  neutral: {
    id: "neutral",
    effects: {
      movement: {
        speedMultiplier: 1,
        turnRateMultiplier: 1,
        ambientDrift: null,
      },
      oxygen: { drainMultiplier: 1, recoveryMultiplier: 1 },
    },
  },
  base_corridor: {
    id: "base_corridor",
    effects: {
      movement: {
        speedMultiplier: 1,
        turnRateMultiplier: 1,
        ambientDrift: null,
      },
      oxygen: { drainMultiplier: 1, recoveryMultiplier: 1 },
    },
  },
  water: {
    id: "water",
    effects: BALANCED_TERRAIN_EFFECTS,
  },
  jungle: {
    id: "jungle",
    effects: BALANCED_TERRAIN_EFFECTS,
  },
  desert: {
    id: "desert",
    effects: BALANCED_TERRAIN_EFFECTS,
  },
  taiga: {
    id: "taiga",
    effects: BALANCED_TERRAIN_EFFECTS,
  },
} as const satisfies Readonly<Record<BiomeId, BiomeDefinition>>;

interface BiomeRegionBase {
  readonly id: string;
  readonly biome: BiomeId;
}

export interface RectangleBiomeRegion extends BiomeRegionBase {
  readonly shape: "rectangle";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PolygonBiomeRegion extends BiomeRegionBase {
  readonly shape: "polygon";
  readonly vertices: readonly Vec2[];
}

export type BiomeRegion = RectangleBiomeRegion | PolygonBiomeRegion;

/**
 * Earlier entries have priority. That makes overlaps and shared borders fully
 * deterministic: base corridors beat neutral corridors, which beat terrain.
 * The final rectangle is an explicit neutral fallback for the complete arena.
 */
export const WORLD_REGIONS = [
  {
    id: "north-base-corridor",
    biome: "base_corridor",
    shape: "rectangle",
    x: 142,
    y: 0,
    width: 66,
    height: 62,
  },
  {
    id: "south-base-corridor",
    biome: "base_corridor",
    shape: "rectangle",
    x: 142,
    y: 288,
    width: 66,
    height: 62,
  },
  {
    id: "west-base-corridor",
    biome: "base_corridor",
    shape: "rectangle",
    x: 0,
    y: 142,
    width: 62,
    height: 66,
  },
  {
    id: "east-base-corridor",
    biome: "base_corridor",
    shape: "rectangle",
    x: 288,
    y: 142,
    width: 62,
    height: 66,
  },
  {
    id: "vertical-neutral-corridor",
    biome: "neutral",
    shape: "rectangle",
    x: 166,
    y: 0,
    width: 18,
    height: 350,
  },
  {
    id: "horizontal-neutral-corridor",
    biome: "neutral",
    shape: "rectangle",
    x: 0,
    y: 166,
    width: 350,
    height: 18,
  },
  {
    id: "water-shelf",
    biome: "water",
    shape: "rectangle",
    x: 0,
    y: 0,
    width: 175,
    height: 175,
  },
  {
    id: "jungle-canopy",
    biome: "jungle",
    shape: "rectangle",
    x: 175,
    y: 0,
    width: 175,
    height: 175,
  },
  {
    id: "desert-basin",
    biome: "desert",
    shape: "rectangle",
    x: 0,
    y: 175,
    width: 175,
    height: 175,
  },
  {
    id: "taiga-ridge",
    biome: "taiga",
    shape: "rectangle",
    x: 175,
    y: 175,
    width: 175,
    height: 175,
  },
  {
    id: "neutral-remainder",
    biome: "neutral",
    shape: "rectangle",
    x: 0,
    y: 0,
    width: 350,
    height: 350,
  },
] as const satisfies readonly BiomeRegion[];

/** Cardinal reference slots used by map presentation and placement tests. */
export const WORLD_BASE_SLOTS = {
  north: {
    basePosition: { x: 175, y: 16 },
    spawnPosition: { x: 175, y: 34 },
    facing: { x: 0, y: 1 },
  },
  south: {
    basePosition: { x: 175, y: 334 },
    spawnPosition: { x: 175, y: 316 },
    facing: { x: 0, y: -1 },
  },
  west: {
    basePosition: { x: 16, y: 175 },
    spawnPosition: { x: 34, y: 175 },
    facing: { x: 1, y: 0 },
  },
  east: {
    basePosition: { x: 334, y: 175 },
    spawnPosition: { x: 316, y: 175 },
    facing: { x: -1, y: 0 },
  },
} as const;

export interface WorldSample {
  readonly regionId: string;
  readonly biome: BiomeId;
  readonly effects: BiomeEffects;
}

export function isInsideWorld(position: Vec2) {
  return (
    Number.isFinite(position.x) &&
    Number.isFinite(position.y) &&
    position.x >= 0 &&
    position.x <= WORLD_BOUNDS.width &&
    position.y >= 0 &&
    position.y <= WORLD_BOUNDS.height
  );
}

/** Returns null for non-finite or out-of-bounds positions. */
export function getBiomeRegionAt(position: Vec2): BiomeRegion | null {
  if (!isInsideWorld(position)) return null;

  return WORLD_REGIONS.find((region) => containsPosition(region, position)) ?? null;
}

/** Returns null outside the playable arena rather than silently clamping. */
export function getBiomeAt(position: Vec2): BiomeId | null {
  return getBiomeRegionAt(position)?.biome ?? null;
}

export function getBiomeEffects(biome: BiomeId): BiomeEffects {
  return BIOME_DEFINITIONS[biome].effects;
}

export function sampleWorld(position: Vec2): WorldSample | null {
  const region = getBiomeRegionAt(position);
  if (!region) return null;

  return {
    regionId: region.id,
    biome: region.biome,
    effects: getBiomeEffects(region.biome),
  };
}

function containsPosition(region: BiomeRegion, position: Vec2) {
  if (region.shape === "rectangle") {
    return (
      position.x >= region.x &&
      position.x <= region.x + region.width &&
      position.y >= region.y &&
      position.y <= region.y + region.height
    );
  }

  return isInsidePolygon(position, region.vertices);
}

function isInsidePolygon(position: Vec2, vertices: readonly Vec2[]) {
  let inside = false;

  for (
    let current = 0, previous = vertices.length - 1;
    current < vertices.length;
    previous = current++
  ) {
    const start = vertices[previous];
    const end = vertices[current];

    if (isOnSegment(position, start, end)) return true;

    const crossesHorizontalRay =
      (start.y > position.y) !== (end.y > position.y) &&
      position.x <
        ((end.x - start.x) * (position.y - start.y)) / (end.y - start.y) + start.x;
    if (crossesHorizontalRay) inside = !inside;
  }

  return inside;
}

function isOnSegment(point: Vec2, start: Vec2, end: Vec2) {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const pointX = point.x - start.x;
  const pointY = point.y - start.y;
  const crossProduct = segmentX * pointY - segmentY * pointX;
  const tolerance = 1e-9 * Math.max(1, Math.abs(segmentX) + Math.abs(segmentY));

  if (Math.abs(crossProduct) > tolerance) return false;

  const dotProduct = pointX * segmentX + pointY * segmentY;
  if (dotProduct < -tolerance) return false;

  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  return dotProduct <= lengthSquared + tolerance;
}
