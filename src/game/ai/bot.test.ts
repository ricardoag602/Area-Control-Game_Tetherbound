import { describe, expect, it } from "vitest";
import { GAME_RULES } from "../constants";
import { cancelMovement, MOVEMENT_RULES } from "../movement/movement";
import { applyPlayerCommands } from "../simulation/playerController";
import { createInitialGameState } from "../state";
import type { Anchor, GameState, MovementCommand, PlayerId, Vec2 } from "../types";
import {
  advanceBotController,
  createBotControllerState,
  getBotCommand,
} from "./bot";

const STEP_SECONDS = 0.05;
const PLAYER_COMMAND_TYPES = new Set<MovementCommand["type"]>([
  "walk",
  "stop",
  "tank_drive",
  "tank_charge",
  "tank_release",
]);

describe("fair bot controller", () => {
  it("starts with a strategic salvage objective using an ordinary player walk", () => {
    const state = createInitialGameState();
    const step = advanceBotController(state, "rival", createBotControllerState());

    expect(step.controller.objective?.kind).toBe("expand");
    expect(step.command.movementCommands[0]?.type).toBe("walk");
    const target = step.command.movementCommands[0];
    if (target?.type !== "walk") throw new Error("Expected bot to walk");
    expect(state.salvage.some((deposit) =>
      !deposit.collected && samePosition(deposit.position, target.target),
    )).toBe(true);
  });

  it("only emits movement commands that the live player controls emit", () => {
    let state = createInitialGameState("command-whitelist");
    let controller = createBotControllerState();
    const observed = new Set<MovementCommand["type"]>();

    for (let tick = 0; tick < 1_600 && state.matchPhase !== "finished"; tick += 1) {
      const step = advanceBotController(state, "rival", controller);
      controller = step.controller;
      for (const movementCommand of step.command.movementCommands) {
        observed.add(movementCommand.type);
        expect(PLAYER_COMMAND_TYPES.has(movementCommand.type)).toBe(true);
      }
      state = applyPlayerCommands(state, { rival: step.command }, STEP_SECONDS);
    }

    expect(observed.has("walk")).toBe(true);
    expect(observed.has("tank_drive")).toBe(true);
    expect(observed.has("tank_charge")).toBe(true);
    expect(observed.has("tank_release")).toBe(true);
  });

  it("thinks at a human-scale cadence and commits briefly to its objective", () => {
    const state = createInitialGameState();
    const first = advanceBotController(state, "rival", createBotControllerState());
    const originalTargetId = first.controller.objective?.targetId;
    expect(originalTargetId).toBeTruthy();

    const tempting = cloneState(state);
    tempting.elapsedMs = 250;
    tempting.salvage.unshift({
      id: "suddenly-closer",
      position: {
        x: tempting.players.rival.astronaut.position.x + 1,
        y: tempting.players.rival.astronaut.position.y,
      },
      collected: false,
    });
    const held = advanceBotController(tempting, "rival", first.controller);
    expect(held.controller.objective?.targetId).toBe(originalTargetId);

    tempting.elapsedMs = 1_000;
    const reconsidered = advanceBotController(tempting, "rival", held.controller);
    expect(reconsidered.controller.objective?.targetId).toBe("suddenly-closer");
  });

  it("uses a real arm, imperfect charge, and release sequence with cooldown", () => {
    let state = createInitialGameState("boost-sequence");
    state.salvage = [{ id: "far", position: { x: 175, y: 150 }, collected: false }];
    let controller = createBotControllerState();

    let result = advanceBotController(state, "rival", controller);
    expect(result.command.movementCommands[0]?.type).toBe("walk");
    expect(result.controller.boostPhase).toBe("aligning");
    ({ state, controller } = applyBotStep(state, result));

    while (state.elapsedMs < 200) {
      result = advanceBotController(state, "rival", controller);
      expect(result.command.movementCommands).toEqual([]);
      ({ state, controller } = applyBotStep(state, result));
    }

    result = advanceBotController(state, "rival", controller);
    expect(result.command.movementCommands).toEqual([
      { type: "tank_drive", throttle: 1, steering: 0 },
    ]);
    ({ state, controller } = applyBotStep(state, result));

    while (state.elapsedMs - result.controller.boostPhaseStartedAtMs < 120) {
      result = advanceBotController(state, "rival", controller);
      expect(result.command.movementCommands).toEqual([]);
      ({ state, controller } = applyBotStep(state, result));
    }

    result = advanceBotController(state, "rival", controller);
    expect(result.command.movementCommands).toEqual([
      { type: "tank_charge", throttle: 1, steering: 0 },
    ]);
    ({ state, controller } = applyBotStep(state, result));

    let chargeBeforeRelease = 0;
    do {
      chargeBeforeRelease = state.players.rival.astronaut.movement.chargeSeconds;
      result = advanceBotController(state, "rival", controller);
      ({ state, controller } = applyBotStep(state, result));
    } while (result.command.movementCommands[0]?.type !== "tank_release");

    expect(chargeBeforeRelease).toBeGreaterThanOrEqual(0.56);
    expect(chargeBeforeRelease).toBeLessThan(0.8);
    expect(state.players.rival.astronaut.movement.mode).toBe("burst");

    const cooldownUntil = controller.boostCooldownUntilMs;
    while (state.elapsedMs < cooldownUntil - 50 && state.matchPhase !== "finished") {
      result = advanceBotController(state, "rival", controller);
      expect(result.command.movementCommands[0]?.type).not.toBe("tank_charge");
      ({ state, controller } = applyBotStep(state, result));
    }
  });

  it("projects the trip home and retreats before a fixed low-oxygen cutoff", () => {
    const state = createInitialGameState();
    const base = state.players.rival.basePosition;
    state.players.rival.astronaut.position = { x: base.x, y: base.y + 74 };
    state.players.rival.astronaut.oxygen = 55;

    const step = advanceBotController(state, "rival", createBotControllerState());

    expect(step.controller.objective?.kind).toBe("retreat");
    expect(step.command.movementCommands).toEqual([
      { type: "walk", target: base },
    ]);
  });

  it("stays in a safe zone until oxygen recovery clears its hysteresis", () => {
    const state = createInitialGameState();
    const base = state.players.rival.basePosition;
    state.players.rival.astronaut.position = { x: base.x, y: base.y + 8 };
    state.players.rival.astronaut.oxygen = 24;
    const controller = {
      ...createBotControllerState(),
      objective: {
        kind: "retreat" as const,
        target: { ...base },
        targetId: "rival-base",
      },
      objectiveLockedUntilMs: 1_000,
    };

    let step = advanceBotController(state, "rival", controller);
    expect(step.controller.objective?.kind).toBe("retreat");
    expect(step.command.movementCommands).toEqual([]);

    state.elapsedMs = 750;
    state.players.rival.astronaut.oxygen = 79;
    step = advanceBotController(state, "rival", step.controller);
    expect(step.controller.objective?.kind).toBe("retreat");
    expect(step.controller.boostPhase).toBe("idle");

    state.elapsedMs = 1_000;
    state.players.rival.astronaut.oxygen = 80;
    step = advanceBotController(state, "rival", step.controller);
    expect(step.controller.objective?.kind).not.toBe("retreat");
    expect(step.controller.boostPhase).toBe("idle");
  });

  it("stops and decelerates before replacing a moving target", () => {
    const state = createInitialGameState();
    const astronaut = state.players.rival.astronaut;
    astronaut.position = { x: 100, y: 100 };
    astronaut.movement = {
      ...astronaut.movement,
      mode: "walking",
      target: { x: 100, y: 150 },
      direction: { x: 0, y: 1 },
      facing: { x: 0, y: 1 },
      velocity: { x: 0, y: 15.6 },
    };
    state.salvage = [
      { id: "reverse", position: { x: 100, y: 20 }, collected: false },
    ];
    const controller = {
      ...createBotControllerState(),
      objective: {
        kind: "expand" as const,
        target: { x: 100, y: 20 },
        targetId: "reverse",
      },
      objectiveLockedUntilMs: 1_000,
    };

    const step = advanceBotController(state, "rival", controller);
    expect(step.command.movementCommands).toEqual([{ type: "stop" }]);

    const next = applyPlayerCommands(
      state,
      { rival: step.command },
      STEP_SECONDS,
    );
    expect(traveled(astronaut.position, next.players.rival.astronaut.position))
      .toBeLessThanOrEqual(0.001);
  });

  it("prioritizes base defense, critical repair, and needed banking", () => {
    const defend = createInitialGameState();
    defend.matchPhase = "regulation";
    defend.baseCollapseProgressMs.rival = 500;
    let step = advanceBotController(defend, "rival", createBotControllerState());
    expect(step.controller.objective?.kind).toBe("defend");

    const repair = createInitialGameState();
    repair.elapsedMs = 1_000;
    repair.players.rival.astronaut.position = { x: 175, y: 75 };
    const critical = disruptedAnchor("critical", "rival", { x: 175, y: 50 }, 8_000);
    const child = anchor("child", "rival", { x: 175, y: 70 }, "critical");
    const nearer = disruptedAnchor("nearer", "rival", { x: 175, y: 72 }, 8_000);
    repair.anchors = [critical, child, nearer];
    step = advanceBotController(repair, "rival", createBotControllerState());
    expect(step.controller.objective).toMatchObject({ kind: "repair", targetId: "critical" });

    const bank = createInitialGameState();
    bank.players.rival.astronaut.tetherKits = 0;
    bank.players.rival.astronaut.carriedSalvage = GAME_RULES.salvagePerTether;
    step = advanceBotController(bank, "rival", createBotControllerState());
    expect(step.controller.objective?.kind).toBe("bank");
  });

  it("takes a nearby structural attack only with healthy oxygen", () => {
    const state = createInitialGameState();
    state.matchPhase = "regulation";
    state.players.rival.astronaut.position = { x: 175, y: 80 };
    state.anchors = [anchor("enemy", "player", { x: 175, y: 90 })];

    let step = advanceBotController(state, "rival", createBotControllerState());
    expect(step.controller.objective).toMatchObject({
      kind: "attack_anchor",
      targetId: "enemy",
    });

    state.players.rival.astronaut.oxygen = 40;
    step = advanceBotController(state, "rival", createBotControllerState());
    expect(step.controller.objective?.kind).not.toBe("attack_anchor");
  });

  it("waits through a reaction window before a legal deployment", () => {
    const state = createInitialGameState();
    const base = state.players.rival.basePosition;
    state.players.rival.astronaut.position = {
      x: base.x + GAME_RULES.maximumLinkDistance * 0.7,
      y: base.y,
    };
    state.players.rival.astronaut.movement = cancelMovement(
      state.players.rival.astronaut.movement,
    );

    const first = advanceBotController(state, "rival", createBotControllerState());
    expect(first.command.deployAnchor).toBe(false);
    expect(first.controller.deployEligibleSinceMs).toBe(0);

    state.elapsedMs = 250;
    const waiting = advanceBotController(state, "rival", first.controller);
    expect(waiting.command.deployAnchor).toBe(false);

    state.elapsedMs = 300;
    const deployed = advanceBotController(state, "rival", waiting.controller);
    expect(deployed.command.deployAnchor).toBe(true);

    state.players.rival.astronaut.position.x =
      base.x + GAME_RULES.maximumLinkDistance + 0.01;
    state.elapsedMs = 1_000;
    const illegal = advanceBotController(state, "rival", deployed.controller);
    expect(illegal.command.deployAnchor).toBe(false);
  });

  it("runs human and bot commands through the same authoritative pipeline", () => {
    const state = createInitialGameState();
    const bot = getBotCommand(state, "rival");
    const beforePlayer = { ...state.players.player.astronaut.position };
    const beforeBot = { ...state.players.rival.astronaut.position };
    const target = bot.movementCommands[0];
    if (target?.type !== "walk") throw new Error("Expected a walk decision");

    const next = applyPlayerCommands(
      state,
      {
        player: { movementCommands: [{ type: "walk", target: target.target }], deployAnchor: false },
        rival: bot,
      },
      STEP_SECONDS,
    );

    expect(traveled(beforePlayer, next.players.player.astronaut.position)).toBeCloseTo(
      traveled(beforeBot, next.players.rival.astronaut.position),
      8,
    );
    expect(next.players.player.astronaut.movement.lastCommandSequence).toBe(1);
    expect(next.players.rival.astronaut.movement.lastCommandSequence).toBe(1);
  });

  it("replays deterministically from the same seed and inputs", () => {
    const first = runSoloBot("deterministic-bot", 1_200);
    const second = runSoloBot("deterministic-bot", 1_200);
    expect(second).toEqual(first);
  });

  it("remains side-neutral when both sides use the same controller", () => {
    let state = createInitialGameState("static-balance-control");
    state.worldTimeline.nextEventTick = Number.MAX_SAFE_INTEGER;
    let playerController = createBotControllerState();
    let rivalController = createBotControllerState();

    for (let tick = 0; tick < 20_000 && state.matchPhase !== "finished"; tick += 1) {
      const playerStep = advanceBotController(state, "player", playerController);
      const rivalStep = advanceBotController(state, "rival", rivalController);
      playerController = playerStep.controller;
      rivalController = rivalStep.controller;
      state = applyPlayerCommands(
        state,
        { player: playerStep.command, rival: rivalStep.command },
        STEP_SECONDS,
      );
    }

    expect(state.matchOutcome).toEqual({
      winner: "draw",
      reason: "overtime_territory",
    });
    expect(state.scores.player).toBeCloseTo(state.scores.rival, 8);
    expect(state.players.player.astronaut.respawns).toBe(
      state.players.rival.astronaut.respawns,
    );
  });

  it("avoids impossible movement and oxygen respawns across live-world seeds", () => {
    const maximumLegalTickTravel = 0.05 + STEP_SECONDS * MOVEMENT_RULES.burstSpeed;

    for (const seed of ["a", "c", "f", "h"]) {
      let state = createInitialGameState(seed);
      let controller = createBotControllerState();
      let maximumObservedTravel = 0;

      for (let tick = 0; tick < 7_200 && state.matchPhase !== "finished"; tick += 1) {
        const before = { ...state.players.rival.astronaut.position };
        const respawnsBefore = state.players.rival.astronaut.respawns;
        const step = advanceBotController(state, "rival", controller);
        controller = step.controller;
        state = applyPlayerCommands(state, { rival: step.command }, STEP_SECONDS);
        const respawned = state.players.rival.astronaut.respawns > respawnsBefore;
        if (!respawned) {
          maximumObservedTravel = Math.max(
            maximumObservedTravel,
            traveled(before, state.players.rival.astronaut.position),
          );
        }
      }

      expect(maximumObservedTravel, `seed ${seed} legal movement`).toBeLessThanOrEqual(
        maximumLegalTickTravel,
      );
      expect(state.players.rival.astronaut.respawns, `seed ${seed} oxygen safety`).toBe(0);
    }
  });

  it("stops after the match finishes", () => {
    const state = createInitialGameState();
    state.matchPhase = "finished";
    state.remainingMs = 0;

    expect(
      advanceBotController(state, "rival", createBotControllerState()).command,
    ).toEqual({
      movementCommands: [{ type: "stop" }],
      deployAnchor: false,
    });
  });
});

function applyBotStep(
  state: GameState,
  result: ReturnType<typeof advanceBotController>,
) {
  return {
    state: applyPlayerCommands(state, { rival: result.command }, STEP_SECONDS),
    controller: result.controller,
  };
}

function runSoloBot(seed: string, ticks: number) {
  let state = createInitialGameState(seed);
  let controller = createBotControllerState();
  for (let tick = 0; tick < ticks && state.matchPhase !== "finished"; tick += 1) {
    const result = advanceBotController(state, "rival", controller);
    controller = result.controller;
    state = applyPlayerCommands(state, { rival: result.command }, STEP_SECONDS);
  }
  return { state, controller };
}

function anchor(
  id: string,
  owner: PlayerId,
  position: Vec2,
  parentId = `${owner}-base`,
): Anchor {
  return {
    id,
    owner,
    position,
    parentId,
    powered: true,
    disruptedUntilMs: null,
    protectedUntilMs: null,
    overloadProgress: 0,
    repairProgress: 0,
  };
}

function disruptedAnchor(
  id: string,
  owner: PlayerId,
  position: Vec2,
  disruptedUntilMs: number,
) {
  return {
    ...anchor(id, owner, position),
    powered: false,
    disruptedUntilMs,
  };
}

function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

function samePosition(a: Vec2, b: Vec2) {
  return a.x === b.x && a.y === b.y;
}

function traveled(from: Vec2, to: Vec2) {
  return Math.hypot(to.x - from.x, to.y - from.y);
}
