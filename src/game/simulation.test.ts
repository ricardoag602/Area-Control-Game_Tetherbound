import { describe, expect, it } from "vitest";
import { GAME_RULES } from "./constants";
import {
  advanceGame,
  advanceMatch,
  canDeployAnchor,
  deployAnchor,
  isInsideSafeZone,
} from "./simulation";
import { createInitialGameState } from "./state";

describe("Tetherbound simulation", () => {
  it("recognizes the home base as a safe zone", () => {
    const state = createInitialGameState();
    expect(isInsideSafeZone(state, "player", state.players.player.basePosition)).toBe(true);
  });

  it("drains oxygen outside the network", () => {
    const state = createInitialGameState();
    state.players.player.astronaut.position = { x: 10, y: 80 };
    const next = advanceGame(state, { moveTarget: null }, 1);
    expect(next.players.player.astronaut.oxygen).toBe(
      GAME_RULES.oxygenMaximum - GAME_RULES.oxygenDrainPerSecond,
    );
  });

  it("deploys an anchor only within connection range", () => {
    const state = createInitialGameState();
    state.players.player.astronaut.position = { x: 50, y: 122 };
    expect(canDeployAnchor(state, "player")).toBe(true);

    const deployed = deployAnchor(state, "player");
    expect(deployed.anchors.filter((anchor) => anchor.owner === "player")).toHaveLength(1);
    expect(deployed.players.player.astronaut.tetherKits).toBe(1);
  });

  it("respawns at the base when oxygen is exhausted", () => {
    const state = createInitialGameState();
    state.players.player.astronaut.position = { x: 10, y: 80 };
    state.players.player.astronaut.oxygen = 1;
    state.players.player.astronaut.carriedSalvage = 2;

    const next = advanceGame(state, { moveTarget: null }, 1);
    expect(next.players.player.astronaut.position).toEqual(state.players.player.basePosition);
    expect(next.players.player.astronaut.carriedSalvage).toBe(0);
    expect(next.players.player.astronaut.respawns).toBe(1);
  });

  it("awards a contested salvage deposit to the closest astronaut", () => {
    const state = createInitialGameState();
    state.salvage = [
      { id: "contested", position: { x: 50, y: 80 }, collected: false },
    ];
    state.players.player.astronaut.position = { x: 47, y: 80 };
    state.players.rival.astronaut.position = { x: 49, y: 80 };

    const next = advanceMatch(
      state,
      { player: { moveTarget: null }, rival: { moveTarget: null } },
      0,
    );

    expect(next.salvage[0].collected).toBe(true);
    expect(next.players.player.astronaut.carriedSalvage).toBe(0);
    expect(next.players.rival.astronaut.carriedSalvage).toBe(1);
  });

  it("alternates exact-distance salvage ties between player slots", () => {
    const state = createInitialGameState();
    state.salvage = [
      { id: "tie-one", position: { x: 49.5, y: 80 }, collected: false },
      { id: "tie-two", position: { x: 50.5, y: 80 }, collected: false },
    ];
    state.players.player.astronaut.position = { x: 50, y: 80 };
    state.players.rival.astronaut.position = { x: 50, y: 80 };

    const next = advanceMatch(
      state,
      { player: { moveTarget: null }, rival: { moveTarget: null } },
      0,
    );

    expect(next.salvage.every((deposit) => deposit.collected)).toBe(true);
    expect(next.players.player.astronaut.carriedSalvage).toBe(1);
    expect(next.players.rival.astronaut.carriedSalvage).toBe(1);
  });

  it("still delivers newly collected salvage at a powered node", () => {
    const state = createInitialGameState();
    const base = state.players.player.basePosition;
    state.players.player.astronaut.position = { ...base };
    state.salvage = [{ id: "delivery", position: { ...base }, collected: false }];

    const next = advanceGame(state, { moveTarget: null }, 0);

    expect(next.salvage[0].collected).toBe(true);
    expect(next.players.player.astronaut.carriedSalvage).toBe(0);
    expect(next.players.player.astronaut.bankedSalvage).toBe(1);
  });
});
