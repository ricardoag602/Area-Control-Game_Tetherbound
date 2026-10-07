import { describe, expect, it } from "vitest";
import { GAME_RULES } from "./constants";
import { advanceGame, canDeployAnchor, deployAnchor, isInsideSafeZone } from "./simulation";
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
});
