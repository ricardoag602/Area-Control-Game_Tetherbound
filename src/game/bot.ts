import { GAME_RULES } from "./constants";
import { distance } from "./geometry";
import { canDeployAnchor, getPoweredNodes } from "./simulation";
import type { PlayerCommand } from "./playerController";
import type { GameState, PlayerId, Vec2 } from "./types";

const LOW_OXYGEN_THRESHOLD = 35;

/**
 * A deliberately small bot policy. It can only use the same two commands the
 * human currently has: choose a movement target and request an anchor deploy.
 */
export function getBotCommand(state: GameState, playerId: PlayerId): PlayerCommand {
  if (state.remainingMs <= 0) {
    return { moveTarget: null, deployAnchor: false };
  }

  const astronaut = state.players[playerId].astronaut;
  const poweredNode = closestPosition(
    astronaut.position,
    getPoweredNodes(state, playerId).map((node) => node.position),
  );
  const shouldReturn =
    astronaut.oxygen <= LOW_OXYGEN_THRESHOLD ||
    astronaut.carriedSalvage >= GAME_RULES.salvageCarryLimit;

  let moveTarget: Vec2 | null = null;
  if (shouldReturn) {
    moveTarget = poweredNode;
  } else {
    moveTarget = closestPosition(
      astronaut.position,
      state.salvage
        .filter((deposit) => !deposit.collected)
        .map((deposit) => deposit.position),
    );

    // Bank any remaining salvage after the map has been cleared.
    if (!moveTarget && astronaut.carriedSalvage > 0) {
      moveTarget = poweredNode;
    }
  }

  return {
    moveTarget,
    deployAnchor: canDeployAnchor(state, playerId),
  };
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
