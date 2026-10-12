import { advanceMatch } from "./match";
import { deployAnchor } from "./tetherNetwork";
import type { GameInput, GameState, MovementCommand, PlayerId } from "../types";

export interface PlayerCommand {
  movementCommands: MovementCommand[];
  deployAnchor: boolean;
}

export type PlayerCommands = Partial<Record<PlayerId, PlayerCommand>>;

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
  const inputs: Partial<Record<PlayerId, GameInput[]>> = {};

  for (const playerId of state.activePlayerIds) {
    const command = commands[playerId];
    if (!command) continue;

    if (command.deployAnchor) {
      nextState = deployAnchor(nextState, playerId);
    }
    let sequence = Math.max(
      nextState.players[playerId].astronaut.movement.lastCommandSequence,
      ...(nextState.pendingInputs?.[playerId] ?? []).map((input) => input.sequence),
    );
    inputs[playerId] = command.movementCommands.map((movementCommand) => ({
      sequence: ++sequence,
      command: movementCommand,
    }));
  }

  return advanceMatch(nextState, inputs, deltaSeconds);
}
