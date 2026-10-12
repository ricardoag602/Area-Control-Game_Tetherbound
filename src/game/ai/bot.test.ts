import { describe, expect, it } from "vitest";
import { GAME_RULES } from "../constants";
import { getBotCommand } from "./bot";
import { applyPlayerCommands } from "../simulation/playerController";
import { createInitialGameState } from "../state";
import type { Anchor } from "../types";

describe("basic bot controller", () => {
  it("moves toward the nearest available salvage", () => {
    const state = createInitialGameState();

    const command = getBotCommand(state, "rival");

    const target = command.movementCommands[0];
    expect(target?.type).toBe("walk");
    if (target?.type !== "walk") throw new Error("Expected bot to walk");
    expect(state.salvage.some((deposit) =>
      deposit.position.x === target.target.x && deposit.position.y === target.target.y,
    )).toBe(true);
  });

  it("returns to its nearest powered node when carrying a full load", () => {
    const state = createInitialGameState();
    state.players.rival.astronaut.carriedSalvage = GAME_RULES.salvageCarryLimit;

    const command = getBotCommand(state, "rival");

    expect(command.movementCommands).toEqual([
      { type: "walk", target: state.players.rival.basePosition },
    ]);
  });

  it("saves tether kits for meaningful long-link extensions", () => {
    const state = createInitialGameState();
    const base = state.players.rival.basePosition;
    expect(getBotCommand(state, "rival").deployAnchor).toBe(false);

    state.players.rival.astronaut.position = {
      x: base.x + GAME_RULES.maximumLinkDistance * 0.75,
      y: base.y,
    };
    expect(getBotCommand(state, "rival").deployAnchor).toBe(true);

    state.players.rival.astronaut.tetherKits = 0;
    expect(getBotCommand(state, "rival").deployAnchor).toBe(false);
  });

  it("never requests deployment beyond the authoritative link range", () => {
    const state = createInitialGameState();
    const base = state.players.rival.basePosition;
    state.players.rival.astronaut.position = {
      x: base.x + GAME_RULES.maximumLinkDistance + 0.001,
      y: base.y,
    };

    expect(getBotCommand(state, "rival").deployAnchor).toBe(false);
  });

  it("pressures a nearby enemy anchor when oxygen is healthy", () => {
    const state = createInitialGameState();
    const target = anchor("target", "player", { x: 105, y: 35 });
    state.anchors = [target];
    state.players.rival.astronaut.position = { x: 105, y: 20 };

    const command = getBotCommand(state, "rival");

    expect(command.movementCommands).toEqual([
      { type: "walk", target: target.position },
    ]);
    expect(command.deployAnchor).toBe(false);
  });

  it("prioritizes reconnecting a nearby disrupted branch", () => {
    const state = createInitialGameState();
    const damaged = {
      ...anchor("damaged", "rival", { x: 105, y: 35 }),
      powered: false,
      disruptedUntilMs: 10_000,
    };
    state.anchors = [
      damaged,
      anchor("enemy", "player", { x: 105, y: 42 }),
    ];
    state.players.rival.astronaut.position = { x: 105, y: 28 };

    expect(getBotCommand(state, "rival").movementCommands).toEqual([
      { type: "walk", target: damaged.position },
    ]);
  });

  it("returns to defend its base during an active collapse attempt", () => {
    const state = createInitialGameState();
    state.matchPhase = "regulation";
    state.baseCollapseProgressMs.rival = 1_000;
    state.players.rival.astronaut.position = { x: 105, y: 100 };

    const command = getBotCommand(state, "rival");

    expect(command.movementCommands).toEqual([
      { type: "walk", target: state.players.rival.basePosition },
    ]);
    expect(command.deployAnchor).toBe(false);
  });

  it("presses an exposed enemy base after setup", () => {
    const state = createInitialGameState();
    state.matchPhase = "regulation";
    state.hasDeployedAnchor.player = true;
    state.anchors = [
      {
        ...anchor("player-offline", "player", { x: 105, y: 300 }),
        powered: false,
        disruptedUntilMs: state.elapsedMs + GAME_RULES.anchorDisruptionDurationMs,
      },
    ];
    state.players.rival.astronaut.position = { x: 105, y: 100 };

    const command = getBotCommand(state, "rival");

    expect(command.movementCommands).toEqual([
      { type: "walk", target: state.players.player.basePosition },
    ]);
    expect(command.deployAnchor).toBe(false);
  });

  it("runs human and bot commands through the same command pipeline", () => {
    const state = createInitialGameState();
    state.players.rival.astronaut.position = {
      x: state.players.rival.basePosition.x +
        GAME_RULES.maximumLinkDistance * 0.75,
      y: state.players.rival.basePosition.y,
    };
    const next = applyPlayerCommands(
      state,
      {
        player: {
          movementCommands: [{ type: "walk", target: { x: 50, y: 100 } }],
          deployAnchor: true,
        },
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

  it("produces a side-neutral control match on the symmetric static arena", () => {
    let state = createInitialGameState("static-balance-control");
    state.worldTimeline.nextEventTick = Number.MAX_SAFE_INTEGER;

    for (let tick = 0; tick < 20_000 && state.matchPhase !== "finished"; tick += 1) {
      state = applyPlayerCommands(
        state,
        {
          player: getBotCommand(state, "player"),
          rival: getBotCommand(state, "rival"),
        },
        0.05,
      );
    }

    expect(state.matchOutcome).toEqual({
      winner: "draw",
      reason: "overtime_territory",
    });
    expect(state.scores.player).toBeCloseTo(state.scores.rival, 10);
    expect(state.anchors.filter((anchor) => anchor.owner === "player")).toHaveLength(
      state.anchors.filter((anchor) => anchor.owner === "rival").length,
    );
  });

  it("stops issuing movement and deployment commands after the match ends", () => {
    const state = createInitialGameState();
    state.remainingMs = 0;

    expect(getBotCommand(state, "rival")).toEqual({
      movementCommands: [{ type: "stop" }],
      deployAnchor: false,
    });
  });
});

function anchor(
  id: string,
  owner: "player" | "rival",
  position: { x: number; y: number },
): Anchor {
  return {
    id,
    owner,
    position,
    parentId: `${owner}-base`,
    powered: true,
    disruptedUntilMs: null,
    protectedUntilMs: null,
    overloadProgress: 0,
    repairProgress: 0,
  };
}
