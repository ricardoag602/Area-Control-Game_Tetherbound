import { describe, expect, it } from "vitest";
import { GAME_RULES, WORLD } from "../constants";
import { createInitialGameState } from "../state";
import type { Anchor, GameState, PlayerId, Vec2 } from "../types";
import { createWorldTimeline } from "../world/timeline";
import { advanceMatch } from "./match";
import { deployAnchor } from "./tetherNetwork";
import {
  getScorableTerritoryFraction,
  normalizeMatchState,
  sampleScorableTerritory,
} from "./scoring";

describe("authoritative match scoring", () => {
  it("excludes both guaranteed base zones and contested cells", () => {
    const state = regulationState();
    const empty = sampleScorableTerritory(state);

    expect(empty.totals).toEqual({ player: 0, rival: 0 });
    expect(empty.totalCells).toBeLessThan(21 * 35);

    state.anchors = [
      anchor("player-claim", "player", { x: 80, y: 175 }),
      anchor("rival-claim", "rival", { x: 120, y: 175 }),
    ];
    const claimed = sampleScorableTerritory(state);

    expect(claimed.totals.player).toBeGreaterThan(0);
    expect(claimed.totals.rival).toBeGreaterThan(0);
    expect(claimed.totals.player + claimed.totals.rival)
      .toBeLessThan(claimed.totalCells);
    expect(getScorableTerritoryFraction(state, "player")).toBe(
      claimed.fractions.player,
    );
  });

  it("protects the 30-second setup from scoring and base collapse", () => {
    const state = createInitialGameState("setup-rules");
    state.elapsedMs = GAME_RULES.setupDurationMs - 50;
    state.remainingMs = GAME_RULES.matchDurationMs - state.elapsedMs;
    state.anchors = [
      anchor("player-claim", "player", { x: 80, y: 175 }),
      anchor("rival-offline", "rival", { x: 120, y: 175 }, false),
    ];
    state.hasDeployedAnchor.rival = true;
    state.baseCollapseProgressMs.rival = 5_000;
    state.players.player.astronaut.position = {
      ...state.players.rival.basePosition,
    };
    state.players.rival.astronaut.position = {
      x: state.players.rival.basePosition.x + 10,
      y: state.players.rival.basePosition.y,
    };

    const setupEnd = advanceMatch(state, {}, 0.05);

    expect(setupEnd.matchPhase).toBe("regulation");
    expect(setupEnd.scores).toEqual({ player: 0, rival: 0 });
    expect(setupEnd.baseCollapseProgressMs.rival).toBe(0);

    const firstScoredTick = advanceMatch(setupEnd, {}, 0.05);
    expect(firstScoredTick.scores.player).toBeGreaterThan(0);
  });

  it("awards the final minute at 1.5 times the normal rate", () => {
    const beforeSurge = regulationState();
    beforeSurge.remainingMs = GAME_RULES.scoreSurgeDurationMs + 50;
    beforeSurge.anchors = [anchor("claim", "player", { x: 80, y: 175 })];
    const normal = advanceMatch(beforeSurge, {}, 0.05);

    const duringSurge = regulationState();
    duringSurge.remainingMs = GAME_RULES.scoreSurgeDurationMs;
    duringSurge.anchors = [anchor("claim", "player", { x: 80, y: 175 })];
    const surge = advanceMatch(duringSurge, {}, 0.05);

    expect(surge.scores.player).toBeCloseTo(
      normal.scores.player * GAME_RULES.scoreSurgeMultiplier,
      10,
    );
  });

  it("enters overtime within three percent without applying the lead rule early", () => {
    const state = regulationState();
    state.remainingMs = 50;
    state.scores = { player: 200, rival: 194.1 };

    const overtime = advanceMatch(state, {}, 0.05);

    expect(overtime.matchPhase).toBe("overtime");
    expect(overtime.remainingMs).toBe(GAME_RULES.overtimeDurationMs);
    expect(overtime.matchOutcome).toBeNull();
    expect(overtime.overtimeScores).toEqual({ player: 0, rival: 0 });

    const firstOvertimeTick = advanceMatch(overtime, {}, 0.05);
    expect(firstOvertimeTick.matchPhase).toBe("overtime");
    expect(firstOvertimeTick.matchOutcome).toBeNull();
  });

  it("finishes regulation when the cumulative scores are outside three percent", () => {
    const state = regulationState();
    state.remainingMs = 50;
    state.scores = { player: 100, rival: 96.9 };

    const finished = advanceMatch(state, {}, 0.05);

    expect(finished.matchPhase).toBe("finished");
    expect(finished.matchOutcome).toEqual({
      winner: "player",
      reason: "regulation_score",
    });
  });

  it("ends overtime on a five-point overtime-only lead", () => {
    const state = overtimeState();
    state.scores = { player: 200, rival: 194.1 };
    state.overtimeScores = {
      player: GAME_RULES.overtimeLeadPoints - 0.01,
      rival: 0,
    };
    state.anchors = [anchor("claim", "player", { x: 80, y: 175 })];

    const finished = advanceMatch(state, {}, 1);

    expect(finished.matchOutcome).toEqual({
      winner: "player",
      reason: "overtime_lead",
    });
    expect(finished.remainingMs).toBeGreaterThan(0);
  });

  it("uses current scorable territory when the overtime cap expires", () => {
    const state = overtimeState();
    state.remainingMs = 50;
    state.anchors = [anchor("claim", "player", { x: 80, y: 175 })];

    const finished = advanceMatch(state, {}, 0.05);

    expect(finished.remainingMs).toBe(0);
    expect(finished.matchOutcome).toEqual({
      winner: "player",
      reason: "overtime_territory",
    });
  });

  it("declares a draw when the overtime territory tiebreak is level", () => {
    const state = overtimeState();
    state.remainingMs = 50;

    const finished = advanceMatch(state, {}, 0.05);

    expect(finished.matchOutcome).toEqual({
      winner: "draw",
      reason: "overtime_territory",
    });
  });

  it("does not generate supply drops during overtime", () => {
    const state = overtimeState();
    state.worldTimeline = createWorldTimeline("no-overtime-drops", {
      rules: {
        ticksPerSecond: 20,
        minimumIntervalTicks: 1,
        maximumIntervalTicks: 1,
        bounds: WORLD,
        eventWeights: { salvage_drop: 1, biome_weather: 0 },
      },
    });
    const salvageCount = state.salvage.length;

    const next = advanceMatch(state, {}, 0.05);

    expect(next.salvage).toHaveLength(salvageCount);
    expect(next.worldTimeline.processedThroughTick).toBe(0);
  });

  it("does not generate a supply drop on the regulation-to-overtime tick", () => {
    const state = regulationState();
    state.remainingMs = 50;
    state.scores = { player: 100, rival: 100 };
    state.worldTimeline = createWorldTimeline("no-boundary-drop", {
      rules: {
        ticksPerSecond: 20,
        minimumIntervalTicks: 1,
        maximumIntervalTicks: 1,
        bounds: WORLD,
        eventWeights: { salvage_drop: 1, biome_weather: 0 },
      },
    });
    const salvageCount = state.salvage.length;

    const next = advanceMatch(state, {}, 0.05);

    expect(next.matchPhase).toBe("overtime");
    expect(next.salvage).toHaveLength(salvageCount);
    expect(next.worldTimeline.processedThroughTick).toBe(0);
  });

  it("completes a realistic sever, travel, and 12-second base hold", () => {
    let state = regulationState();
    const rivalBase = state.players.rival.basePosition;
    state.anchors = [
      {
        ...anchor("rival-root", "rival", { x: rivalBase.x, y: rivalBase.y + 30 }, false),
        disruptedUntilMs: state.elapsedMs + GAME_RULES.anchorDisruptionDurationMs,
      },
      anchor("attacker-life-support", "player", { ...rivalBase }),
    ];
    state.hasDeployedAnchor.rival = true;
    state.players.player.astronaut.position = {
      x: rivalBase.x + GAME_RULES.baseCollapseRadius + 2,
      y: rivalBase.y,
    };
    state.players.rival.astronaut.position = {
      x: rivalBase.x - GAME_RULES.baseCollapseRadius - 2,
      y: rivalBase.y,
    };

    state = advanceMatch(state, {}, 5);
    expect(state.baseCollapseProgressMs.rival).toBe(0);
    expect(state.anchors.find((candidate) => candidate.id === "rival-root")?.powered)
      .toBe(false);

    state.players.player.astronaut.position = { ...rivalBase };
    const collapsed = advanceMatch(
      state,
      {},
      GAME_RULES.baseCollapseHoldMs / 1_000,
    );

    expect(GAME_RULES.anchorDisruptionDurationMs).toBeGreaterThan(
      5_000 + GAME_RULES.baseCollapseHoldMs,
    );
    expect(collapsed.matchOutcome).toEqual({
      winner: "player",
      reason: "base_collapse",
    });
  });

  it("keeps a base collapse-immune until its owner has deployed an anchor", () => {
    const state = regulationState();
    state.players.player.astronaut.position = {
      ...state.players.rival.basePosition,
    };
    state.players.rival.astronaut.position = {
      x: state.players.rival.basePosition.x + GAME_RULES.baseCollapseRadius + 2,
      y: state.players.rival.basePosition.y,
    };

    const next = advanceMatch(state, {}, 1);

    expect(next.hasDeployedAnchor.rival).toBe(false);
    expect(next.baseCollapseProgressMs.rival).toBe(0);
    expect(next.matchOutcome).toBeNull();
  });

  it("decays an abandoned hold, clears it faster when defended, and resets on power", () => {
    const state = vulnerableBaseState();
    state.baseCollapseProgressMs.rival = 6_000;
    const rivalBase = state.players.rival.basePosition;
    state.players.player.astronaut.position = { x: 20, y: 175 };
    state.players.rival.astronaut.position = {
      x: rivalBase.x + GAME_RULES.baseCollapseRadius + 2,
      y: rivalBase.y,
    };

    const abandoned = advanceMatch(state, {}, 1);
    expect(abandoned.baseCollapseProgressMs.rival).toBe(5_000);

    abandoned.players.rival.astronaut.position = { ...rivalBase };
    const defended = advanceMatch(abandoned, {}, 1);
    expect(defended.baseCollapseProgressMs.rival).toBe(2_000);

    defended.anchors[0] = {
      ...defended.anchors[0],
      powered: true,
      disruptedUntilMs: null,
    };
    const restored = advanceMatch(defended, {}, 0.05);
    expect(restored.baseCollapseProgressMs.rival).toBe(0);
  });

  it("clears collapse progress immediately when a defender deploys power", () => {
    const state = regulationState();
    const base = state.players.player.basePosition;
    state.hasDeployedAnchor.player = true;
    state.baseCollapseProgressMs.player = 6_000;
    state.players.player.astronaut.position = { x: base.x, y: base.y - 8 };

    const restored = deployAnchor(state, "player");

    expect(restored).not.toBe(state);
    expect(restored.anchors.at(-1)).toMatchObject({
      owner: "player",
      powered: true,
    });
    expect(restored.baseCollapseProgressMs.player).toBe(0);
  });

  it("normalizes active states serialized before the match-rule fields existed", () => {
    const legacy = createInitialGameState("legacy") as unknown as Record<string, unknown>;
    for (const field of [
      "matchPhase",
      "scores",
      "overtimeScores",
      "overtimeElapsedMs",
      "hasDeployedAnchor",
      "baseCollapseProgressMs",
      "matchOutcome",
    ]) {
      delete legacy[field];
    }
    legacy.elapsedMs = 31_000;
    legacy.remainingMs = GAME_RULES.matchDurationMs - 31_000;

    const normalized = normalizeMatchState(legacy as unknown as GameState);

    expect(normalized).toMatchObject({
      matchPhase: "regulation",
      scores: { player: 0, rival: 0 },
      overtimeScores: { player: 0, rival: 0 },
      overtimeElapsedMs: 0,
      hasDeployedAnchor: { player: false, rival: false },
      baseCollapseProgressMs: { player: 0, rival: 0 },
      matchOutcome: null,
    });
  });

  it("resolves an expired current regulation state from cumulative score", () => {
    const state = regulationState();
    state.remainingMs = 0;
    state.scores = { player: 10, rival: 1 };
    state.anchors = [anchor("rival-map-lead", "rival", { x: 80, y: 175 })];

    const normalized = normalizeMatchState(state);

    expect(normalized.matchPhase).toBe("finished");
    expect(normalized.matchOutcome).toEqual({
      winner: "player",
      reason: "regulation_score",
    });
  });

  it("restores an expired close regulation state into overtime", () => {
    const state = regulationState();
    state.remainingMs = 0;
    state.scores = { player: 100, rival: 98 };

    const normalized = normalizeMatchState(state);

    expect(normalized.matchPhase).toBe("overtime");
    expect(normalized.remainingMs).toBe(GAME_RULES.overtimeDurationMs);
    expect(normalized.overtimeScores).toEqual({ player: 0, rival: 0 });
    expect(normalized.matchOutcome).toBeNull();
  });

  it("uses live territory only for an expired legacy state without scores", () => {
    const legacy = createInitialGameState("expired-legacy") as unknown as Record<string, unknown>;
    for (const field of [
      "matchPhase",
      "scores",
      "overtimeScores",
      "overtimeElapsedMs",
      "matchOutcome",
    ]) {
      delete legacy[field];
    }
    legacy.remainingMs = 0;
    legacy.elapsedMs = GAME_RULES.matchDurationMs;
    legacy.anchors = [anchor("rival-map-lead", "rival", { x: 80, y: 175 })];

    const normalized = normalizeMatchState(legacy as unknown as GameState);

    expect(normalized.matchPhase).toBe("finished");
    expect(normalized.matchOutcome).toEqual({
      winner: "rival",
      reason: "regulation_score",
    });
  });
});

function regulationState() {
  const state = createInitialGameState("scoring-rules");
  state.matchPhase = "regulation";
  state.elapsedMs = GAME_RULES.setupDurationMs;
  state.remainingMs = GAME_RULES.matchDurationMs - state.elapsedMs;
  state.salvage = [];
  state.worldTimeline.nextEventTick = Number.MAX_SAFE_INTEGER;
  return state;
}

function overtimeState() {
  const state = regulationState();
  state.matchPhase = "overtime";
  state.remainingMs = GAME_RULES.overtimeDurationMs;
  state.overtimeElapsedMs = 0;
  return state;
}

function vulnerableBaseState() {
  const state = regulationState();
  const rivalBase = state.players.rival.basePosition;
  state.anchors = [{
    ...anchor("rival-root", "rival", { x: rivalBase.x, y: rivalBase.y + 30 }, false),
    disruptedUntilMs: state.elapsedMs + GAME_RULES.anchorDisruptionDurationMs,
  }];
  state.hasDeployedAnchor.rival = true;
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
    disruptedUntilMs: powered ? null : GAME_RULES.anchorDisruptionDurationMs,
    protectedUntilMs: null,
    overloadProgress: 0,
    repairProgress: 0,
  };
}
