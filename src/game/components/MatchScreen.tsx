import { canDeployAnchor, getTerritoryScore, isInsideSafeZone } from "../simulation";
import { MOVEMENT_RULES } from "../movement";
import { useDeployShortcut } from "../input/useDeployShortcut";
import type { GameState, MovementCommand, PlayerId } from "../types";
import { ArenaRenderer } from "./ArenaRenderer";

interface MatchScreenProps {
  state: GameState;
  localPlayerId: PlayerId;
  opponentName: string;
  statusText: string;
  latencyMs?: number | null;
  controlsDisabled?: boolean;
  interpolatePositions?: boolean;
  onMovementCommand: (command: MovementCommand) => void;
  onDeploy: () => void;
  onLeave: () => void;
}

function formatTime(milliseconds: number) {
  const totalSeconds = Math.ceil(milliseconds / 1000);
  return `${Math.floor(totalSeconds / 60)}:${(totalSeconds % 60).toString().padStart(2, "0")}`;
}

export function MatchScreen({ state, localPlayerId, opponentName, statusText, latencyMs, controlsDisabled = false, interpolatePositions = false, onMovementCommand, onDeploy, onLeave }: MatchScreenProps) {
  const opponentId: PlayerId = localPlayerId === "player" ? "rival" : "player";
  const astronaut = state.players[localPlayerId].astronaut;
  const safe = isInsideSafeZone(state, localPlayerId, astronaut.position);
  const oxygenRounded = Math.round(astronaut.oxygen);
  const chargePercent = Math.min(
    100,
    Math.round((astronaut.movement.chargeSeconds / MOVEMENT_RULES.fullChargeSeconds) * 100),
  );
  const controlHint = controlsDisabled
    ? "Match paused while the link recovers"
    : astronaut.movement.mode === "charging"
      ? chargePercent >= 100
        ? "Burst ready · release"
        : `Charging ${chargePercent}% · movement settling`
      : astronaut.movement.mode === "burst"
        ? "Momentum burst"
        : null;
  const deployDisabled = controlsDisabled || !canDeployAnchor(state, localPlayerId);
  useDeployShortcut({ disabled: deployDisabled, onDeploy });

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
        <ArenaRenderer state={state} localPlayerId={localPlayerId} disabled={controlsDisabled}
          interpolatePositions={interpolatePositions}
          onMovementCommand={onMovementCommand} />
        <div className={safe ? "zone-status zone-status--safe" : "zone-status zone-status--exposed"}>
          {safe ? "Life support connected" : "Emergency oxygen draining"}
        </div>
        <p className={astronaut.movement.mode === "charging" ? "control-hint control-hint--charging" : "control-hint"}>
          {controlHint ?? (
            <>
              <span className="control-hint__keyboard control-hint__keyboard--active">
                Drive: W/S · Turn: A/D · Boost: tap, then hold W or S · T: tether
              </span>
              <span className="control-hint__pointer">
                drag to move · hold your astronaut to charge
              </span>
            </>
          )}
        </p>
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
        <button className="deploy-button" disabled={deployDisabled} onClick={onDeploy}
          aria-label="Deploy tether" aria-keyshortcuts="T" title="Deploy tether (T)">
          Deploy <kbd className="deploy-button__shortcut">T</kbd>
        </button>
      </div>
    </div>
  );
}
