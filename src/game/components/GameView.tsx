import { canDeployAnchor, getTerritoryScore, isInsideSafeZone } from "../simulation";
import type { GameMode } from "../types";
import { useLocalMatch } from "../useLocalMatch";
import { ArenaRenderer } from "./ArenaRenderer";

interface GameViewProps {
  mode: GameMode;
  onLeave: () => void;
}

function formatTime(milliseconds: number) {
  const totalSeconds = Math.ceil(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function GameView({ mode, onLeave }: GameViewProps) {
  const { state, setMoveTarget, deploy } = useLocalMatch();
  const astronaut = state.players.player.astronaut;
  const safe = isInsideSafeZone(state, "player", astronaut.position);
  const deployAvailable = canDeployAnchor(state, "player");
  const oxygenRounded = Math.round(astronaut.oxygen);

  return (
    <div className="screen screen--game">
      <div className="game-hud game-hud--top">
        <button className="icon-button" onClick={onLeave} aria-label="Leave match">×</button>
        <div className="score-panel score-panel--cyan">
          <span>You</span>
          <strong>{getTerritoryScore(state, "player")}%</strong>
        </div>
        <div className="match-clock">
          <span>{mode === "bot" ? "Mechanics sandbox" : "Local room preview"}</span>
          <strong>{formatTime(state.remainingMs)}</strong>
        </div>
        <div className="score-panel score-panel--coral">
          <span>{mode === "bot" ? "Bot" : "Rival"}</span>
          <strong>{getTerritoryScore(state, "rival")}%</strong>
        </div>
      </div>

      <div className="arena">
        <ArenaRenderer state={state} onMoveTargetChange={setMoveTarget} />
        <div className={safe ? "zone-status zone-status--safe" : "zone-status zone-status--exposed"}>
          {safe ? "Life support connected" : "Emergency oxygen draining"}
        </div>
        <p className="control-hint">Hold and drag anywhere to move</p>
      </div>

      <div className="game-hud game-hud--bottom">
        <div className="meter-group">
          <div className="meter-label"><span>Oxygen</span><strong>{oxygenRounded}%</strong></div>
          <div className="meter">
            <span
              className={oxygenRounded <= 30 ? "meter__fill meter__fill--danger" : "meter__fill"}
              style={{ width: `${oxygenRounded}%` }}
            />
          </div>
        </div>
        <div className="resource-stack">
          <div className="resource-pill" title="Carried salvage">
            <span>◆</span><strong>{astronaut.carriedSalvage} / 3</strong>
          </div>
          <small>{astronaut.tetherKits} tethers</small>
        </div>
        <button className="deploy-button" disabled={!deployAvailable} onClick={deploy}>
          Deploy
        </button>
      </div>
    </div>
  );
}
