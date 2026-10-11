import { GAME_RULES } from "../constants";
import type {
  GameState,
  MatchOutcome,
  MatchPhase,
  PlayerId,
} from "../types";
import { sampleTerritoryGrid } from "../world/territory";

const PLAYER_IDS: readonly PlayerId[] = ["player", "rival"];

export interface ScorableTerritory {
  /** Grid cells outside both guaranteed home zones. */
  totalCells: number;
  /** Exclusively controlled cells; neutral and contested cells award neither side. */
  totals: Record<PlayerId, number>;
  /** Controlled share of the complete scorable grid, from zero to one. */
  fractions: Record<PlayerId, number>;
}

/**
 * Returns the live territory used by match scoring and the overtime tiebreak.
 * Home-zone cells never score, even when an anchor from either team overlaps
 * them. Contested and neutral cells remain in the denominator but not either
 * player's numerator.
 */
export function sampleScorableTerritory(state: GameState): ScorableTerritory {
  const grid = sampleTerritoryGrid(state);
  const totals: Record<PlayerId, number> = { player: 0, rival: 0 };
  let totalCells = 0;
  const excludedRadiusSquared = GAME_RULES.safeZoneRadius ** 2;

  for (const cell of grid.cells) {
    if (
      PLAYER_IDS.some((playerId) => {
        const base = state.players[playerId].basePosition;
        const x = cell.position.x - base.x;
        const y = cell.position.y - base.y;
        return x * x + y * y <= excludedRadiusSquared;
      })
    ) {
      continue;
    }

    totalCells += 1;
    if (cell.owner === "player" || cell.owner === "rival") {
      totals[cell.owner] += 1;
    }
  }

  const denominator = Math.max(1, totalCells);
  return {
    totalCells,
    totals,
    fractions: {
      player: totals.player / denominator,
      rival: totals.rival / denominator,
    },
  };
}

/** Legacy live-map percentage retained for minimap and older consumers. */
export function getTerritoryScore(state: GameState, playerId: PlayerId) {
  return sampleTerritoryGrid(state).score[playerId];
}

export function getScorableTerritoryFraction(
  state: GameState,
  playerId: PlayerId,
) {
  return sampleScorableTerritory(state).fractions[playerId];
}

export function getScorableTerritoryPercent(
  state: GameState,
  playerId: PlayerId,
) {
  return getScorableTerritoryFraction(state, playerId) * 100;
}

/**
 * Fills match-rule fields missing from states serialized before score-based
 * outcomes were introduced. Active legacy games resume with zero cumulative
 * score; only expired states that truly lack cumulative scores fall back to
 * current scorable territory.
 */
export function normalizeMatchState(state: GameState): GameState {
  const hasCurrentScores = hasCompleteScoreRecord(state.scores);
  const elapsedMs = finiteNonNegative(
    state.elapsedMs,
    Math.max(0, GAME_RULES.matchDurationMs - finiteNonNegative(state.remainingMs, 0)),
  );
  let remainingMs = finiteNonNegative(state.remainingMs, 0);
  const scores = normalizeScores(state.scores);
  let overtimeScores = normalizeScores(state.overtimeScores);
  let overtimeElapsedMs = finiteNonNegative(state.overtimeElapsedMs, 0);
  const hasDeployedAnchor: Record<PlayerId, boolean> = {
    player:
      state.hasDeployedAnchor?.player === true ||
      state.anchors.some((anchor) => anchor.owner === "player"),
    rival:
      state.hasDeployedAnchor?.rival === true ||
      state.anchors.some((anchor) => anchor.owner === "rival"),
  };
  const baseCollapseProgressMs: Record<PlayerId, number> = {
    player: clamp(
      finiteNonNegative(state.baseCollapseProgressMs?.player, 0),
      0,
      GAME_RULES.baseCollapseHoldMs,
    ),
    rival: clamp(
      finiteNonNegative(state.baseCollapseProgressMs?.rival, 0),
      0,
      GAME_RULES.baseCollapseHoldMs,
    ),
  };
  let matchOutcome = normalizeOutcome(state.matchOutcome);
  let matchPhase = normalizePhase(state.matchPhase, elapsedMs, remainingMs);
  const phaseBeforeFinish = matchPhase;

  if (matchOutcome) {
    matchPhase = "finished";
  } else if (matchPhase === "finished") {
    const finishedAfterOvertime = overtimeElapsedMs > 0 ||
      overtimeScores.player > 0 || overtimeScores.rival > 0;
    matchPhase = "finished";
    matchOutcome = {
      winner: finishedAfterOvertime || !hasCurrentScores
        ? currentTerritoryWinner(state)
        : scoreWinner(scores),
      reason: finishedAfterOvertime
        ? "overtime_territory"
        : "regulation_score",
    };
  } else if (remainingMs <= 0 && phaseBeforeFinish === "overtime") {
    matchPhase = "finished";
    matchOutcome = {
      winner: currentTerritoryWinner(state),
      reason: "overtime_territory",
    };
  } else if (remainingMs <= 0 && hasCurrentScores) {
    if (scoresAreWithinOvertimeMargin(scores)) {
      matchPhase = "overtime";
      remainingMs = GAME_RULES.overtimeDurationMs;
      overtimeElapsedMs = 0;
      overtimeScores = { player: 0, rival: 0 };
    } else {
      matchPhase = "finished";
      matchOutcome = {
        winner: scoreWinner(scores),
        reason: "regulation_score",
      };
    }
  } else if (remainingMs <= 0) {
    matchPhase = "finished";
    matchOutcome = {
      winner: currentTerritoryWinner(state),
      reason: "regulation_score",
    };
  } else if (
    matchPhase === "setup" &&
    elapsedMs >= GAME_RULES.setupDurationMs
  ) {
    matchPhase = "regulation";
  }

  return {
    ...state,
    elapsedMs,
    remainingMs,
    matchPhase,
    scores,
    overtimeScores,
    overtimeElapsedMs,
    hasDeployedAnchor,
    baseCollapseProgressMs,
    matchOutcome,
  };
}

/**
 * Advances scoring, match phases, overtime, and the base-collapse objective.
 * Movement/conflict must be resolved first so the same tick's final network
 * and astronaut positions determine score and capture progress.
 */
export function advanceMatchRules(
  state: GameState,
  previousRemainingMs: number,
  deltaSeconds: number,
): GameState {
  const safeDeltaSeconds = Number.isFinite(deltaSeconds)
    ? Math.max(0, deltaSeconds)
    : 0;
  const phase = state.matchPhase;
  let nextState = advanceBaseCollapse(state, safeDeltaSeconds);
  if (nextState.matchOutcome) return nextState;

  if (phase === "setup") {
    if (nextState.elapsedMs >= GAME_RULES.setupDurationMs) {
      nextState = { ...nextState, matchPhase: "regulation" };
    }
    return nextState;
  }

  if (phase === "regulation") {
    nextState = awardTerritoryScore(
      nextState,
      regulationScoreSeconds(previousRemainingMs, nextState.remainingMs),
    );
    if (nextState.remainingMs > 0) return nextState;

    if (scoresAreWithinOvertimeMargin(nextState.scores)) {
      return {
        ...nextState,
        matchPhase: "overtime",
        remainingMs: GAME_RULES.overtimeDurationMs,
        overtimeElapsedMs: 0,
        overtimeScores: { player: 0, rival: 0 },
      };
    }

    return finishMatch(nextState, scoreWinner(nextState.scores), "regulation_score");
  }

  if (phase === "overtime") {
    const activeSeconds = Math.min(
      safeDeltaSeconds,
      finiteNonNegative(previousRemainingMs, 0) / 1_000,
    );
    nextState = awardTerritoryScore(nextState, {
      normal: activeSeconds,
      surge: 0,
      includeInOvertime: true,
    });
    nextState = {
      ...nextState,
      overtimeElapsedMs: Math.min(
        GAME_RULES.overtimeDurationMs,
        nextState.overtimeElapsedMs + activeSeconds * 1_000,
      ),
    };

    const overtimeDifference =
      nextState.overtimeScores.player - nextState.overtimeScores.rival;
    if (Math.abs(overtimeDifference) >= GAME_RULES.overtimeLeadPoints) {
      return finishMatch(
        nextState,
        overtimeDifference > 0 ? "player" : "rival",
        "overtime_lead",
      );
    }
    if (nextState.remainingMs <= 0) {
      return finishMatch(
        nextState,
        currentTerritoryWinner(nextState),
        "overtime_territory",
      );
    }
  }

  return nextState;
}

function awardTerritoryScore(
  state: GameState,
  durations: {
    normal: number;
    surge: number;
    includeInOvertime?: boolean;
  },
) {
  const weightedSeconds =
    durations.normal + durations.surge * GAME_RULES.scoreSurgeMultiplier;
  if (weightedSeconds <= 0) return state;

  const territory = sampleScorableTerritory(state);
  const gains: Record<PlayerId, number> = {
    player: territory.fractions.player * weightedSeconds,
    rival: territory.fractions.rival * weightedSeconds,
  };
  return {
    ...state,
    scores: {
      player: state.scores.player + gains.player,
      rival: state.scores.rival + gains.rival,
    },
    overtimeScores: durations.includeInOvertime
      ? {
          player: state.overtimeScores.player + gains.player,
          rival: state.overtimeScores.rival + gains.rival,
        }
      : state.overtimeScores,
  };
}

function regulationScoreSeconds(
  previousRemainingMs: number,
  remainingMs: number,
) {
  const previous = finiteNonNegative(previousRemainingMs, 0);
  const current = finiteNonNegative(remainingMs, 0);
  const activeMs = Math.max(0, previous - current);
  const surgeMs = Math.max(
    0,
    Math.min(previous, GAME_RULES.scoreSurgeDurationMs) - current,
  );
  return {
    normal: Math.max(0, activeMs - surgeMs) / 1_000,
    surge: Math.min(activeMs, surgeMs) / 1_000,
  };
}

function advanceBaseCollapse(state: GameState, deltaSeconds: number): GameState {
  const hasDeployedAnchor: Record<PlayerId, boolean> = {
    player:
      state.hasDeployedAnchor.player ||
      state.anchors.some((anchor) => anchor.owner === "player"),
    rival:
      state.hasDeployedAnchor.rival ||
      state.anchors.some((anchor) => anchor.owner === "rival"),
  };
  const progress = { ...state.baseCollapseProgressMs };

  // Setup is protected expansion time. Remember deployments made during it,
  // but do not allow an early knockout or carry capture progress into scoring.
  if (state.matchPhase === "setup") {
    return {
      ...state,
      hasDeployedAnchor,
      baseCollapseProgressMs: { player: 0, rival: 0 },
    };
  }

  for (const defenderId of PLAYER_IDS) {
    const attackerId = opponentOf(defenderId);
    const hasPoweredAnchor = state.anchors.some(
      (anchor) => anchor.owner === defenderId && anchor.powered,
    );
    if (!hasDeployedAnchor[defenderId] || hasPoweredAnchor) {
      progress[defenderId] = 0;
      continue;
    }

    const base = state.players[defenderId].basePosition;
    const attackerInside = distanceSquared(
      state.players[attackerId].astronaut.position,
      base,
    ) <= GAME_RULES.baseCollapseRadius ** 2;
    const defenderInside = distanceSquared(
      state.players[defenderId].astronaut.position,
      base,
    ) <= GAME_RULES.baseCollapseRadius ** 2;

    if (attackerInside && !defenderInside) {
      progress[defenderId] = Math.min(
        GAME_RULES.baseCollapseHoldMs,
        progress[defenderId] + deltaSeconds * 1_000,
      );
    } else {
      const recoveryRate = defenderInside
        ? GAME_RULES.baseCollapseDefenseRecoveryPerSecond
        : GAME_RULES.baseCollapseDecayPerSecond;
      progress[defenderId] = Math.max(
        0,
        progress[defenderId] - deltaSeconds * 1_000 * recoveryRate,
      );
    }
  }

  let nextState: GameState = {
    ...state,
    hasDeployedAnchor,
    baseCollapseProgressMs: progress,
  };
  const collapsed = PLAYER_IDS.filter(
    (defenderId) => progress[defenderId] >= GAME_RULES.baseCollapseHoldMs,
  );
  if (collapsed.length === 1) {
    nextState = finishMatch(
      nextState,
      opponentOf(collapsed[0]),
      "base_collapse",
    );
  } else if (collapsed.length > 1) {
    nextState = finishMatch(nextState, "draw", "base_collapse");
  }
  return nextState;
}

function scoresAreWithinOvertimeMargin(scores: Record<PlayerId, number>) {
  const leadingScore = Math.max(scores.player, scores.rival);
  if (leadingScore === 0) return true;
  return Math.abs(scores.player - scores.rival) <=
    leadingScore * GAME_RULES.overtimeScoreMarginRatio;
}

function currentTerritoryWinner(state: GameState) {
  const territory = sampleScorableTerritory(state).totals;
  return scoreWinner(territory);
}

function scoreWinner(scores: Record<PlayerId, number>): PlayerId | "draw" {
  if (Math.abs(scores.player - scores.rival) <= 1e-9) return "draw";
  return scores.player > scores.rival ? "player" : "rival";
}

function finishMatch(
  state: GameState,
  winner: PlayerId | "draw",
  reason: MatchOutcome["reason"],
): GameState {
  return {
    ...state,
    matchPhase: "finished",
    matchOutcome: { winner, reason },
    pendingInputs: {},
    simulationRemainderMs: 0,
  };
}

function normalizePhase(
  phase: MatchPhase | undefined,
  elapsedMs: number,
  remainingMs: number,
): MatchPhase {
  if (
    phase === "setup" ||
    phase === "regulation" ||
    phase === "overtime" ||
    phase === "finished"
  ) {
    return phase;
  }
  if (remainingMs <= 0) return "finished";
  return elapsedMs < GAME_RULES.setupDurationMs ? "setup" : "regulation";
}

function normalizeScores(
  scores: Partial<Record<PlayerId, number>> | undefined,
): Record<PlayerId, number> {
  return {
    player: finiteNonNegative(scores?.player, 0),
    rival: finiteNonNegative(scores?.rival, 0),
  };
}

function hasCompleteScoreRecord(
  scores: Partial<Record<PlayerId, number>> | undefined,
) {
  return Number.isFinite(scores?.player) && Number.isFinite(scores?.rival);
}

function normalizeOutcome(outcome: MatchOutcome | null | undefined) {
  if (!outcome) return null;
  const validWinner =
    outcome.winner === "player" ||
    outcome.winner === "rival" ||
    outcome.winner === "draw";
  const validReason =
    outcome.reason === "regulation_score" ||
    outcome.reason === "overtime_lead" ||
    outcome.reason === "overtime_territory" ||
    outcome.reason === "base_collapse";
  return validWinner && validReason ? outcome : null;
}

function opponentOf(playerId: PlayerId): PlayerId {
  return playerId === "player" ? "rival" : "player";
}

function distanceSquared(
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  const x = a.x - b.x;
  const y = a.y - b.y;
  return x * x + y * y;
}

function finiteNonNegative(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? Math.max(0, value as number) : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
