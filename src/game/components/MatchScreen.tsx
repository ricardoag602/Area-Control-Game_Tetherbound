import { useMemo, type CSSProperties } from "react";
import { GAME_RULES } from "../constants";
import {
  canDeployAnchor,
  isInsideSafeZone,
} from "../simulation/tetherNetwork";
import { MOVEMENT_RULES } from "../movement/movement";
import { calculateOxygenPresentation } from "../presentation/oxygen";
import { useDeployShortcut } from "../input/useDeployShortcut";
import type { GameState, MovementCommand, PlayerId } from "../types";
import { sampleTerritoryGrid } from "../world/territory";
import { sampleWorld } from "../world/map";
import type { WorldTimelineEvent } from "../world/timeline";
import { ArenaRenderer } from "./ArenaRenderer";
import { Minimap } from "./Minimap";
import { TetherResources } from "./TetherResources";

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
  const territoryGrid = useMemo(() => sampleTerritoryGrid(state), [
    state.anchors,
    state.players.player.basePosition.x,
    state.players.player.basePosition.y,
    state.players.rival.basePosition.x,
    state.players.rival.basePosition.y,
  ]);
  const safe = isInsideSafeZone(state, localPlayerId, astronaut.position);
  const oxygenRounded = Math.round(astronaut.oxygen);
  const oxygenPresentation = calculateOxygenPresentation(
    astronaut.oxygen,
    GAME_RULES.oxygenMaximum,
  );
  const oxygenEffectStyle = {
    "--oxygen-vignette-opacity": oxygenPresentation.redVignetteOpacity,
    "--oxygen-wash-opacity": oxygenPresentation.redWashOpacity,
  } as CSSProperties;
  const worldSample = sampleWorld(astronaut.position);
  const lastWorldEvent = state.lastWorldEvent ?? null;
  const elapsedMs = Number.isFinite(state.elapsedMs)
    ? state.elapsedMs
    : GAME_RULES.matchDurationMs - state.remainingMs;
  const timelineTicksPerSecond = state.worldTimeline?.rules.ticksPerSecond ?? 20;
  const eventAgeMs = lastWorldEvent
    ? elapsedMs - lastWorldEvent.scheduledTick /
      timelineTicksPerSecond * 1_000
    : Number.POSITIVE_INFINITY;
  const eventAnnouncement = lastWorldEvent &&
      eventAgeMs >= 0 && eventAgeMs < 4_500
    ? describeWorldEvent(lastWorldEvent)
    : null;
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
          <span>You</span><strong>{Math.round(territoryGrid.score[localPlayerId])}%</strong>
        </div>
        <div className="match-clock">
          <span>{statusText}{latencyMs !== undefined && ` · ${latencyMs ?? "—"} ms`}</span>
          <strong>{formatTime(state.remainingMs)}</strong>
        </div>
        <div className={`score-panel score-panel--${opponentId === "player" ? "cyan" : "coral"}`}>
          <span>{opponentName}</span><strong>{Math.round(territoryGrid.score[opponentId])}%</strong>
        </div>
      </div>
      <div className="arena">
        <ArenaRenderer state={state} localPlayerId={localPlayerId} disabled={controlsDisabled}
          interpolatePositions={interpolatePositions}
          oxygenZoomMultiplier={oxygenPresentation.cameraZoomMultiplier}
          onMovementCommand={onMovementCommand} />
        <div className="oxygen-danger-overlay" style={oxygenEffectStyle} aria-hidden="true" />
        <Minimap state={state} localPlayerId={localPlayerId} grid={territoryGrid} />
        <div className="biome-status">
          <span>Biome</span>
          <strong>{formatBiome(worldSample?.biome ?? "neutral")}</strong>
        </div>
        {eventAnnouncement && (
          <div className="world-event-toast" role="status">{eventAnnouncement}</div>
        )}
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
                drag to move · tap, then hold nearby to charge
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
        <TetherResources
          bankedSalvage={astronaut.bankedSalvage}
          carriedSalvage={astronaut.carriedSalvage}
          tetherKits={astronaut.tetherKits}
        />
        <button className="deploy-button" disabled={deployDisabled} onClick={onDeploy}
          aria-label="Deploy tether" aria-keyshortcuts="T" title="Deploy tether (T)">
          Deploy <kbd className="deploy-button__shortcut">T</kbd>
        </button>
      </div>
    </div>
  );
}

function describeWorldEvent(event: WorldTimelineEvent) {
  if (event.kind === "salvage_drop") {
    return `Supply drop · ${formatBiome(event.biome)} · ${event.amount} salvage`;
  }
  return null;
}

function formatBiome(biome: string) {
  return biome.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
