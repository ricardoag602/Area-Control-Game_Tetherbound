import { describe, expect, it } from "vitest";
import { WORLD } from "../constants";
import { createInitialGameState } from "../state";
import { sampleTerritoryGrid, type TerritoryGrid } from "./territory";
import type { Anchor, GameState, PlayerId, Vec2 } from "../types";

describe("territory grid", () => {
  it("uses ten-unit pixel blocks across the full enlarged arena", () => {
    const grid = sampleTerritoryGrid(createInitialGameState());

    expect(grid.columns).toBe(35);
    expect(grid.rows).toBe(35);
    expect(grid.cellWidth).toBe(10);
    expect(grid.cellHeight).toBe(10);
    expect(grid.cells.at(-1)?.position).toEqual({
      x: WORLD.width - 5,
      y: WORLD.height - 5,
    });
  });

  it("claims blocks around each home base", () => {
    const state = createInitialGameState();
    const grid = sampleTerritoryGrid(state);

    expect(ownerNearest(grid, state.players.player.basePosition)).toBe("player");
    expect(ownerNearest(grid, state.players.rival.basePosition)).toBe("rival");
    expect(grid.totals.player).toBeGreaterThan(0);
    expect(grid.totals.rival).toBeGreaterThan(0);
  });

  it("extends claims from powered anchors and ignores unpowered anchors", () => {
    const state = stateWithDistantBases();
    state.anchors = [
      anchor("powered", "player", { x: 25, y: 155 }, true),
      anchor("unpowered", "rival", { x: 195, y: 155 }, false),
    ];

    const grid = sampleTerritoryGrid(state);

    expect(ownerNearest(grid, { x: 25, y: 155 })).toBe("player");
    expect(ownerNearest(grid, { x: 195, y: 155 })).toBe("neutral");
  });

  it("marks all overlapping coverage as contested", () => {
    const state = stateWithDistantBases();
    state.anchors = [
      anchor("player-anchor", "player", { x: 85, y: 155 }),
      anchor("rival-anchor", "rival", { x: 125, y: 155 }),
    ];

    const grid = sampleTerritoryGrid(state);

    expect(ownerAt(grid, 105, 155)).toBe("contested");
    expect(ownerAt(grid, 85, 155)).toBe("player");
    expect(ownerAt(grid, 125, 155)).toBe("rival");
  });

  it("marks exact nearest-node ties as contested", () => {
    const state = stateWithDistantBases();
    state.anchors = [
      anchor("player-anchor", "player", { x: 85, y: 155 }),
      anchor("rival-anchor", "rival", { x: 125, y: 155 }),
    ];

    const grid = sampleTerritoryGrid(state);

    expect(ownerAt(grid, 105, 155)).toBe("contested");
    expect(grid.totals.contested).toBeGreaterThan(0);
  });

  it("keeps mirrored starting networks perfectly symmetric", () => {
    const state = createInitialGameState();
    const playerBase = state.players.player.basePosition;
    state.players.rival.basePosition = {
      x: playerBase.x,
      y: WORLD.height - playerBase.y,
    };
    state.anchors = [
      anchor("player-anchor", "player", { x: 85, y: WORLD.height - 55 }),
      anchor("rival-anchor", "rival", { x: 85, y: 55 }),
    ];

    const grid = sampleTerritoryGrid(state);

    expect(grid.totals.player).toBe(grid.totals.rival);
    expect(grid.score.player).toBeCloseTo(grid.score.rival, 12);
  });

  it("scores every state against the full map and stays within bounds", () => {
    const state = createInitialGameState();
    state.anchors = [
      anchor("edge-player", "player", { x: -100, y: WORLD.height / 2 }),
      anchor("edge-rival", "rival", { x: WORLD.width + 100, y: WORLD.height / 2 }),
    ];

    const grid = sampleTerritoryGrid(state, { columns: 23.9, rows: 31.8 });
    const states = ["player", "rival", "neutral", "contested"] as const;

    expect(grid.columns).toBe(23);
    expect(grid.rows).toBe(31);
    expect(grid.cells).toHaveLength(grid.columns * grid.rows);
    expect(states.reduce((sum, owner) => sum + grid.totals[owner], 0)).toBe(
      grid.cells.length,
    );
    expect(states.reduce((sum, owner) => sum + grid.score[owner], 0)).toBeCloseTo(
      100,
      12,
    );

    for (const owner of states) {
      expect(grid.score[owner]).toBeGreaterThanOrEqual(0);
      expect(grid.score[owner]).toBeLessThanOrEqual(100);
    }

    expect(ownerNearest(grid, { x: 0, y: WORLD.height / 2 })).toBe("player");
    expect(ownerNearest(grid, { x: WORLD.width, y: WORLD.height / 2 })).toBe("rival");
  });
});

function stateWithDistantBases(): GameState {
  const state = createInitialGameState();
  state.players.player.basePosition = { x: 5, y: 5 };
  state.players.rival.basePosition = { x: WORLD.width - 5, y: WORLD.height - 5 };
  state.anchors = [];
  return state;
}

function anchor(
  id: string,
  owner: PlayerId,
  position: Vec2,
  powered = true,
): Anchor {
  return {
    id,
    owner,
    position,
    parentId: `${owner}-base`,
    powered,
    disruptedUntilMs: null,
    protectedUntilMs: null,
    overloadProgress: 0,
    repairProgress: 0,
  };
}

function ownerAt(grid: TerritoryGrid, x: number, y: number) {
  return grid.cells.find(
    (cell) => Math.abs(cell.position.x - x) < 1e-9 && Math.abs(cell.position.y - y) < 1e-9,
  )?.owner;
}

function ownerNearest(grid: TerritoryGrid, position: Vec2) {
  let nearest = grid.cells[0];
  let nearestDistanceSquared = Number.POSITIVE_INFINITY;

  for (const cell of grid.cells) {
    const x = cell.position.x - position.x;
    const y = cell.position.y - position.y;
    const distanceSquared = x * x + y * y;
    if (distanceSquared < nearestDistanceSquared) {
      nearest = cell;
      nearestDistanceSquared = distanceSquared;
    }
  }

  expect(nearest).toBeDefined();
  return nearest?.owner;
}
