import { GAME_RULES, WORLD } from "../constants";
import type { GameState, PlayerId, Vec2 } from "../types";

export type TerritoryOwner = PlayerId | "neutral" | "contested";

export interface TerritoryCell {
  /** Stable row-major index, useful when uploading the grid as a texture later. */
  readonly index: number;
  readonly column: number;
  readonly row: number;
  /** World-space center of this minimap block. */
  readonly position: Vec2;
  readonly owner: TerritoryOwner;
}

export type TerritoryTotals = Record<TerritoryOwner, number>;

export interface TerritoryGrid {
  readonly columns: number;
  readonly rows: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly cells: readonly TerritoryCell[];
  /** Number of blocks in each state. */
  readonly totals: TerritoryTotals;
  /** Percentage of the complete playable map, including neutral/contested blocks. */
  readonly score: TerritoryTotals;
}

export interface TerritoryGridOptions {
  readonly columns?: number;
  readonly rows?: number;
}

export const TERRITORY_GRID_RULES = {
  /** Ten world units per block keeps the default grid intentionally pixel-like. */
  blockSize: 10,
  maximumGridDimension: 256,
} as const;

interface TerritoryNode {
  readonly owner: PlayerId;
  readonly position: Vec2;
}

/**
 * Samples powered tether coverage into a renderer-independent, row-major grid.
 * Any block covered by both networks is contested. Neither side scores an
 * overlap until one network pushes the other offline, making pressure legible
 * and preventing draw order or tiny distance changes from deciding ownership.
 */
export function sampleTerritoryGrid(
  state: GameState,
  options: TerritoryGridOptions = {},
): TerritoryGrid {
  const defaultColumns = Math.ceil(WORLD.width / TERRITORY_GRID_RULES.blockSize);
  const defaultRows = Math.ceil(WORLD.height / TERRITORY_GRID_RULES.blockSize);
  const columns = normalizeGridDimension(options.columns, defaultColumns);
  const rows = normalizeGridDimension(options.rows, defaultRows);
  const cellWidth = WORLD.width / columns;
  const cellHeight = WORLD.height / rows;
  const nodes = collectPoweredNodes(state);
  const coverageRadiusSquared = GAME_RULES.safeZoneRadius ** 2;
  const cells: TerritoryCell[] = [];
  const totals = createEmptyTotals();

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const position = {
        x: clamp((column + 0.5) * cellWidth, 0, WORLD.width),
        y: clamp((row + 0.5) * cellHeight, 0, WORLD.height),
      };
      const owner = resolveTerritoryOwner(position, nodes, coverageRadiusSquared);
      const index = row * columns + column;

      cells.push({ index, column, row, position, owner });
      totals[owner] += 1;
    }
  }

  const totalCells = cells.length;
  const score = mapTotals(totals, (total) => (total / totalCells) * 100);

  return { columns, rows, cellWidth, cellHeight, cells, totals, score };
}

function collectPoweredNodes(state: GameState): TerritoryNode[] {
  const nodes: TerritoryNode[] = [];
  const playerIds: readonly PlayerId[] = ["player", "rival"];

  for (const owner of playerIds) {
    const basePosition = clampPosition(state.players[owner].basePosition);
    if (basePosition) nodes.push({ owner, position: basePosition });
  }

  for (const anchor of state.anchors) {
    if (!anchor.powered) continue;
    const position = clampPosition(anchor.position);
    if (position) nodes.push({ owner: anchor.owner, position });
  }

  return nodes;
}

function resolveTerritoryOwner(
  position: Vec2,
  nodes: readonly TerritoryNode[],
  coverageRadiusSquared: number,
): TerritoryOwner {
  let playerDistanceSquared = Number.POSITIVE_INFINITY;
  let rivalDistanceSquared = Number.POSITIVE_INFINITY;

  for (const node of nodes) {
    const distanceSquared = squaredDistance(position, node.position);
    if (distanceSquared > coverageRadiusSquared) continue;

    if (node.owner === "player") {
      playerDistanceSquared = Math.min(playerDistanceSquared, distanceSquared);
    } else {
      rivalDistanceSquared = Math.min(rivalDistanceSquared, distanceSquared);
    }
  }

  const playerClaims = Number.isFinite(playerDistanceSquared);
  const rivalClaims = Number.isFinite(rivalDistanceSquared);

  if (!playerClaims && !rivalClaims) return "neutral";
  if (!rivalClaims) return "player";
  if (!playerClaims) return "rival";

  return "contested";
}

function normalizeGridDimension(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return clamp(Math.floor(value as number), 1, TERRITORY_GRID_RULES.maximumGridDimension);
}

/** Out-of-bounds network positions claim from the closest playable edge. */
function clampPosition(position: Vec2): Vec2 | null {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return null;
  return {
    x: clamp(position.x, 0, WORLD.width),
    y: clamp(position.y, 0, WORLD.height),
  };
}

function squaredDistance(a: Vec2, b: Vec2) {
  const x = a.x - b.x;
  const y = a.y - b.y;
  return x * x + y * y;
}

function createEmptyTotals(): TerritoryTotals {
  return { player: 0, rival: 0, neutral: 0, contested: 0 };
}

function mapTotals(
  totals: TerritoryTotals,
  mapValue: (value: number) => number,
): TerritoryTotals {
  return {
    player: mapValue(totals.player),
    rival: mapValue(totals.rival),
    neutral: mapValue(totals.neutral),
    contested: mapValue(totals.contested),
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
