import type { ConnectionStatus } from "../../network/RoomClient";
import type { RoomSnapshot } from "../../network/protocol";
import type { GameState, PlayerId, Vec2 } from "../types";
import { MatchScreen } from "./MatchScreen";

interface NetworkGameViewProps {
  state: GameState;
  room: RoomSnapshot;
  localPlayerId: PlayerId;
  connection: ConnectionStatus;
  latencyMs: number | null;
  onMoveTargetChange: (target: Vec2 | null) => void;
  onDeploy: () => void;
  onLeave: () => void;
}

export function NetworkGameView({ state, room, localPlayerId, connection, latencyMs, onMoveTargetChange, onDeploy, onLeave }: NetworkGameViewProps) {
  const opponent = room.players.find((player) => player.id !== localPlayerId);
  const controlsDisabled = connection !== "connected" || !opponent?.connected;
  const statusText = connection !== "connected"
    ? "Reconnecting · Match paused"
    : !opponent?.connected
      ? "Opponent reconnecting · Match paused"
      : "Room synchronized";
  return <MatchScreen state={state} localPlayerId={localPlayerId} opponentName={opponent?.name ?? "Rival"}
    statusText={statusText} latencyMs={latencyMs} controlsDisabled={controlsDisabled}
    onMoveTargetChange={onMoveTargetChange} onDeploy={onDeploy} onLeave={onLeave} />;
}
