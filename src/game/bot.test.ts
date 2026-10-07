import { describe, expect, it } from "vitest";
import { getBotCommand } from "./bot";
import { applyPlayerCommands } from "./playerController";
import { createInitialGameState } from "./state";

describe("basic bot controller", () => {
  it("moves toward the nearest available salvage", () => {
    const state = createInitialGameState();

    const command = getBotCommand(state, "rival");

    expect(command.moveTarget).toEqual({ x: 31, y: 51 });
  });

  it("returns to its nearest powered node when carrying three salvage", () => {
    const state = createInitialGameState();
    state.players.rival.astronaut.carriedSalvage = 3;

    const command = getBotCommand(state, "rival");

    expect(command.moveTarget).toEqual(state.players.rival.basePosition);
  });

  it("requests deployment only when the shared rules allow it", () => {
    const state = createInitialGameState();
    expect(getBotCommand(state, "rival").deployAnchor).toBe(true);

    state.players.rival.astronaut.tetherKits = 0;
    expect(getBotCommand(state, "rival").deployAnchor).toBe(false);
  });

  it("runs human and bot commands through the same command pipeline", () => {
    const state = createInitialGameState();
    const next = applyPlayerCommands(
      state,
      {
        player: { moveTarget: { x: 50, y: 100 }, deployAnchor: true },
        rival: getBotCommand(state, "rival"),
      },
      0.1,
    );

    expect(next.players.player.astronaut.position.y).toBeLessThan(
      state.players.player.astronaut.position.y,
    );
    expect(next.players.rival.astronaut.position.y).toBeGreaterThan(
      state.players.rival.astronaut.position.y,
    );
    expect(next.anchors.filter((anchor) => anchor.owner === "player")).toHaveLength(1);
    expect(next.anchors.filter((anchor) => anchor.owner === "rival")).toHaveLength(1);
  });
});
