import { GAME_RULES, WORLD } from "./constants";
import { clampToWorld, distance, moveToward } from "./geometry";
import { baseId } from "./state";
import type { Anchor, GameInput, GameState, PlayerId, Vec2 } from "./types";

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

  return advanceMatch(state, { player: input }, deltaSeconds);
}

export function advanceMatch(
  state: GameState,
  inputs: Partial<Record<PlayerId, GameInput>>,
  deltaSeconds: number,
): GameState {
  if (state.remainingMs <= 0) return state;

  let nextState: GameState = {
    ...state,
    remainingMs: Math.max(0, state.remainingMs - deltaSeconds * 1000),
  };
  const activePlayers: PlayerId[] = [];

  for (const playerId of ["player", "rival"] as const) {
    const input = inputs[playerId];
    if (!input) continue;

    const result = advancePlayer(nextState, playerId, input, deltaSeconds);
    nextState = result.state;
    if (!result.respawned) activePlayers.push(playerId);
  }

  nextState = collectSalvage(nextState, activePlayers);
  return deliverSalvage(nextState, activePlayers);
}

function advancePlayer(
  state: GameState,
  playerId: PlayerId,
  input: GameInput,
  deltaSeconds: number,
): { state: GameState; respawned: boolean } {
  const player = state.players[playerId];
  const currentAstronaut = player.astronaut;

  const nextPosition = input.moveTarget
    ? clampToWorld(
        moveToward(
          currentAstronaut.position,
          input.moveTarget,
          GAME_RULES.movementSpeed * deltaSeconds,
        ),
        WORLD.width,
        WORLD.height,
      )
    : currentAstronaut.position;

  const safe = isInsideSafeZone(state, playerId, nextPosition);
  const oxygen = safe
    ? Math.min(
        GAME_RULES.oxygenMaximum,
        currentAstronaut.oxygen + GAME_RULES.oxygenRecoveryPerSecond * deltaSeconds,
      )
    : Math.max(
        0,
        currentAstronaut.oxygen - GAME_RULES.oxygenDrainPerSecond * deltaSeconds,
      );

  if (!safe && oxygen === 0) {
    // Running out of oxygen costs carried salvage and returns the player to base.
    return {
      respawned: true,
      state: {
        ...state,
        players: {
          ...state.players,
          [playerId]: {
            ...player,
            astronaut: {
              ...currentAstronaut,
              position: { ...player.basePosition },
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
    state: {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          astronaut: {
            ...currentAstronaut,
            position: nextPosition,
            oxygen,
          },
        },
      },
    },
  };
}

function collectSalvage(state: GameState, activePlayers: PlayerId[]): GameState {
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
        distance: distance(players[playerId].astronaut.position, deposit.position),
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
  const poweredAnchors = state.anchors.filter(
    (anchor) => anchor.owner === playerId && anchor.powered,
  ).length;
  return Math.min(100, 6 + poweredAnchors * 6);
}
