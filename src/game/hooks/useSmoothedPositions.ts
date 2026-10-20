import { useEffect, useRef, useState } from "react";
import { WORLD } from "../constants";
import { clampToWorld } from "../geometry";
import { PLAYER_IDS, type GameState, type MovementMode, type PlayerId, type Vec2 } from "../types";

const CORRECTION_MS = 80;
const BURST_CORRECTION_MS = 32;
const SNAP_DISTANCE = 12;
const CORRECTION_DECAY_AT_DURATION = 0.01;
const POSITION_EPSILON = 0.0001;
/**
 * Keep prediction shorter than one ordinary network update. This is long
 * enough to bridge request latency without letting a stale snapshot drift far
 * from the authoritative simulation when a request is delayed.
 */
export const MAX_EXTRAPOLATION_MS = 200;

export interface MotionSnapshot {
  position: Vec2;
  velocity: Vec2;
  mode: MovementMode;
  target: Vec2 | null;
  burstDistanceRemaining: number;
}

interface PositionTrack {
  displayed: Vec2;
  published: Vec2;
  correction: Vec2;
  motion: MotionSnapshot;
  receivedAt: number;
  lastFrameAt: number;
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
  const smoothingActive = useRef(enabled);

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
      // Bring the old prediction right up to the snapshot timestamp before
      // switching motion sources. This preserves continuous velocity when a
      // 20 Hz authoritative snapshot lands between higher-refresh frames.
      advanceTrack(track, now);
      const astronaut = state.players[playerId].astronaut;
      const target = astronaut.position;
      const correctionDistance = distance(track.displayed, target);
      const shouldSnap = !enabled || correctionDistance > SNAP_DISTANCE;

      track.motion = motionSnapshot(astronaut);
      track.receivedAt = now;
      track.lastFrameAt = now;
      track.durationMs = reduceMotion
        ? 0
        : astronaut.movement.mode === "burst"
          ? BURST_CORRECTION_MS
          : CORRECTION_MS;

      if (shouldSnap) {
        track.displayed = { ...target };
        track.correction = { x: 0, y: 0 };
        snapped = true;
      } else {
        // Store reconciliation as an offset rather than restarting an easing
        // curve. Prediction can keep moving at its current velocity while the
        // authoritative error decays smoothly over real elapsed time.
        track.correction = {
          x: track.displayed.x - target.x,
          y: track.displayed.y - target.y,
        };
      }
    }

    const smoothing = enabled;
    const resumedSmoothing = smoothing && !smoothingActive.current;
    smoothingActive.current = smoothing;
    if (smoothing && (snapped || resumedSmoothing)) {
      markPublished(tracks.current);
      setRendered(currentPositions(tracks.current));
    }
    // Reconcile only when authoritative motion changes. Other player fields
    // such as oxygen and inventory must not reset the prediction horizon.
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
    if (!enabled) return;
    let frameId = 0;

    const update = (now: number) => {
      let changed = false;
      for (const playerId of PLAYER_IDS) {
        const track = tracks.current[playerId];
        advanceTrack(track, now);
        if (distance(track.displayed, track.published) > POSITION_EPSILON) {
          changed = true;
        }
      }
      if (changed) {
        markPublished(tracks.current);
        setRendered(currentPositions(tracks.current));
      }
      // Keep one render clock alive while smoothing is enabled. Authoritative
      // snapshots only update refs, so they never cancel and restart this loop.
      frameId = requestAnimationFrame(update);
    };

    frameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameId);
  }, [enabled]);

  return enabled ? rendered : canonical;
}

function createTrack(state: GameState, playerId: PlayerId): PositionTrack {
  const astronaut = state.players[playerId].astronaut;
  return {
    displayed: { ...astronaut.position },
    published: { ...astronaut.position },
    correction: { x: 0, y: 0 },
    motion: motionSnapshot(astronaut),
    receivedAt: 0,
    lastFrameAt: 0,
    durationMs: CORRECTION_MS,
  };
}

function advanceTrack(track: PositionTrack, now: number) {
  if (track.lastFrameAt === 0) {
    track.receivedAt = now;
    track.lastFrameAt = now;
    return;
  }
  const safeNow = Math.max(track.lastFrameAt, now);
  const frameDeltaMs = track.lastFrameAt > 0
    ? safeNow - track.lastFrameAt
    : 0;
  const next = advanceSmoothedPosition(
    track.motion,
    track.correction,
    safeNow - track.receivedAt,
    frameDeltaMs,
    track.durationMs,
  );
  track.displayed = next.position;
  track.correction = next.correction;
  track.lastFrameAt = safeNow;
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

/**
 * Advance a cosmetic motion track without tying its correction curve to the
 * authoritative snapshot cadence. Prediction follows the latest velocity,
 * while reconciliation decays according to real frame time. Keeping this
 * helper pure also makes cadence behavior deterministic to test.
 */
export function advanceSmoothedPosition(
  motion: MotionSnapshot,
  correction: Vec2,
  predictionAgeMs: number,
  frameDeltaMs: number,
  correctionDurationMs = CORRECTION_MS,
): { position: Vec2; correction: Vec2 } {
  const prediction = extrapolateMotionPosition(motion, predictionAgeMs);
  const safeFrameDelta = Math.max(
    0,
    Number.isFinite(frameDeltaMs) ? frameDeltaMs : 0,
  );
  const safeDuration = Math.max(0, correctionDurationMs);
  const decay = safeDuration === 0
    ? 0
    : Math.pow(CORRECTION_DECAY_AT_DURATION, safeFrameDelta / safeDuration);
  const decayedCorrection = {
    x: correction.x * decay,
    y: correction.y * decay,
  };
  const position = clampToWorld({
    x: prediction.x + decayedCorrection.x,
    y: prediction.y + decayedCorrection.y,
  }, WORLD.width, WORLD.height);

  return {
    position,
    // Account for a world-edge clamp so the next frame remains continuous.
    correction: {
      x: position.x - prediction.x,
      y: position.y - prediction.y,
    },
  };
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

function markPublished(tracks: Record<PlayerId, PositionTrack>) {
  for (const playerId of PLAYER_IDS) {
    tracks[playerId].published = { ...tracks[playerId].displayed };
  }
}

function distance(a: Vec2, b: Vec2) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
