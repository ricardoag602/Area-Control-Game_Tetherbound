import type { GameState, MovementCommand, PlayerId } from "../../game/types";
import { MatchScreen } from "../../game/components/MatchScreen";
import type { ConnectionStatus } from "../RoomClient";
import type { RoomSnapshot } from "../protocol";

interface NetworkGameViewProps {
  state: GameState;
  room: RoomSnapshot;
  localPlayerId: PlayerId;
  connection: ConnectionStatus;
  latencyMs: number | null;
  onMovementCommand: (command: MovementCommand) => void;
  onDeploy: () => void;
  onLeave: () => void;
}

export function NetworkGameView({ state, room, localPlayerId, connection, latencyMs, onMovementCommand, onDeploy, onLeave }: NetworkGameViewProps) {
  const opponents = room.players.filter((player) => player.id !== localPlayerId);
  const disconnectedOpponent = opponents.find((player) => !player.connected);
  const controlsDisabled = connection !== "connected" || Boolean(disconnectedOpponent);
  const statusText = connection !== "connected"
    ? "Reconnecting · Match paused"
    : disconnectedOpponent
      ? `${disconnectedOpponent.name} reconnecting · Match paused`
      : "Room synchronized";
  const playerNames = Object.fromEntries(
    room.players.map((player) => [player.id, player.name]),
  ) as Partial<Record<PlayerId, string>>;
  return <MatchScreen state={state} localPlayerId={localPlayerId} playerNames={playerNames}
    statusText={statusText} latencyMs={latencyMs} controlsDisabled={controlsDisabled}
    interpolatePositions={true}
    onMovementCommand={onMovementCommand} onDeploy={onDeploy} onLeave={onLeave} />;
}
