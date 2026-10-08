import { useEffect, useRef, useState } from "react";
import type { GameState, MovementMode, PlayerId, Vec2 } from "../types";

const PLAYER_IDS: PlayerId[] = ["player", "rival"];
const CORRECTION_MS = 80;
const BURST_CORRECTION_MS = 32;
const SNAP_DISTANCE = 12;

interface PositionTrack {
  displayed: Vec2;
  from: Vec2;
  target: Vec2;
  startedAt: number;
  durationMs: number;
  mode: MovementMode;
}

type RenderPositions = Record<PlayerId, Vec2>;

export function useSmoothedPositions(state: GameState, enabled: boolean): RenderPositions {
  const canonical = canonicalPositions(state);
  const tracks = useRef<Record<PlayerId, PositionTrack>>({
    player: createTrack(state, "player"),
    rival: createTrack(state, "rival"),
  });
  const [rendered, setRendered] = useState<RenderPositions>(canonical);
  const [reduceMotion, setReduceMotion] = useState(prefersReducedMotion);
  const smoothingActive = useRef(enabled && !reduceMotion);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReduceMotion(media.matches);
    updatePreference();
    media.addEventListener("change", updatePreference);
    return () => media.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    const now = performance.now();
    let snapped = false;

    for (const playerId of PLAYER_IDS) {
      const track = tracks.current[playerId];
      const astronaut = state.players[playerId].astronaut;
      const target = astronaut.position;
      const modeChanged = astronaut.movement.mode !== track.mode;
      const burstTransition = modeChanged &&
        (astronaut.movement.mode === "burst" || track.mode === "burst");
      const correctionDistance = distance(track.displayed, target);
      const shouldSnap = !enabled || reduceMotion || burstTransition || correctionDistance > SNAP_DISTANCE;

      track.mode = astronaut.movement.mode;
      track.from = shouldSnap ? { ...target } : { ...track.displayed };
      track.target = { ...target };
      track.startedAt = now;
      track.durationMs = astronaut.movement.mode === "burst"
        ? BURST_CORRECTION_MS
        : CORRECTION_MS;

      if (shouldSnap) {
        track.displayed = { ...target };
        snapped = true;
      }
    }

    const smoothing = enabled && !reduceMotion;
    const resumedSmoothing = smoothing && !smoothingActive.current;
    smoothingActive.current = smoothing;
    if (smoothing && (snapped || resumedSmoothing)) {
      setRendered(currentPositions(tracks.current));
    }
  }, [
    enabled,
    reduceMotion,
    state.players.player.astronaut.position.x,
    state.players.player.astronaut.position.y,
    state.players.player.astronaut.movement.mode,
    state.players.rival.astronaut.position.x,
    state.players.rival.astronaut.position.y,
    state.players.rival.astronaut.movement.mode,
  ]);

  useEffect(() => {
    if (!enabled || reduceMotion) return;
    let frameId = 0;

    const update = (now: number) => {
      let changed = false;
      let unsettled = false;
      for (const playerId of PLAYER_IDS) {
        const track = tracks.current[playerId];
        const elapsed = now - track.startedAt;
        const progress = Math.min(1, Math.max(0, elapsed / track.durationMs));
        const eased = 1 - Math.pow(1 - progress, 3);
        const next = interpolate(track.from, track.target, eased);
        if (distance(next, track.displayed) > 0.0001) changed = true;
        if (progress < 1 && distance(next, track.target) > 0.0001) unsettled = true;
        track.displayed = next;
      }
      if (changed) setRendered(currentPositions(tracks.current));
      if (unsettled) frameId = requestAnimationFrame(update);
    };

    frameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameId);
  }, [
    enabled,
    reduceMotion,
    state.players.player.astronaut.position.x,
    state.players.player.astronaut.position.y,
    state.players.player.astronaut.movement.mode,
    state.players.rival.astronaut.position.x,
    state.players.rival.astronaut.position.y,
    state.players.rival.astronaut.movement.mode,
  ]);

  return enabled && !reduceMotion ? rendered : canonical;
}

function createTrack(state: GameState, playerId: PlayerId): PositionTrack {
  const astronaut = state.players[playerId].astronaut;
  return {
    displayed: { ...astronaut.position },
    from: { ...astronaut.position },
    target: { ...astronaut.position },
    startedAt: 0,
    durationMs: CORRECTION_MS,
    mode: astronaut.movement.mode,
  };
}

function canonicalPositions(state: GameState): RenderPositions {
  return {
    player: { ...state.players.player.astronaut.position },
    rival: { ...state.players.rival.astronaut.position },
  };
}

function currentPositions(tracks: Record<PlayerId, PositionTrack>): RenderPositions {
  return {
    player: { ...tracks.player.displayed },
    rival: { ...tracks.rival.displayed },
  };
}

function interpolate(from: Vec2, to: Vec2, amount: number): Vec2 {
  return {
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
  };
}

function distance(a: Vec2, b: Vec2) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
