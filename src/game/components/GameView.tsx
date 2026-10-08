import { useLocalMatch } from "../useLocalMatch";
import { MatchScreen } from "./MatchScreen";

interface GameViewProps {
  onLeave: () => void;
}

export function GameView({ onLeave }: GameViewProps) {
  const { state, sendMovementCommand, deploy } = useLocalMatch();
  return <MatchScreen state={state} localPlayerId="player" opponentName="Bot" statusText="Mechanics sandbox"
    interpolatePositions={true} onMovementCommand={sendMovementCommand} onDeploy={deploy} onLeave={onLeave} />;
}
