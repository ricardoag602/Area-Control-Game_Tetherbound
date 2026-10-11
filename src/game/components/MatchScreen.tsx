import { useMemo, type CSSProperties } from "react";
import { GAME_RULES } from "../constants";
import { distance } from "../geometry";
import {
  canDeployAnchor,
  isInsideSafeZone,
} from "../simulation/tetherNetwork";
import { MOVEMENT_RULES } from "../movement/movement";
import { calculateOxygenPresentation } from "../presentation/oxygen";
import { useDeployShortcut } from "../input/useDeployShortcut";
import { sampleScorableTerritory } from "../simulation/scoring";
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
  const scorableTerritory = useMemo(() => sampleScorableTerritory(state).fractions, [
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
  const phase = getPhasePresentation(state, localPlayerId);
  const localCollapseProgress = state.baseCollapseProgressMs[localPlayerId];
  const opponentCollapseProgress = state.baseCollapseProgressMs[opponentId];
  const collapsingBaseId = localCollapseProgress > 0
    ? localPlayerId
    : opponentCollapseProgress > 0
      ? opponentId
      : null;
  const collapseProgressMs = collapsingBaseId
    ? state.baseCollapseProgressMs[collapsingBaseId]
    : 0;
  const collapsePercent = Math.min(
    100,
    Math.max(0, collapseProgressMs / GAME_RULES.baseCollapseHoldMs * 100),
  );
  const collapseTrend = collapsingBaseId
    ? getCollapseTrend(state, collapsingBaseId)
    : null;
  const collapsePresentation = collapsingBaseId && collapseTrend
    ? getCollapsePresentation(
        collapsingBaseId === localPlayerId,
        collapseTrend,
        collapseProgressMs,
        collapsePercent,
      )
    : null;
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
          <span>You</span>
          <strong>{state.scores[localPlayerId].toFixed(1)}</strong>
          <small>{Math.round(scorableTerritory[localPlayerId] * 100)}% territory</small>
        </div>
        <div className="match-clock" data-phase={phase.kind}>
          <span className="match-clock__phase">{phase.label}</span>
          <strong>{formatTime(phase.clockMs)}</strong>
          <small>{phase.detail}</small>
          <small className="match-clock__status">
            {statusText}{latencyMs !== undefined && ` · ${latencyMs ?? "—"} ms`}
          </small>
        </div>
        <div className={`score-panel score-panel--${opponentId === "player" ? "cyan" : "coral"}`}>
          <span>{opponentName}</span>
          <strong>{state.scores[opponentId].toFixed(1)}</strong>
          <small>{Math.round(scorableTerritory[opponentId] * 100)}% territory</small>
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
        {collapsingBaseId && (
          <div
            className={`base-collapse-alert${collapsingBaseId === localPlayerId ? " base-collapse-alert--danger" : ""}`}
            data-progress={collapseTrend}
            aria-label={collapsePresentation?.label}
          >
            <div className="base-collapse-alert__label">
              <strong>{collapsePresentation?.label}</strong>
              <span>{collapsePresentation?.value}</span>
            </div>
            <div className="base-collapse-alert__meter">
              <span style={{ width: `${collapsePercent}%` }} />
            </div>
          </div>
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

type CollapseTrend = "capturing" | "defended" | "decaying";

function getCollapseTrend(
  state: GameState,
  defenderId: PlayerId,
): CollapseTrend {
  const attackerId: PlayerId = defenderId === "player" ? "rival" : "player";
  const base = state.players[defenderId].basePosition;
  const attackerInside = distance(
    state.players[attackerId].astronaut.position,
    base,
  ) <= GAME_RULES.baseCollapseRadius;
  const defenderInside = distance(
    state.players[defenderId].astronaut.position,
    base,
  ) <= GAME_RULES.baseCollapseRadius;

  if (attackerInside && !defenderInside) return "capturing";
  return defenderInside ? "defended" : "decaying";
}

function getCollapsePresentation(
  isLocalBase: boolean,
  trend: CollapseTrend,
  progressMs: number,
  progressPercent: number,
) {
  if (trend === "capturing") {
    return {
      label: isLocalBase
        ? "Base collapse · defend now"
        : "Rival base exposed · hold position",
      value: `${Math.ceil((GAME_RULES.baseCollapseHoldMs - progressMs) / 1_000)}s`,
    };
  }
  if (trend === "defended") {
    return {
      label: isLocalBase
        ? "Base recovering · hold the zone"
        : "Capture reversing · clear defender",
      value: `${Math.round(progressPercent)}%`,
    };
  }
  return {
    label: isLocalBase
      ? "Base stabilizing · attacker displaced"
      : "Capture fading · return to base",
    value: `${Math.round(progressPercent)}%`,
  };
}

function getPhasePresentation(state: GameState, localPlayerId: PlayerId): {
  kind: "setup" | "regulation" | "surge" | "overtime" | "finished";
  label: string;
  detail: string;
  clockMs: number;
} {
  if (state.matchPhase === "setup") {
    return {
      kind: "setup",
      label: "Setup",
      detail: "Expand now · scoring starts when setup ends",
      clockMs: Math.max(0, GAME_RULES.setupDurationMs - state.elapsedMs),
    };
  }
  if (state.matchPhase === "overtime") {
    const opponentId: PlayerId = localPlayerId === "player" ? "rival" : "player";
    return {
      kind: "overtime",
      label: "Overtime",
      detail: `OT race ${state.overtimeScores[localPlayerId].toFixed(1)}–${state.overtimeScores[opponentId].toFixed(1)} · first to +${GAME_RULES.overtimeLeadPoints}`,
      clockMs: state.remainingMs,
    };
  }
  if (
    state.matchPhase === "regulation" &&
    state.remainingMs <= GAME_RULES.scoreSurgeDurationMs
  ) {
    return {
      kind: "surge",
      label: "Signal Surge",
      detail: `${GAME_RULES.scoreSurgeMultiplier}× territory scoring`,
      clockMs: state.remainingMs,
    };
  }
  if (state.matchPhase === "finished") {
    return {
      kind: "finished",
      label: "Complete",
      detail: "Final signal locked",
      clockMs: 0,
    };
  }
  return {
    kind: "regulation",
    label: "Regulation",
    detail: "Uncontested territory builds signal",
    clockMs: state.remainingMs,
  };
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
