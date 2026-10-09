import type { Vec2 } from "./types";

/**
 * The first full-size arena is 4.59 times the area of the 100 x 160 prototype.
 * Keeping this data separate from the renderer lets the simulation, server, and
 * any future GPU renderer consume exactly the same world definition.
 */
export const WORLD_BOUNDS = {
  width: 210,
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
    effects: {
      movement: {
        speedMultiplier: 0.68,
        turnRateMultiplier: 0.82,
        ambientDrift: { strength: 0.55, cycleSeconds: 4.5 },
      },
      oxygen: { drainMultiplier: 1.25, recoveryMultiplier: 0.9 },
    },
  },
  jungle: {
    id: "jungle",
    effects: {
      movement: {
        speedMultiplier: 0.76,
        turnRateMultiplier: 0.7,
        ambientDrift: null,
      },
      oxygen: { drainMultiplier: 1.12, recoveryMultiplier: 0.95 },
    },
  },
  desert: {
    id: "desert",
    effects: {
      movement: {
        speedMultiplier: 0.92,
        turnRateMultiplier: 0.9,
        ambientDrift: null,
      },
      oxygen: { drainMultiplier: 1.3, recoveryMultiplier: 0.8 },
    },
  },
  taiga: {
    id: "taiga",
    effects: {
      movement: {
        speedMultiplier: 0.82,
        turnRateMultiplier: 0.78,
        ambientDrift: { strength: 0.18, cycleSeconds: 7 },
      },
      oxygen: { drainMultiplier: 1.18, recoveryMultiplier: 0.9 },
    },
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
    x: 72,
    y: 0,
    width: 66,
    height: 62,
  },
  {
    id: "south-base-corridor",
    biome: "base_corridor",
    shape: "rectangle",
    x: 72,
    y: 288,
    width: 66,
    height: 62,
  },
  {
    id: "vertical-neutral-corridor",
    biome: "neutral",
    shape: "rectangle",
    x: 96,
    y: 0,
    width: 18,
    height: 350,
  },
  {
    id: "equatorial-neutral-corridor",
    biome: "neutral",
    shape: "rectangle",
    x: 0,
    y: 168,
    width: 210,
    height: 14,
  },
  {
    id: "water-shelf",
    biome: "water",
    shape: "polygon",
    vertices: [
      { x: 0, y: 0 },
      { x: 112, y: 0 },
      { x: 104, y: 42 },
      { x: 110, y: 90 },
      { x: 101, y: 132 },
      { x: 105, y: 175 },
      { x: 0, y: 175 },
    ],
  },
  {
    id: "jungle-canopy",
    biome: "jungle",
    shape: "polygon",
    vertices: [
      { x: 98, y: 0 },
      { x: 210, y: 0 },
      { x: 210, y: 175 },
      { x: 105, y: 175 },
      { x: 109, y: 132 },
      { x: 100, y: 90 },
      { x: 106, y: 42 },
    ],
  },
  {
    id: "desert-basin",
    biome: "desert",
    shape: "polygon",
    vertices: [
      { x: 0, y: 175 },
      { x: 105, y: 175 },
      { x: 101, y: 217 },
      { x: 110, y: 260 },
      { x: 104, y: 308 },
      { x: 112, y: 350 },
      { x: 0, y: 350 },
    ],
  },
  {
    id: "taiga-ridge",
    biome: "taiga",
    shape: "polygon",
    vertices: [
      { x: 105, y: 175 },
      { x: 210, y: 175 },
      { x: 210, y: 350 },
      { x: 98, y: 350 },
      { x: 106, y: 308 },
      { x: 100, y: 260 },
      { x: 109, y: 217 },
    ],
  },
  {
    id: "neutral-remainder",
    biome: "neutral",
    shape: "rectangle",
    x: 0,
    y: 0,
    width: 210,
    height: 350,
  },
] as const satisfies readonly BiomeRegion[];

/** Two-player placement remains independent from player IDs for future modes. */
export const WORLD_BASE_SLOTS = {
  north: {
    basePosition: { x: 105, y: 16 },
    spawnPosition: { x: 105, y: 34 },
    facing: { x: 0, y: 1 },
  },
  south: {
    basePosition: { x: 105, y: 334 },
    spawnPosition: { x: 105, y: 316 },
    facing: { x: 0, y: -1 },
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
