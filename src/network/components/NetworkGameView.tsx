import type { GameState, MovementCommand, PlayerId } from "../../game/types";
import { MatchScreen } from "../../game/components/MatchScreen";
import type { ConnectionStatus } from "../RoomClient";
import type { RoomSnapshot } from "../protocol";
import type { VideoMode } from "../../game/preferences/video";

interface NetworkGameViewProps {
  alwaysShowJoystick: boolean;
  audioEnabled: boolean;
  sfxVolume: number;
  tutorialEnabled: boolean;
  videoMode?: VideoMode;
  state: GameState;
  room: RoomSnapshot;
  localPlayerId: PlayerId;
  connection: ConnectionStatus;
  error: string | null;
  latencyMs: number | null;
  onMovementCommand: (command: MovementCommand) => void;
  onDeploy: () => void;
  onRetry: () => void;
  onLeave: () => void;
}

export function NetworkGameView({ alwaysShowJoystick, audioEnabled, sfxVolume, tutorialEnabled, videoMode = "quality", state, room, localPlayerId, connection, error, latencyMs, onMovementCommand, onDeploy, onRetry, onLeave }: NetworkGameViewProps) {
  const opponents = room.players.filter((player) => player.id !== localPlayerId);
  const disconnectedOpponent = opponents.find((player) => !player.connected);
  const controlsDisabled = connection !== "connected" || Boolean(disconnectedOpponent);
  const statusText = connection === "offline"
    ? "Connection lost · Match paused"
    : connection !== "connected"
      ? "Reconnecting · Match paused"
    : disconnectedOpponent
      ? `${disconnectedOpponent.name} reconnecting · Match paused`
      : "Room synchronized";
  const playerNames = Object.fromEntries(
    room.players.map((player) => [player.id, player.name]),
  ) as Partial<Record<PlayerId, string>>;
  return <MatchScreen state={state} localPlayerId={localPlayerId} playerNames={playerNames}
    alwaysShowJoystick={alwaysShowJoystick}
    audioEnabled={audioEnabled}
    sfxVolume={sfxVolume}
    tutorialEnabled={tutorialEnabled}
    videoMode={videoMode}
    statusText={statusText} latencyMs={latencyMs} controlsDisabled={controlsDisabled}
    reconnectPrompt={connection === "offline"
      ? { message: error ?? "Connection to the room was lost.", onRetry }
      : undefined}
    interpolatePositions={true}
    onMovementCommand={onMovementCommand} onDeploy={onDeploy} onLeave={onLeave} />;
}
