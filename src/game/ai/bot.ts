import { GAME_RULES } from "../constants";
import { distance } from "../geometry";
import { canDeployAnchor, getPoweredNodes } from "../simulation/tetherNetwork";
import { isAnchorDirectlyDisrupted } from "../simulation/tetherConflict";
import type { PlayerCommand } from "../simulation/playerController";
import type { Anchor, GameState, PlayerId, Vec2 } from "../types";

const LOW_OXYGEN_THRESHOLD = 35;
const ATTACK_OXYGEN_THRESHOLD = 62;
const CONFLICT_SEEK_RADIUS = 34;
const PREFERRED_LINK_DISTANCE_RATIO = 0.75;

/**
 * A deliberately small bot policy. It can only use the same two commands the
 * human currently has: choose a movement target and request an anchor deploy.
 */
export function getBotCommand(state: GameState, playerId: PlayerId): PlayerCommand {
  if (state.matchPhase === "finished" || state.remainingMs <= 0) {
    return { movementCommands: [{ type: "stop" }], deployAnchor: false };
  }

  const opponentId: PlayerId = playerId === "player" ? "rival" : "player";
  const astronaut = state.players[playerId].astronaut;
  const poweredNode = closestPosition(
    astronaut.position,
    getPoweredNodes(state, playerId).map((node) => node.position),
  );
  const poweredNodeDistance = poweredNode
    ? distance(astronaut.position, poweredNode)
    : Number.POSITIVE_INFINITY;
  // Save limited kits for meaningful extensions instead of dropping them as
  // soon as the seven-unit minimum spacing becomes legal.
  const readyToExtendNetwork = poweredNodeDistance >=
    GAME_RULES.maximumLinkDistance * PREFERRED_LINK_DISTANCE_RATIO;
  const shouldReturn =
    astronaut.oxygen <= LOW_OXYGEN_THRESHOLD ||
    astronaut.carriedSalvage >= GAME_RULES.salvageCarryLimit;
  const ownNetworkOffline = state.hasDeployedAnchor[playerId] &&
    !state.anchors.some(
      (anchor) => anchor.owner === playerId && anchor.powered,
    );
  const enemyBaseExposed = state.matchPhase !== "setup" &&
    state.hasDeployedAnchor[opponentId] &&
    !state.anchors.some(
      (anchor) => anchor.owner === opponentId && anchor.powered,
    );

  let moveTarget: Vec2 | null = null;
  let pursuingConflict = false;
  if (state.baseCollapseProgressMs[playerId] > 0) {
    // The home base is safe for its owner, so this also recovers oxygen while
    // immediately contesting a collapse attempt.
    moveTarget = state.players[playerId].basePosition;
    pursuingConflict = true;
  } else if (shouldReturn) {
    moveTarget = poweredNode;
  } else {
    const repairTarget = closestAnchor(
      astronaut.position,
      state.anchors.filter(
        (anchor) =>
          anchor.owner === playerId &&
          isAnchorDirectlyDisrupted(anchor, state.elapsedMs) &&
          parentIsPowered(state, anchor),
      ),
      ownNetworkOffline ? Number.POSITIVE_INFINITY : CONFLICT_SEEK_RADIUS,
    );
    const enemyTarget = astronaut.oxygen >= ATTACK_OXYGEN_THRESHOLD
      ? closestAnchor(
          astronaut.position,
          state.anchors.filter(
            (anchor) => anchor.owner !== playerId && anchor.powered,
          ),
          CONFLICT_SEEK_RADIUS,
        )
      : null;

    const conflictTarget = repairTarget ?? enemyTarget;
    if (conflictTarget) {
      moveTarget = conflictTarget.position;
      pursuingConflict = true;
    } else if (
      enemyBaseExposed &&
      astronaut.oxygen >= ATTACK_OXYGEN_THRESHOLD
    ) {
      moveTarget = state.players[opponentId].basePosition;
      pursuingConflict = true;
    } else {
      moveTarget = closestPosition(
        astronaut.position,
        state.salvage
          .filter((deposit) => !deposit.collected)
          .map((deposit) => deposit.position),
      );
    }

    // Bank any remaining salvage after the map has been cleared.
    if (!moveTarget && astronaut.carriedSalvage > 0) {
      moveTarget = poweredNode;
    }
  }

  return {
    movementCommands: moveTarget ? [{ type: "walk", target: moveTarget }] : [{ type: "stop" }],
    deployAnchor:
      !pursuingConflict &&
      readyToExtendNetwork &&
      canDeployAnchor(state, playerId),
  };
}

function closestAnchor(
  origin: Vec2,
  anchors: Anchor[],
  maximumDistance: number,
) {
  const closest = anchors
    .map((anchor) => ({ anchor, distance: distance(origin, anchor.position) }))
    .sort((a, b) => a.distance - b.distance || a.anchor.id.localeCompare(b.anchor.id))[0];
  return closest && closest.distance <= maximumDistance ? closest.anchor : null;
}

function parentIsPowered(state: GameState, anchor: Anchor) {
  if (anchor.parentId === `${anchor.owner}-base`) return true;
  return state.anchors.some(
    (candidate) => candidate.id === anchor.parentId && candidate.powered,
  );
}

function closestPosition(origin: Vec2, positions: Vec2[]): Vec2 | null {
  let closest: Vec2 | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const position of positions) {
    const candidateDistance = distance(origin, position);
    if (candidateDistance < closestDistance) {
      closest = position;
      closestDistance = candidateDistance;
    }
  }

  return closest ? { ...closest } : null;
}
