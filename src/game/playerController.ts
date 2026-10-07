import { advanceMatch, deployAnchor } from "./simulation";
import type { GameInput, GameState, PlayerId } from "./types";

export interface PlayerCommand extends GameInput {
  deployAnchor: boolean;
}

export type PlayerCommands = Partial<Record<PlayerId, PlayerCommand>>;

const PLAYER_ORDER: PlayerId[] = ["player", "rival"];

/**
 * Applies commands without caring whether they came from a person, a bot, or
 * the network. All controllers therefore use the same game-rule functions.
 */
export function applyPlayerCommands(
  state: GameState,
  commands: PlayerCommands,
  deltaSeconds: number,
): GameState {
  let nextState = state;
  const inputs: Partial<Record<PlayerId, GameInput>> = {};

  for (const playerId of PLAYER_ORDER) {
    const command = commands[playerId];
    if (!command) continue;

    if (command.deployAnchor) {
      nextState = deployAnchor(nextState, playerId);
    }
    inputs[playerId] = { moveTarget: command.moveTarget };
  }

  return advanceMatch(nextState, inputs, deltaSeconds);
}
