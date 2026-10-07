import { useLocalMatch } from "../useLocalMatch";
import { MatchScreen } from "./MatchScreen";

interface GameViewProps {
  onLeave: () => void;
}

export function GameView({ onLeave }: GameViewProps) {
  const { state, setMoveTarget, deploy } = useLocalMatch();
  return <MatchScreen state={state} localPlayerId="player" opponentName="Bot" statusText="Mechanics sandbox"
    onMoveTargetChange={setMoveTarget} onDeploy={deploy} onLeave={onLeave} />;
}
