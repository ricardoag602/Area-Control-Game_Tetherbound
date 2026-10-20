import { useEffect, useRef, useState } from "react";
import { WORLD } from "../constants";
import { clampToWorld } from "../geometry";
import { PLAYER_IDS, type GameState, type MovementMode, type PlayerId, type Vec2 } from "../types";

const CORRECTION_MS = 80;
const BURST_CORRECTION_MS = 32;
const SNAP_DISTANCE = 12;
/**
 * Keep prediction shorter than one ordinary network update. This is long
 * enough to bridge request latency without letting a stale snapshot drift far
 * from the authoritative simulation when a request is delayed.
 */
export const MAX_EXTRAPOLATION_MS = 200;

interface MotionSnapshot {
  position: Vec2;
  velocity: Vec2;
  mode: MovementMode;
  target: Vec2 | null;
  burstDistanceRemaining: number;
}

interface PositionTrack {
  displayed: Vec2;
  from: Vec2;
  motion: MotionSnapshot;
  receivedAt: number;
  startedAt: number;
  durationMs: number;
}

type RenderPositions = Record<PlayerId, Vec2>;

export function useSmoothedPositions(state: GameState, enabled: boolean): RenderPositions {
  const canonical = canonicalPositions(state);
  const tracks = useRef<Record<PlayerId, PositionTrack>>(
    Object.fromEntries(
      PLAYER_IDS.map((playerId) => [playerId, createTrack(state, playerId)]),
    ) as Record<PlayerId, PositionTrack>,
  );
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
      const correctionDistance = distance(track.displayed, target);
      const shouldSnap = !enabled || reduceMotion || correctionDistance > SNAP_DISTANCE;

      track.from = shouldSnap ? { ...target } : { ...track.displayed };
      track.motion = motionSnapshot(astronaut);
      track.receivedAt = now;
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
    // Restart only when authoritative motion changes. Other player fields such
    // as oxygen and inventory must not reset the prediction horizon.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    reduceMotion,
    state.players.player.astronaut.position.x,
    state.players.player.astronaut.position.y,
    state.players.player.astronaut.movement.mode,
    state.players.player.astronaut.movement.velocity.x,
    state.players.player.astronaut.movement.velocity.y,
    state.players.player.astronaut.movement.target?.x,
    state.players.player.astronaut.movement.target?.y,
    state.players.player.astronaut.movement.burstDistanceRemaining,
    state.players.rival.astronaut.position.x,
    state.players.rival.astronaut.position.y,
    state.players.rival.astronaut.movement.mode,
    state.players.rival.astronaut.movement.velocity.x,
    state.players.rival.astronaut.movement.velocity.y,
    state.players.rival.astronaut.movement.target?.x,
    state.players.rival.astronaut.movement.target?.y,
    state.players.rival.astronaut.movement.burstDistanceRemaining,
    state.players.player3.astronaut.position.x,
    state.players.player3.astronaut.position.y,
    state.players.player3.astronaut.movement.mode,
    state.players.player3.astronaut.movement.velocity.x,
    state.players.player3.astronaut.movement.velocity.y,
    state.players.player3.astronaut.movement.target?.x,
    state.players.player3.astronaut.movement.target?.y,
    state.players.player3.astronaut.movement.burstDistanceRemaining,
    state.players.player4.astronaut.position.x,
    state.players.player4.astronaut.position.y,
    state.players.player4.astronaut.movement.mode,
    state.players.player4.astronaut.movement.velocity.x,
    state.players.player4.astronaut.movement.velocity.y,
    state.players.player4.astronaut.movement.target?.x,
    state.players.player4.astronaut.movement.target?.y,
    state.players.player4.astronaut.movement.burstDistanceRemaining,
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
        const predictionAge = Math.max(0, now - track.receivedAt);
        const target = extrapolateMotionPosition(track.motion, predictionAge);
        const next = interpolate(track.from, target, eased);
        if (distance(next, track.displayed) > 0.0001) changed = true;
        const stillPredicting = predictionAge < MAX_EXTRAPOLATION_MS &&
          shouldExtrapolate(track.motion);
        if (
          stillPredicting ||
          (progress < 1 && distance(next, target) > 0.0001)
        ) unsettled = true;
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
    state.players.player.astronaut.movement.velocity.x,
    state.players.player.astronaut.movement.velocity.y,
    state.players.player.astronaut.movement.target?.x,
    state.players.player.astronaut.movement.target?.y,
    state.players.player.astronaut.movement.burstDistanceRemaining,
    state.players.rival.astronaut.position.x,
    state.players.rival.astronaut.position.y,
    state.players.rival.astronaut.movement.mode,
    state.players.rival.astronaut.movement.velocity.x,
    state.players.rival.astronaut.movement.velocity.y,
    state.players.rival.astronaut.movement.target?.x,
    state.players.rival.astronaut.movement.target?.y,
    state.players.rival.astronaut.movement.burstDistanceRemaining,
    state.players.player3.astronaut.position.x,
    state.players.player3.astronaut.position.y,
    state.players.player3.astronaut.movement.mode,
    state.players.player3.astronaut.movement.velocity.x,
    state.players.player3.astronaut.movement.velocity.y,
    state.players.player3.astronaut.movement.target?.x,
    state.players.player3.astronaut.movement.target?.y,
    state.players.player3.astronaut.movement.burstDistanceRemaining,
    state.players.player4.astronaut.position.x,
    state.players.player4.astronaut.position.y,
    state.players.player4.astronaut.movement.mode,
    state.players.player4.astronaut.movement.velocity.x,
    state.players.player4.astronaut.movement.velocity.y,
    state.players.player4.astronaut.movement.target?.x,
    state.players.player4.astronaut.movement.target?.y,
    state.players.player4.astronaut.movement.burstDistanceRemaining,
  ]);

  return enabled && !reduceMotion ? rendered : canonical;
}

function createTrack(state: GameState, playerId: PlayerId): PositionTrack {
  const astronaut = state.players[playerId].astronaut;
  return {
    displayed: { ...astronaut.position },
    from: { ...astronaut.position },
    motion: motionSnapshot(astronaut),
    receivedAt: 0,
    startedAt: 0,
    durationMs: CORRECTION_MS,
  };
}

function motionSnapshot(
  astronaut: GameState["players"][PlayerId]["astronaut"],
): MotionSnapshot {
  return {
    position: { ...astronaut.position },
    velocity: { ...astronaut.movement.velocity },
    mode: astronaut.movement.mode,
    target: astronaut.movement.target
      ? { ...astronaut.movement.target }
      : null,
    burstDistanceRemaining: astronaut.movement.burstDistanceRemaining,
  };
}

/**
 * Cosmetic dead reckoning only. Authoritative state still owns collisions,
 * pickups, scoring, oxygen, and the next reconciliation point.
 */
export function extrapolateMotionPosition(
  motion: MotionSnapshot,
  elapsedMs: number,
): Vec2 {
  if (!shouldExtrapolate(motion)) return { ...motion.position };

  const seconds = Math.min(
    MAX_EXTRAPOLATION_MS,
    Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0),
  ) / 1_000;
  const speed = Math.hypot(motion.velocity.x, motion.velocity.y);
  let travelDistance = speed * seconds;

  if (motion.mode === "burst") {
    travelDistance = Math.min(
      travelDistance,
      Math.max(0, motion.burstDistanceRemaining),
    );
  }

  if (motion.target) {
    const targetOffset = {
      x: motion.target.x - motion.position.x,
      y: motion.target.y - motion.position.y,
    };
    const targetDistance = Math.hypot(targetOffset.x, targetOffset.y);
    const movingTowardTarget =
      motion.velocity.x * targetOffset.x + motion.velocity.y * targetOffset.y > 0;
    if (movingTowardTarget && travelDistance >= targetDistance) {
      return clampToWorld(motion.target, WORLD.width, WORLD.height);
    }
  }

  return clampToWorld({
    x: motion.position.x + motion.velocity.x / speed * travelDistance,
    y: motion.position.y + motion.velocity.y / speed * travelDistance,
  }, WORLD.width, WORLD.height);
}

function shouldExtrapolate(motion: MotionSnapshot) {
  return motion.mode !== "idle" &&
    Math.hypot(motion.velocity.x, motion.velocity.y) > 0.0001;
}

function canonicalPositions(state: GameState): RenderPositions {
  return Object.fromEntries(PLAYER_IDS.map((playerId) => [
    playerId,
    { ...state.players[playerId].astronaut.position },
  ])) as RenderPositions;
}

function currentPositions(tracks: Record<PlayerId, PositionTrack>): RenderPositions {
  return Object.fromEntries(PLAYER_IDS.map((playerId) => [
    playerId,
    { ...tracks[playerId].displayed },
  ])) as RenderPositions;
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
