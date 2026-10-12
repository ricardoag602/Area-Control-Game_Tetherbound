import { GAME_RULES } from "../constants";
import type {
  GameState,
  MatchOutcome,
  MatchPhase,
  PlayerId,
} from "../types";
import { PLAYER_IDS } from "../types";
import { sampleTerritoryGrid } from "../world/territory";

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
  const totals = createNumberRecord(0);
  const activePlayerIds = getActivePlayerIds(state);
  let totalCells = 0;
  const excludedRadiusSquared = GAME_RULES.safeZoneRadius ** 2;

  for (const cell of grid.cells) {
    if (
      activePlayerIds.some((playerId) => {
        const base = state.players[playerId].basePosition;
        const x = cell.position.x - base.x;
        const y = cell.position.y - base.y;
        return x * x + y * y <= excludedRadiusSquared;
      })
    ) {
      continue;
    }

    totalCells += 1;
    if (activePlayerIds.includes(cell.owner as PlayerId)) {
      totals[cell.owner as PlayerId] += 1;
    }
  }

  const denominator = Math.max(1, totalCells);
  return {
    totalCells,
    totals,
    fractions: mapPlayerRecord((playerId) => totals[playerId] / denominator),
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
  const activePlayerIds = getActivePlayerIds(state);
  const hasCurrentScores = hasCompleteScoreRecord(state.scores, activePlayerIds);
  const elapsedMs = finiteNonNegative(
    state.elapsedMs,
    Math.max(0, GAME_RULES.matchDurationMs - finiteNonNegative(state.remainingMs, 0)),
  );
  let remainingMs = finiteNonNegative(state.remainingMs, 0);
  const scores = normalizeScores(state.scores);
  let overtimeScores = normalizeScores(state.overtimeScores);
  let overtimeElapsedMs = finiteNonNegative(state.overtimeElapsedMs, 0);
  const hasDeployedAnchor = mapPlayerRecord((playerId) =>
    state.hasDeployedAnchor?.[playerId] === true ||
    state.anchors.some((anchor) => anchor.owner === playerId));
  const baseCollapseProgressMs = mapPlayerRecord((playerId) => clamp(
    finiteNonNegative(state.baseCollapseProgressMs?.[playerId], 0),
    0,
    GAME_RULES.baseCollapseHoldMs,
  ));
  const baseCollapseAttacker = mapPlayerRecord<PlayerId | null>((playerId) => {
    const attacker = state.baseCollapseAttacker?.[playerId];
    return attacker && activePlayerIds.includes(attacker) && attacker !== playerId
      ? attacker
      : null;
  });
  let matchOutcome = normalizeOutcome(state.matchOutcome);
  let matchPhase = normalizePhase(state.matchPhase, elapsedMs, remainingMs);
  const phaseBeforeFinish = matchPhase;

  if (matchOutcome) {
    matchPhase = "finished";
  } else if (matchPhase === "finished") {
    const finishedAfterOvertime = overtimeElapsedMs > 0 ||
      activePlayerIds.some((playerId) => overtimeScores[playerId] > 0);
    matchPhase = "finished";
    matchOutcome = {
      winner: finishedAfterOvertime || !hasCurrentScores
        ? currentTerritoryWinner(state)
        : scoreWinner(scores, activePlayerIds),
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
    if (scoresAreWithinOvertimeMargin(scores, activePlayerIds)) {
      matchPhase = "overtime";
      remainingMs = GAME_RULES.overtimeDurationMs;
      overtimeElapsedMs = 0;
      overtimeScores = createNumberRecord(0);
    } else {
      matchPhase = "finished";
      matchOutcome = {
        winner: scoreWinner(scores, activePlayerIds),
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
    activePlayerIds,
    elapsedMs,
    remainingMs,
    matchPhase,
    scores,
    overtimeScores,
    overtimeElapsedMs,
    hasDeployedAnchor,
    baseCollapseProgressMs,
    baseCollapseAttacker,
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

    if (scoresAreWithinOvertimeMargin(
      nextState.scores,
      getActivePlayerIds(nextState),
    )) {
      return {
        ...nextState,
        matchPhase: "overtime",
        remainingMs: GAME_RULES.overtimeDurationMs,
        overtimeElapsedMs: 0,
        overtimeScores: createNumberRecord(0),
      };
    }

    return finishMatch(
      nextState,
      scoreWinner(nextState.scores, getActivePlayerIds(nextState)),
      "regulation_score",
    );
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

    const overtimeLeader = leadingPlayer(
      nextState.overtimeScores,
      getActivePlayerIds(nextState),
    );
    if (
      overtimeLeader &&
      overtimeLeader.lead >= GAME_RULES.overtimeLeadPoints
    ) {
      return finishMatch(
        nextState,
        overtimeLeader.playerId,
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
  const activePlayerIds = getActivePlayerIds(state);
  const gains = mapPlayerRecord((playerId) =>
    activePlayerIds.includes(playerId)
      ? territory.fractions[playerId] * weightedSeconds
      : 0);
  return {
    ...state,
    scores: mapPlayerRecord((playerId) => state.scores[playerId] + gains[playerId]),
    overtimeScores: durations.includeInOvertime
      ? mapPlayerRecord((playerId) =>
          state.overtimeScores[playerId] + gains[playerId])
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
  const activePlayerIds = getActivePlayerIds(state);
  const hasDeployedAnchor = mapPlayerRecord((playerId) =>
    state.hasDeployedAnchor[playerId] ||
    state.anchors.some((anchor) => anchor.owner === playerId));
  const progress = { ...state.baseCollapseProgressMs };
  const attackers = { ...state.baseCollapseAttacker };

  // Setup is protected expansion time. Remember deployments made during it,
  // but do not allow an early knockout or carry capture progress into scoring.
  if (state.matchPhase === "setup") {
    return {
      ...state,
      hasDeployedAnchor,
      baseCollapseProgressMs: createNumberRecord(0),
      baseCollapseAttacker: mapPlayerRecord(() => null),
    };
  }

  for (const defenderId of activePlayerIds) {
    const hasPoweredAnchor = state.anchors.some(
      (anchor) => anchor.owner === defenderId && anchor.powered,
    );
    if (!hasDeployedAnchor[defenderId] || hasPoweredAnchor) {
      progress[defenderId] = 0;
      attackers[defenderId] = null;
      continue;
    }

    const base = state.players[defenderId].basePosition;
    const attackersInside = activePlayerIds.filter((playerId) =>
      playerId !== defenderId &&
      distanceSquared(state.players[playerId].astronaut.position, base) <=
        GAME_RULES.baseCollapseRadius ** 2);
    const defenderInside = distanceSquared(
      state.players[defenderId].astronaut.position,
      base,
    ) <= GAME_RULES.baseCollapseRadius ** 2;

    if (attackersInside.length === 1 && !defenderInside) {
      const attackerId = attackersInside[0];
      if (attackers[defenderId] !== attackerId) {
        progress[defenderId] = 0;
        attackers[defenderId] = attackerId;
      }
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
      if (progress[defenderId] <= 0) attackers[defenderId] = null;
    }
  }

  let nextState: GameState = {
    ...state,
    hasDeployedAnchor,
    baseCollapseProgressMs: progress,
    baseCollapseAttacker: attackers,
  };
  const collapsed = activePlayerIds.filter(
    (defenderId) => progress[defenderId] >= GAME_RULES.baseCollapseHoldMs,
  );
  const collapseWinners = new Set(
    collapsed
      .map((defenderId) => attackers[defenderId])
      .filter((playerId): playerId is PlayerId => playerId !== null),
  );
  if (collapsed.length > 0 && collapseWinners.size === 1) {
    nextState = finishMatch(
      nextState,
      [...collapseWinners][0],
      "base_collapse",
    );
  } else if (collapsed.length > 0) {
    nextState = finishMatch(nextState, "draw", "base_collapse");
  }
  return nextState;
}

function scoresAreWithinOvertimeMargin(
  scores: Record<PlayerId, number>,
  activePlayerIds: readonly PlayerId[],
) {
  const ordered = activePlayerIds.map((playerId) => scores[playerId]).sort((a, b) => b - a);
  const leadingScore = ordered[0] ?? 0;
  if (leadingScore === 0) return true;
  return leadingScore - (ordered[1] ?? 0) <=
    leadingScore * GAME_RULES.overtimeScoreMarginRatio;
}

function currentTerritoryWinner(state: GameState) {
  const territory = sampleScorableTerritory(state).totals;
  return scoreWinner(territory, getActivePlayerIds(state));
}

function scoreWinner(
  scores: Record<PlayerId, number>,
  activePlayerIds: readonly PlayerId[],
): PlayerId | "draw" {
  const best = Math.max(...activePlayerIds.map((playerId) => scores[playerId]));
  const winners = activePlayerIds.filter(
    (playerId) => Math.abs(scores[playerId] - best) <= 1e-9,
  );
  return winners.length === 1 ? winners[0] : "draw";
}

function leadingPlayer(
  scores: Record<PlayerId, number>,
  activePlayerIds: readonly PlayerId[],
) {
  const ordered = activePlayerIds
    .map((playerId) => ({ playerId, score: scores[playerId] }))
    .sort((a, b) => b.score - a.score);
  if (!ordered[0] || !ordered[1] || Math.abs(ordered[0].score - ordered[1].score) <= 1e-9) {
    return null;
  }
  return {
    playerId: ordered[0].playerId,
    lead: ordered[0].score - ordered[1].score,
  };
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
  return mapPlayerRecord((playerId) => finiteNonNegative(scores?.[playerId], 0));
}

function hasCompleteScoreRecord(
  scores: Partial<Record<PlayerId, number>> | undefined,
  activePlayerIds: readonly PlayerId[],
) {
  return activePlayerIds.every((playerId) => Number.isFinite(scores?.[playerId]));
}

function normalizeOutcome(outcome: MatchOutcome | null | undefined) {
  if (!outcome) return null;
  const validWinner =
    PLAYER_IDS.includes(outcome.winner as PlayerId) ||
    outcome.winner === "draw";
  const validReason =
    outcome.reason === "regulation_score" ||
    outcome.reason === "overtime_lead" ||
    outcome.reason === "overtime_territory" ||
    outcome.reason === "base_collapse";
  return validWinner && validReason ? outcome : null;
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

function getActivePlayerIds(state: GameState): PlayerId[] {
  const requested = Array.isArray(state.activePlayerIds)
    ? state.activePlayerIds.filter((playerId, index, all): playerId is PlayerId =>
        PLAYER_IDS.includes(playerId as PlayerId) && all.indexOf(playerId) === index)
    : [];
  return requested.length >= 2 ? requested.slice(0, 4) : ["player", "rival"];
}

function createNumberRecord(value: number): Record<PlayerId, number> {
  return mapPlayerRecord(() => value);
}

function mapPlayerRecord<T>(
  mapValue: (playerId: PlayerId) => T,
): Record<PlayerId, T> {
  return Object.fromEntries(
    PLAYER_IDS.map((playerId) => [playerId, mapValue(playerId)]),
  ) as Record<PlayerId, T>;
}
