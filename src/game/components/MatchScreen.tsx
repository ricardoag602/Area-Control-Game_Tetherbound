import { canDeployAnchor, getTerritoryScore, isInsideSafeZone } from "../simulation";
import type { GameState, PlayerId, Vec2 } from "../types";
import { ArenaRenderer } from "./ArenaRenderer";

interface MatchScreenProps {
  state: GameState;
  localPlayerId: PlayerId;
  opponentName: string;
  statusText: string;
  latencyMs?: number | null;
  controlsDisabled?: boolean;
  onMoveTargetChange: (target: Vec2 | null) => void;
  onDeploy: () => void;
  onLeave: () => void;
}

function formatTime(milliseconds: number) {
  const totalSeconds = Math.ceil(milliseconds / 1000);
  return `${Math.floor(totalSeconds / 60)}:${(totalSeconds % 60).toString().padStart(2, "0")}`;
}

export function MatchScreen({ state, localPlayerId, opponentName, statusText, latencyMs, controlsDisabled = false, onMoveTargetChange, onDeploy, onLeave }: MatchScreenProps) {
  const opponentId: PlayerId = localPlayerId === "player" ? "rival" : "player";
  const astronaut = state.players[localPlayerId].astronaut;
  const safe = isInsideSafeZone(state, localPlayerId, astronaut.position);
  const oxygenRounded = Math.round(astronaut.oxygen);

  return (
    <div className="screen screen--game">
      <div className="game-hud game-hud--top">
        <button className="icon-button" onClick={onLeave} aria-label="Leave match">×</button>
        <div className={`score-panel score-panel--${localPlayerId === "player" ? "cyan" : "coral"}`}>
          <span>You</span><strong>{getTerritoryScore(state, localPlayerId)}%</strong>
        </div>
        <div className="match-clock">
          <span>{statusText}{latencyMs !== undefined && ` · ${latencyMs ?? "—"} ms`}</span>
          <strong>{formatTime(state.remainingMs)}</strong>
        </div>
        <div className={`score-panel score-panel--${opponentId === "player" ? "cyan" : "coral"}`}>
          <span>{opponentName}</span><strong>{getTerritoryScore(state, opponentId)}%</strong>
        </div>
      </div>
      <div className="arena">
        <ArenaRenderer state={state} disabled={controlsDisabled} onMoveTargetChange={onMoveTargetChange} />
        <div className={safe ? "zone-status zone-status--safe" : "zone-status zone-status--exposed"}>
          {safe ? "Life support connected" : "Emergency oxygen draining"}
        </div>
        <p className="control-hint">{controlsDisabled ? "Match paused while the link recovers" : "Hold and drag anywhere to move"}</p>
      </div>
      <div className="game-hud game-hud--bottom">
        <div className="meter-group">
          <div className="meter-label"><span>Oxygen</span><strong>{oxygenRounded}%</strong></div>
          <div className="meter"><span className={oxygenRounded <= 30 ? "meter__fill meter__fill--danger" : "meter__fill"}
            style={{ width: `${oxygenRounded}%` }} /></div>
        </div>
        <div className="resource-stack">
          <div className="resource-pill" title="Carried salvage"><span>◆</span><strong>{astronaut.carriedSalvage} / 3</strong></div>
          <small>{astronaut.tetherKits} tethers</small>
        </div>
        <button className="deploy-button" disabled={controlsDisabled || !canDeployAnchor(state, localPlayerId)} onClick={onDeploy}>Deploy</button>
      </div>
    </div>
  );
}
