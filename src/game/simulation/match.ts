import { GAME_RULES, SIMULATION_RULES, WORLD } from "../constants";
import { clampToWorld, distanceToSegment } from "../geometry";
import { advanceMovement, cancelMovement } from "../movement/movement";
import type { GameInput, GameState, MatchInputs, PlayerId, Vec2 } from "../types";
import {
  getAmbientDrift,
  getEnvironmentModifiers,
} from "./environment";
import { isAtDeliveryNode, isInsideSafeZone } from "./tetherNetwork";
import { advanceWorldSystems, normalizeWorldSystems } from "./worldSystems";

const DISTANCE_TIE_EPSILON = 1e-9;

export function advanceGame(
  state: GameState,
  input: GameInput,
  deltaSeconds: number,
): GameState {
  if (state.remainingMs <= 0) return state;

  return advanceMatch(state, { player: [input] }, deltaSeconds);
}

export function advanceMatch(
  state: GameState,
  inputs: MatchInputs,
  deltaSeconds: number,
): GameState {
  state = normalizeWorldSystems(state);
  if (state.remainingMs <= 0) return state;

  const fixedStepSeconds = 1 / SIMULATION_RULES.ticksPerSecond;
  const fixedStepMs = fixedStepSeconds * 1_000;
  const safeDeltaMs = Number.isFinite(deltaSeconds)
    ? Math.max(0, deltaSeconds * 1_000)
    : 0;
  if (safeDeltaMs === 0) {
    const pendingInputs = mergeMatchInputs(state.pendingInputs, inputs);
    return advanceMatchStep(
      { ...state, pendingInputs: {} },
      pendingInputs,
      0,
    );
  }
  const accumulatedMs = state.simulationRemainderMs + safeDeltaMs;
  const fullStepCount = Math.floor((accumulatedMs + 0.000001) / fixedStepMs);
  let nextState: GameState = {
    ...state,
    pendingInputs: mergeMatchInputs(state.pendingInputs, inputs),
    simulationRemainderMs: Math.max(
      0,
      accumulatedMs - fullStepCount * fixedStepMs,
    ),
  };

  // Input and partial time are serialized until a complete authoritative tick
  // exists. Replays, local play, and online rooms therefore resolve identical
  // movement even when callers deliver time in different-sized chunks.
  for (
    let step = 0;
    step < fullStepCount && nextState.remainingMs > 0;
    step += 1
  ) {
    const stepInputs = step === 0 ? nextState.pendingInputs : {};
    nextState = advanceMatchStep(
      { ...nextState, pendingInputs: {} },
      stepInputs,
      fixedStepSeconds,
    );
  }

  if (nextState.remainingMs <= 0) {
    return { ...nextState, pendingInputs: {}, simulationRemainderMs: 0 };
  }
  return nextState;
}

function mergeMatchInputs(
  pending: MatchInputs | undefined,
  incoming: MatchInputs,
): MatchInputs {
  const merged: MatchInputs = {};
  for (const playerId of ["player", "rival"] as const) {
    const commands = [
      ...(pending?.[playerId] ?? []),
      ...(incoming[playerId] ?? []),
    ];
    if (commands.length > 0) merged[playerId] = commands;
  }
  return merged;
}

function advanceMatchStep(
  state: GameState,
  inputs: MatchInputs,
  deltaSeconds: number,
): GameState {
  let nextState: GameState = {
    ...state,
    elapsedMs: state.elapsedMs + deltaSeconds * 1000,
    remainingMs: Math.max(0, state.remainingMs - deltaSeconds * 1000),
  };
  const activePlayers: PlayerId[] = [];
  const movementPaths = {} as Record<PlayerId, { start: Vec2; end: Vec2 }>;

  for (const playerId of ["player", "rival"] as const) {
    const result = advancePlayer(nextState, playerId, inputs[playerId] ?? [], deltaSeconds);
    nextState = result.state;
    movementPaths[playerId] = result.path;
    if (!result.respawned) activePlayers.push(playerId);
  }

  nextState = collectSalvage(nextState, activePlayers, movementPaths);
  nextState = deliverSalvage(nextState, activePlayers);
  return advanceWorldSystems(nextState);
}

function advancePlayer(
  state: GameState,
  playerId: PlayerId,
  inputs: GameInput[],
  deltaSeconds: number,
): { state: GameState; respawned: boolean; path: { start: Vec2; end: Vec2 } } {
  const player = state.players[playerId];
  const currentAstronaut = player.astronaut;
  const movementEnvironment = getEnvironmentModifiers(
    state,
    currentAstronaut.position,
  );

  const movementStep = advanceMovement(
    currentAstronaut.position,
    currentAstronaut.movement,
    inputs,
    deltaSeconds,
    WORLD.width,
    WORLD.height,
    {
      speedMultiplier: movementEnvironment.speedMultiplier,
      turnRateMultiplier: movementEnvironment.turnRateMultiplier,
    },
  );
  const drift = getAmbientDrift(
    state,
    playerId,
    movementEnvironment,
    deltaSeconds,
  );
  const nextPosition = clampToWorld(
    {
      x: movementStep.position.x + drift.x,
      y: movementStep.position.y + drift.y,
    },
    WORLD.width,
    WORLD.height,
  );

  const safe = isInsideSafeZone(state, playerId, nextPosition);
  const oxygenEnvironment = getEnvironmentModifiers(state, nextPosition);
  const oxygen = safe
    ? Math.min(
        GAME_RULES.oxygenMaximum,
        currentAstronaut.oxygen + GAME_RULES.oxygenRecoveryPerSecond *
          oxygenEnvironment.oxygenRecoveryMultiplier * deltaSeconds,
      )
    : Math.max(
        0,
        currentAstronaut.oxygen - GAME_RULES.oxygenDrainPerSecond *
          oxygenEnvironment.oxygenDrainMultiplier * deltaSeconds,
      );

  if (!safe && oxygen === 0) {
    // Running out of oxygen costs carried salvage and returns the player to base.
    return {
      respawned: true,
      path: { start: currentAstronaut.position, end: player.basePosition },
      state: {
        ...state,
        players: {
          ...state.players,
          [playerId]: {
            ...player,
            astronaut: {
              ...currentAstronaut,
              position: { ...player.basePosition },
              movement: cancelMovement(movementStep.movement),
              oxygen: GAME_RULES.oxygenMaximum,
              carriedSalvage: 0,
              respawns: currentAstronaut.respawns + 1,
            },
          },
        },
      },
    };
  }

  return {
    respawned: false,
    path: { start: currentAstronaut.position, end: nextPosition },
    state: {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          astronaut: {
            ...currentAstronaut,
            position: nextPosition,
            movement: movementStep.movement,
            oxygen,
          },
        },
      },
    },
  };
}

function collectSalvage(
  state: GameState,
  activePlayers: PlayerId[],
  movementPaths: Record<PlayerId, { start: Vec2; end: Vec2 }>,
): GameState {
  let players = state.players;
  // Exact ties rotate using the number of deposits already claimed. This keeps
  // either player slot from permanently owning the simultaneous-pickup advantage.
  let tieBreakTurn = state.salvage.filter((deposit) => deposit.collected).length;

  const salvage = state.salvage.map((deposit) => {
    if (deposit.collected) return deposit;

    const contenders = activePlayers
      .filter(
        (playerId) =>
          players[playerId].astronaut.carriedSalvage < GAME_RULES.salvageCarryLimit,
      )
      .map((playerId) => ({
        playerId,
        distance: distanceToSegment(
          deposit.position,
          movementPaths[playerId].start,
          movementPaths[playerId].end,
        ),
      }))
      .filter((contender) => contender.distance <= GAME_RULES.collectionRadius)
      .sort((a, b) => a.distance - b.distance);

    if (contenders.length === 0) return deposit;

    let winner = contenders[0].playerId;
    if (
      contenders.length === 2 &&
      Math.abs(contenders[0].distance - contenders[1].distance) <= DISTANCE_TIE_EPSILON
    ) {
      winner = tieBreakTurn % 2 === 0 ? "player" : "rival";
      tieBreakTurn += 1;
    }

    const player = players[winner];
    players = {
      ...players,
      [winner]: {
        ...player,
        astronaut: {
          ...player.astronaut,
          carriedSalvage: player.astronaut.carriedSalvage + 1,
        },
      },
    };

    return { ...deposit, collected: true };
  });

  return { ...state, players, salvage };
}

function deliverSalvage(state: GameState, activePlayers: PlayerId[]): GameState {
  let players = state.players;

  for (const playerId of activePlayers) {
    const player = players[playerId];
    const astronaut = player.astronaut;
    if (
      astronaut.carriedSalvage === 0 ||
      !isAtDeliveryNode(state, playerId, astronaut.position)
    ) {
      continue;
    }

    const salvageTotal = astronaut.bankedSalvage + astronaut.carriedSalvage;
    players = {
      ...players,
      [playerId]: {
        ...player,
        astronaut: {
          ...astronaut,
          carriedSalvage: 0,
          bankedSalvage: salvageTotal % GAME_RULES.salvagePerTether,
          tetherKits:
            astronaut.tetherKits + Math.floor(salvageTotal / GAME_RULES.salvagePerTether),
        },
      },
    };
  }

  return { ...state, players };
}
