import { useCallback, useState } from "react";
import { useLocalMatch } from "../hooks/useLocalMatch";
import { sampleScorableTerritory } from "../simulation/scoring";
import type {
  GameState,
  MatchFinishReason,
  PlayerId,
  PlayerLimit,
} from "../types";
import { MatchScreen } from "./MatchScreen";
import { PostMatchScene } from "./PostMatchScene";
import type { ArenaPresentationState } from "./ArenaRenderer";

interface GameViewProps {
  alwaysShowJoystick: boolean;
  audioEnabled: boolean;
  tutorialEnabled: boolean;
  playerLimit: PlayerLimit;
  onLeave: () => void;
}

const LOCAL_BOT_NAMES: Partial<Record<PlayerId, string>> = {
  rival: "Bot 1",
  player3: "Bot 2",
  player4: "Bot 3",
};

export function GameView({
  alwaysShowJoystick,
  audioEnabled,
  tutorialEnabled,
  playerLimit,
  onLeave,
}: GameViewProps) {
  const [matchNumber, setMatchNumber] = useState(0);

  return (
    <LocalMatch
      key={`${playerLimit}-${matchNumber}`}
      alwaysShowJoystick={alwaysShowJoystick}
      audioEnabled={audioEnabled}
      tutorialEnabled={tutorialEnabled}
      playerLimit={playerLimit}
      onLeave={onLeave}
      onRestart={() => setMatchNumber((current) => current + 1)}
    />
  );
}

function LocalMatch({
  alwaysShowJoystick,
  audioEnabled,
  tutorialEnabled,
  playerLimit,
  onLeave,
  onRestart,
}: {
  alwaysShowJoystick: boolean;
  audioEnabled: boolean;
  tutorialEnabled: boolean;
  playerLimit: PlayerLimit;
  onLeave: () => void;
  onRestart: () => void;
}) {
  const [presentationReady, setPresentationReady] = useState(false);
  const { state, sendMovementCommand, deploy } = useLocalMatch({
    paused: !presentationReady,
    playerLimit,
  });
  const handlePresentationStateChange = useCallback(
    (presentationState: ArenaPresentationState) => {
      setPresentationReady(
        presentationState === "ready" || presentationState === "fallback",
      );
    },
    [],
  );

  if (state.matchPhase === "finished") {
    return (
      <BotMatchResultView
        state={state}
        localPlayerId="player"
        onRestart={onRestart}
        onLeave={onLeave}
      />
    );
  }

  return (
    <MatchScreen
      state={state}
      localPlayerId="player"
      playerNames={LOCAL_BOT_NAMES}
      statusText={`${playerLimit}-player bot match`}
      alwaysShowJoystick={alwaysShowJoystick}
      audioEnabled={audioEnabled}
      tutorialEnabled={tutorialEnabled}
      interpolatePositions={true}
      onPresentationStateChange={handlePresentationStateChange}
      onMovementCommand={sendMovementCommand}
      onDeploy={deploy}
      onLeave={onLeave}
    />
  );
}

function BotMatchResultView({
  state,
  localPlayerId,
  onRestart,
  onLeave,
}: {
  state: GameState;
  localPlayerId: PlayerId;
  onRestart: () => void;
  onLeave: () => void;
}) {
  const territory = sampleScorableTerritory(state).fractions;
  const winner = state.matchOutcome?.winner ?? fallbackWinner(state);
  const reason = state.matchOutcome?.reason ?? "regulation_score";
  const isDraw = winner === "draw";
  const didWin = winner === localPlayerId;
  const winnerName = winner === "draw"
    ? null
    : winner === localPlayerId
      ? "You"
      : LOCAL_BOT_NAMES[winner] ?? "A bot";
  const result = isDraw ? "Draw" : didWin ? "Victory" : "Defeat";
  const decidedInOvertime =
    reason === "overtime_lead" || reason === "overtime_territory";

  return (
    <PostMatchScene state={state} localPlayerId={localPlayerId}>
      <header className="section-heading result-heading">
        <p className="eyebrow">{finishLabel(reason)}</p>
        <h2>{result}</h2>
        <p>{describeFinish(reason, didWin, isDraw, winnerName)}</p>
      </header>

      <div className="result-scores" aria-label="Final scores">
        {state.activePlayerIds.map((playerId) => (
          <ResultScore
            key={playerId}
            playerId={playerId}
            label={playerId === localPlayerId
              ? "You"
              : LOCAL_BOT_NAMES[playerId] ?? "Bot"}
            score={state.scores[playerId]}
            territory={territory[playerId] * 100}
          />
        ))}
      </div>

      {decidedInOvertime && (
        <p className="result-overtime-score">
          <span>Overtime-only signal</span>
          <strong>
            {state.activePlayerIds.map((playerId) => {
              const name = playerId === localPlayerId
                ? "You"
                : LOCAL_BOT_NAMES[playerId] ?? "Bot";
              return `${name} ${state.overtimeScores[playerId].toFixed(1)}`;
            }).join(" · ")}
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
  const best = Math.max(
    ...state.activePlayerIds.map((playerId) => state.scores[playerId]),
  );
  const leaders = state.activePlayerIds.filter(
    (playerId) => Math.abs(state.scores[playerId] - best) <= 1e-9,
  );
  return leaders.length === 1 ? leaders[0] : "draw";
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
  winnerName: string | null,
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
        ? "You held an exposed base until its network collapsed."
        : `${winnerName ?? "A bot"} completed a decisive base collapse.`;
    case "overtime_lead":
      return didWin
        ? "You established the decisive signal lead in overtime."
        : `${winnerName ?? "A bot"} established the decisive signal lead in overtime.`;
    case "overtime_territory":
      return didWin
        ? "You controlled more live territory when overtime expired."
        : `${winnerName ?? "A bot"} controlled more live territory when overtime expired.`;
    default:
      return didWin
        ? "Your network accumulated more signal during regulation."
        : `${winnerName ?? "A bot"} accumulated the most signal during regulation.`;
  }
}
