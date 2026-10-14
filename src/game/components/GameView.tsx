import { useState } from "react";
import { useLocalMatch } from "../hooks/useLocalMatch";
import { sampleScorableTerritory } from "../simulation/scoring";
import type { GameState, MatchFinishReason, PlayerId } from "../types";
import { MatchScreen } from "./MatchScreen";
import { PostMatchScene } from "./PostMatchScene";

interface GameViewProps {
  audioEnabled: boolean;
  tutorialEnabled: boolean;
  onLeave: () => void;
}

export function GameView({ audioEnabled, tutorialEnabled, onLeave }: GameViewProps) {
  const [matchNumber, setMatchNumber] = useState(0);

  return (
    <LocalMatch
      key={matchNumber}
      audioEnabled={audioEnabled}
      tutorialEnabled={tutorialEnabled}
      onLeave={onLeave}
      onRestart={() => setMatchNumber((current) => current + 1)}
    />
  );
}

function LocalMatch({
  audioEnabled,
  tutorialEnabled,
  onLeave,
  onRestart,
}: {
  audioEnabled: boolean;
  tutorialEnabled: boolean;
  onLeave: () => void;
  onRestart: () => void;
}) {
  const { state, sendMovementCommand, deploy } = useLocalMatch();

  if (state.matchPhase === "finished") {
    return (
      <BotMatchResultView
        state={state}
        localPlayerId="player"
        opponentName="Bot"
        onRestart={onRestart}
        onLeave={onLeave}
      />
    );
  }

  return <MatchScreen state={state} localPlayerId="player" playerNames={{ rival: "Bot" }} statusText="Mechanics sandbox"
    audioEnabled={audioEnabled}
    tutorialEnabled={tutorialEnabled}
    interpolatePositions={true} onMovementCommand={sendMovementCommand} onDeploy={deploy} onLeave={onLeave} />;
}

function BotMatchResultView({
  state,
  localPlayerId,
  opponentName,
  onRestart,
  onLeave,
}: {
  state: GameState;
  localPlayerId: PlayerId;
  opponentName: string;
  onRestart: () => void;
  onLeave: () => void;
}) {
  const opponentId: PlayerId = localPlayerId === "player" ? "rival" : "player";
  const territory = sampleScorableTerritory(state).fractions;
  const winner = state.matchOutcome?.winner ?? fallbackWinner(state);
  const reason = state.matchOutcome?.reason ?? "regulation_score";
  const isDraw = winner === "draw";
  const didWin = winner === localPlayerId;
  const result = isDraw ? "Draw" : didWin ? "Victory" : "Defeat";
  const decidedInOvertime =
    reason === "overtime_lead" || reason === "overtime_territory";

  return (
    <PostMatchScene state={state} localPlayerId={localPlayerId}>
      <header className="section-heading result-heading">
        <p className="eyebrow">{finishLabel(reason)}</p>
        <h2>{result}</h2>
        <p>{describeFinish(reason, didWin, isDraw, opponentName)}</p>
      </header>

      <div className="result-scores" aria-label="Final scores">
        <ResultScore
          playerId={localPlayerId}
          label="You"
          score={state.scores[localPlayerId]}
          territory={territory[localPlayerId] * 100}
        />
        <ResultScore
          playerId={opponentId}
          label={opponentName}
          score={state.scores[opponentId]}
          territory={territory[opponentId] * 100}
        />
      </div>

      {decidedInOvertime && (
        <p className="result-overtime-score">
          <span>Overtime-only signal</span>
          <strong>
            You {state.overtimeScores[localPlayerId].toFixed(1)} · {opponentName}{" "}
            {state.overtimeScores[opponentId].toFixed(1)}
          </strong>
        </p>
      )}

      <p className="result-score-explainer">
        {reason === "overtime_lead"
          ? "Regulation totals remain above. The separate overtime race ended at a five-point lead."
          : reason === "overtime_territory"
            ? "Regulation totals remain above. Live territory decided the match when overtime expired."
            : "Signal score accumulates from uncontested powered territory throughout the match."}
      </p>

      <div className="result-actions">
        <button className="button button--primary" onClick={onRestart}>
          Play again
        </button>
        <button className="button button--secondary" onClick={onLeave}>
          Return to menu
        </button>
      </div>
    </PostMatchScene>
  );
}

function ResultScore({
  playerId,
  label,
  score,
  territory,
}: {
  playerId: PlayerId;
  label: string;
  score: number;
  territory: number;
}) {
  return (
    <div className={`result-score result-score--${playerId}`}>
      <span>{label}</span>
      <strong>{score.toFixed(1)}</strong>
      <small>signal · {Math.round(territory)}% final territory</small>
    </div>
  );
}

function fallbackWinner(state: GameState): PlayerId | "draw" {
  if (state.scores.player === state.scores.rival) return "draw";
  return state.scores.player > state.scores.rival ? "player" : "rival";
}

function finishLabel(reason: MatchFinishReason) {
  switch (reason) {
    case "base_collapse": return "Network collapsed";
    case "overtime_lead": return "Overtime breakthrough";
    case "overtime_territory": return "Overtime expired";
    default: return "Regulation complete";
  }
}

function describeFinish(
  reason: MatchFinishReason,
  didWin: boolean,
  isDraw: boolean,
  opponentName: string,
) {
  if (isDraw) {
    if (reason === "base_collapse") {
      return "Both exposed bases collapsed at the same moment.";
    }
    if (reason === "overtime_territory") {
      return "Both networks controlled equal live territory when overtime expired.";
    }
    return "Both networks finished level on signal.";
  }
  switch (reason) {
    case "base_collapse":
      return didWin
        ? `You held ${opponentName}'s exposed base until its network collapsed.`
        : `${opponentName} held your exposed base until your network collapsed.`;
    case "overtime_lead":
      return didWin
        ? "You established the decisive signal lead in overtime."
        : `${opponentName} established the decisive signal lead in overtime.`;
    case "overtime_territory":
      return didWin
        ? "You controlled more live territory when overtime expired."
        : `${opponentName} controlled more live territory when overtime expired.`;
    default:
      return didWin
        ? "Your network accumulated more signal during regulation."
        : `${opponentName}'s network accumulated more signal during regulation.`;
  }
}
