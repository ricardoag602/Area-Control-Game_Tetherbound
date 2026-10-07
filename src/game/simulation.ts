import { GAME_RULES, WORLD } from "./constants";
import { clampToWorld, distance, moveToward } from "./geometry";
import { baseId } from "./state";
import type { Anchor, GameInput, GameState, PlayerId, Vec2 } from "./types";

interface NetworkNode {
  id: string;
  position: Vec2;
}

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
    id: `${playerId}-anchor-${state.anchors.length + 1}`,
    owner: playerId,
    position: { ...player.astronaut.position },
    parentId: parent.id,
    powered: true,
  };

  return {
    ...state,
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

  const player = state.players.player;
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

  const safe = isInsideSafeZone(state, "player", nextPosition);
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
      ...state,
      remainingMs: Math.max(0, state.remainingMs - deltaSeconds * 1000),
      players: {
        ...state.players,
        player: {
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
    };
  }

  let carriedSalvage = currentAstronaut.carriedSalvage;
  // Mapping returns a new deposit list while collecting anything within reach.
  const salvage = state.salvage.map((deposit) => {
    if (
      !deposit.collected &&
      carriedSalvage < GAME_RULES.salvageCarryLimit &&
      distance(nextPosition, deposit.position) <= GAME_RULES.collectionRadius
    ) {
      carriedSalvage += 1;
      return { ...deposit, collected: true };
    }
    return deposit;
  });

  let bankedSalvage = currentAstronaut.bankedSalvage;
  let tetherKits = currentAstronaut.tetherKits;
  if (carriedSalvage > 0 && isAtDeliveryNode(state, "player", nextPosition)) {
    // Each full salvage batch becomes a tether; the remainder stays banked.
    bankedSalvage += carriedSalvage;
    carriedSalvage = 0;
    tetherKits += Math.floor(bankedSalvage / GAME_RULES.salvagePerTether);
    bankedSalvage %= GAME_RULES.salvagePerTether;
  }

  return {
    ...state,
    remainingMs: Math.max(0, state.remainingMs - deltaSeconds * 1000),
    salvage,
    players: {
      ...state.players,
      player: {
        ...player,
        astronaut: {
          ...currentAstronaut,
          position: nextPosition,
          oxygen,
          carriedSalvage,
          bankedSalvage,
          tetherKits,
        },
      },
    },
  };
}

export function getTerritoryScore(state: GameState, playerId: PlayerId) {
  const poweredAnchors = state.anchors.filter(
    (anchor) => anchor.owner === playerId && anchor.powered,
  ).length;
  return Math.min(100, 6 + poweredAnchors * 6);
}
