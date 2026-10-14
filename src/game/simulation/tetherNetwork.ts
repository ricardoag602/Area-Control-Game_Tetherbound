import { GAME_RULES } from "../constants";
import { distance } from "../geometry";
import { baseId } from "../state";
import type { Anchor, GameState, PlayerId, Vec2 } from "../types";

export interface NetworkNode {
  id: string;
  position: Vec2;
}

export function getPoweredNodes(
  state: GameState,
  playerId: PlayerId,
): NetworkNode[] {
  return [
    { id: baseId(playerId), position: state.players[playerId].basePosition },
    ...state.anchors
      .filter((anchor) => anchor.owner === playerId && anchor.powered)
      .map((anchor) => ({ id: anchor.id, position: anchor.position })),
  ];
}

export function isInsideSafeZone(
  state: GameState,
  playerId: PlayerId,
  position: Vec2,
) {
  return getPoweredNodes(state, playerId).some(
    (node) => distance(node.position, position) <= GAME_RULES.safeZoneRadius,
  );
}

export function isAtDeliveryNode(
  state: GameState,
  playerId: PlayerId,
  position: Vec2,
) {
  const player = state.players[playerId];
  // The whole visible home zone accepts salvage. This guarantees recovery when
  // a player has spent every kit and avoids a hidden precision requirement at
  // the one node they can always reach.
  if (
    distance(player.basePosition, position) <= GAME_RULES.safeZoneRadius
  ) {
    return true;
  }

  // Remote anchors keep a smaller hand-in radius so returning resources still
  // asks the player to reach the actual tether instead of grazing its zone.
  return isAtAnchorDeliveryNode(state, playerId, position);
}

export function isAtAnchorDeliveryNode(
  state: GameState,
  playerId: PlayerId,
  position: Vec2,
) {
  return state.anchors.some(
    (anchor) =>
      anchor.owner === playerId &&
      anchor.powered &&
      distance(anchor.position, position) <= GAME_RULES.deliveryRadius,
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
    state.matchPhase !== "finished" &&
    state.remainingMs > 0 &&
    player.astronaut.tetherKits > 0 &&
    player.astronaut.movement.mode !== "charging" &&
    player.astronaut.movement.mode !== "burst" &&
    findConnectionParent(state, playerId, position) !== null &&
    [
      { position: player.basePosition },
      ...ownedAnchors,
    ].every(
      (node) =>
        distance(node.position, position) >= GAME_RULES.minimumAnchorSpacing,
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
    disruptedUntilMs: null,
    protectedUntilMs: null,
    overloadProgress: 0,
    repairProgress: 0,
  };

  return {
    ...state,
    nextAnchorId: state.nextAnchorId + 1,
    anchors: [...state.anchors, anchor],
    hasDeployedAnchor: {
      ...state.hasDeployedAnchor,
      [playerId]: true,
    },
    // A newly connected anchor restores the network immediately, including
    // for deploy actions processed between fixed simulation ticks.
    baseCollapseProgressMs: {
      ...state.baseCollapseProgressMs,
      [playerId]: 0,
    },
    baseCollapseAttacker: {
      ...state.baseCollapseAttacker,
      [playerId]: null,
    },
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
