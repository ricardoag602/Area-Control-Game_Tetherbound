import { GAME_RULES, SIMULATION_RULES, WORLD } from "./constants";
import { clampToWorld, distance, distanceToSegment } from "./geometry";
import { advanceMovement, cancelMovement } from "./movement";
import { baseId, createGameWorldTimeline } from "./state";
import { sampleTerritoryGrid } from "./territory";
import type { Anchor, GameInput, GameState, MatchInputs, PlayerId, Vec2 } from "./types";
import { sampleWorld, type BiomeId } from "./world";
import {
  advanceWorldTimelineToElapsedMs,
  elapsedMsToWorldTick,
  type BiomeWeatherEvent,
  type SalvageDropEvent,
  type WorldTimelineEvent,
} from "./worldEvents";

interface NetworkNode {
  id: string;
  position: Vec2;
}

const DISTANCE_TIE_EPSILON = 1e-9;

export function getPoweredNodes(state: GameState, playerId: PlayerId): NetworkNode[] {
  return [
    { id: baseId(playerId), position: state.players[playerId].basePosition },
    ...state.anchors
      .filter((anchor) => anchor.owner === playerId && anchor.powered)
      .map((anchor) => ({ id: anchor.id, position: anchor.position })),
  ];
}

export function isInsideSafeZone(state: GameState, playerId: PlayerId, position: Vec2) {
  return getPoweredNodes(state, playerId).some(
    (node) => distance(node.position, position) <= GAME_RULES.safeZoneRadius,
  );
}

function isAtDeliveryNode(state: GameState, playerId: PlayerId, position: Vec2) {
  return getPoweredNodes(state, playerId).some(
    (node) => distance(node.position, position) <= GAME_RULES.deliveryRadius,
  );
}

export function findConnectionParent(
  state: GameState,
  playerId: PlayerId,
  position: Vec2,
): NetworkNode | null {
  const candidates = getPoweredNodes(state, playerId)
    .map((node) => ({ ...node, distance: distance(node.position, position) }))
    .filter((node) => node.distance <= GAME_RULES.maximumLinkDistance)
    .sort((a, b) => a.distance - b.distance);

  return candidates[0] ?? null;
}

export function canDeployAnchor(state: GameState, playerId: PlayerId) {
  const player = state.players[playerId];
  const ownedAnchors = state.anchors.filter((anchor) => anchor.owner === playerId);
  const position = player.astronaut.position;

  return (
    player.astronaut.tetherKits > 0 &&
    player.astronaut.movement.mode !== "charging" &&
    player.astronaut.movement.mode !== "burst" &&
    ownedAnchors.length < GAME_RULES.maximumAnchorsPerPlayer &&
    findConnectionParent(state, playerId, position) !== null &&
    getPoweredNodes(state, playerId).every(
      (node) => distance(node.position, position) >= GAME_RULES.minimumAnchorSpacing,
    )
  );
}

export function deployAnchor(state: GameState, playerId: PlayerId): GameState {
  if (!canDeployAnchor(state, playerId)) return state;

  const player = state.players[playerId];
  const parent = findConnectionParent(state, playerId, player.astronaut.position);
  if (!parent) return state;

  const anchor: Anchor = {
    id: `${playerId}-anchor-${state.nextAnchorId}`,
    owner: playerId,
    position: { ...player.astronaut.position },
    parentId: parent.id,
    powered: true,
  };

  return {
    ...state,
    nextAnchorId: state.nextAnchorId + 1,
    anchors: [...state.anchors, anchor],
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        astronaut: {
          ...player.astronaut,
          tetherKits: player.astronaut.tetherKits - 1,
        },
      },
    },
  };
}

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

function normalizeWorldSystems(state: GameState): GameState {
  const elapsedMs = Number.isFinite(state.elapsedMs)
    ? state.elapsedMs
    : Math.max(0, GAME_RULES.matchDurationMs - state.remainingMs);
  const simulationRemainderMs = Number.isFinite(state.simulationRemainderMs)
    ? Math.max(0, state.simulationRemainderMs)
    : 0;
  const pendingInputs = state.pendingInputs ?? {};
  if (state.worldTimeline) {
    return {
      ...state,
      elapsedMs,
      simulationRemainderMs,
      pendingInputs,
      activeWeather: Array.isArray(state.activeWeather) ? state.activeWeather : [],
      lastWorldEvent: state.lastWorldEvent ?? null,
    };
  }

  const startTick = Math.floor(
    elapsedMs / 1_000 * SIMULATION_RULES.ticksPerSecond,
  );
  return {
    ...state,
    elapsedMs,
    simulationRemainderMs,
    pendingInputs,
    worldTimeline: createGameWorldTimeline("legacy-match", startTick),
    activeWeather: [],
    lastWorldEvent: null,
  };
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

export function getTerritoryScore(state: GameState, playerId: PlayerId) {
  return sampleTerritoryGrid(state).score[playerId];
}

export interface EnvironmentModifiers {
  biome: BiomeId;
  speedMultiplier: number;
  turnRateMultiplier: number;
  oxygenDrainMultiplier: number;
  oxygenRecoveryMultiplier: number;
  ambientDrift: { strength: number; cycleSeconds: number } | null;
  driftStrengthMultiplier: number;
}

export function getEnvironmentModifiers(
  state: GameState,
  position: Vec2,
): EnvironmentModifiers {
  const sample = sampleWorld(position);
  const biome = sample?.biome ?? "neutral";
  const effects = sample?.effects ?? {
    movement: { speedMultiplier: 1, turnRateMultiplier: 1, ambientDrift: null },
    oxygen: { drainMultiplier: 1, recoveryMultiplier: 1 },
  };
  let speedMultiplier = effects.movement.speedMultiplier;
  let turnRateMultiplier = effects.movement.turnRateMultiplier;
  let oxygenDrainMultiplier = effects.oxygen.drainMultiplier;
  let oxygenRecoveryMultiplier = effects.oxygen.recoveryMultiplier;
  let driftStrengthMultiplier = 1;
  const weather = strongestWeatherForBiome(state.activeWeather ?? [], biome);

  if (weather) {
    const intensity = weather.intensity;
    switch (weather.effect) {
      case "rough_current":
        speedMultiplier *= 1 - intensity * 0.06;
        turnRateMultiplier *= 1 - intensity * 0.04;
        driftStrengthMultiplier += intensity * 0.35;
        break;
      case "bug_swarm":
        speedMultiplier *= 1 - intensity * 0.04;
        oxygenDrainMultiplier *= 1 + intensity * 0.1;
        break;
      case "dust_storm":
        speedMultiplier *= 1 - intensity * 0.05;
        turnRateMultiplier *= 1 - intensity * 0.05;
        oxygenDrainMultiplier *= 1 + intensity * 0.12;
        break;
      case "snow_squall":
        speedMultiplier *= 1 - intensity * 0.06;
        turnRateMultiplier *= 1 - intensity * 0.08;
        oxygenRecoveryMultiplier *= 1 - intensity * 0.05;
        driftStrengthMultiplier += intensity * 0.2;
        break;
    }
  }

  return {
    biome,
    speedMultiplier,
    turnRateMultiplier,
    oxygenDrainMultiplier,
    oxygenRecoveryMultiplier,
    ambientDrift: effects.movement.ambientDrift,
    driftStrengthMultiplier,
  };
}

export function strongestWeatherForBiome(
  activeWeather: readonly BiomeWeatherEvent[],
  biome: BiomeId,
) {
  return activeWeather
    .filter((event) => event.biome === biome)
    .sort((a, b) => b.intensity - a.intensity || a.sequence - b.sequence)[0] ??
    null;
}

function getAmbientDrift(
  state: GameState,
  playerId: PlayerId,
  environment: EnvironmentModifiers,
  deltaSeconds: number,
): Vec2 {
  const drift = environment.ambientDrift;
  if (!drift || deltaSeconds <= 0) return { x: 0, y: 0 };

  // Match-clock-driven waves feel irregular in motion while remaining exactly
  // reproducible on the server, in replays, and after reconnection.
  const playerPhase = playerId === "player" ? 0 : Math.PI;
  const endSeconds = state.elapsedMs / 1_000;
  const startSeconds = Math.max(0, endSeconds - deltaSeconds);
  const angularFrequency = Math.PI * 2 / drift.cycleSeconds;
  const startPhase = angularFrequency * startSeconds + playerPhase;
  const endPhase = angularFrequency * endSeconds + playerPhase;
  const strength = drift.strength * environment.driftStrengthMultiplier;
  const verticalFrequency = angularFrequency * 0.61;
  const verticalPhase = playerPhase * 0.61;
  return {
    x: strength * (Math.cos(startPhase) - Math.cos(endPhase)) /
      angularFrequency,
    y: strength * 0.42 *
      (Math.sin(verticalFrequency * endSeconds + verticalPhase) -
        Math.sin(verticalFrequency * startSeconds + verticalPhase)) /
      verticalFrequency,
  };
}

function advanceWorldSystems(state: GameState): GameState {
  let timeline = state.worldTimeline;
  const generatedEvents: WorldTimelineEvent[] = [];
  const targetTick = elapsedMsToWorldTick(
    state.elapsedMs,
    timeline.rules.ticksPerSecond,
  );
  const maximumOverdueEvents = Math.max(
    1,
    Math.floor(
      (targetTick - timeline.processedThroughTick) /
        timeline.rules.minimumIntervalTicks,
    ) + 1,
  );
  const maximumPasses =
    Math.ceil(
      maximumOverdueEvents / timeline.rules.maximumEventsPerAdvance,
    ) + 1;
  let caughtUp = false;

  // Normal play emits at most one event here. Serialized replays/reconnects
  // may be farther behind, so drain every provably possible overdue event.
  for (let pass = 0; pass < maximumPasses; pass += 1) {
    const advanced = advanceWorldTimelineToElapsedMs(timeline, state.elapsedMs);
    timeline = advanced.state;
    generatedEvents.push(...advanced.events);
    if (advanced.caughtUp) {
      caughtUp = true;
      break;
    }
  }
  if (!caughtUp) {
    throw new RangeError("World timeline could not catch up from its serialized state.");
  }
  const currentTick = targetTick;
  let activeWeather = state.activeWeather.filter(
    (event) => event.scheduledTick + event.durationTicks > currentTick,
  );
  let salvage = state.salvage;
  let lastWorldEvent = state.lastWorldEvent;

  for (const event of generatedEvents) {
    lastWorldEvent = event;
    if (event.kind === "salvage_drop") {
      salvage = [...salvage, ...salvageFromDrop(event)];
    } else if (
      event.kind === "biome_weather" &&
      event.scheduledTick + event.durationTicks > currentTick
    ) {
      activeWeather = [...activeWeather, event];
    }
  }

  return {
    ...state,
    worldTimeline: timeline,
    activeWeather,
    lastWorldEvent,
    salvage,
  };
}

function salvageFromDrop(event: SalvageDropEvent) {
  const deposits = [];
  const baseAngle = (event.eventSeed % 360) * Math.PI / 180;
  for (let index = 0; index < event.amount; index += 1) {
    const radius = index === 0 ? 0 : 3;
    const angle = baseAngle + index * Math.PI;
    deposits.push({
      id: `salvage-${event.id}-${index}`,
      position: clampToWorld(
        {
          x: event.position.x + Math.cos(angle) * radius,
          y: event.position.y + Math.sin(angle) * radius,
        },
        WORLD.width,
        WORLD.height,
      ),
      collected: false,
    });
  }
  return deposits;
}
