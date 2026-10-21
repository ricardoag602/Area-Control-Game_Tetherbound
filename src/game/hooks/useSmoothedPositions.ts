import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { WORLD } from "../constants";
import { clampToWorld } from "../geometry";
import {
  PRESENTATION_FRAME_PRIORITY,
  subscribePresentationFrame,
} from "../presentation/presentationClock";
import { PLAYER_IDS, type GameState, type MovementMode, type PlayerId, type Vec2 } from "../types";

const MIN_CORRECTION_MS = 80;
const MAX_CORRECTION_MS = 180;
const BURST_CORRECTION_MS = 32;
const SNAP_DISTANCE = 12;
const POSITION_EPSILON = 0.0001;
/** Predict at full authoritative velocity through an ordinary delayed poll. */
export const FULL_SPEED_EXTRAPOLATION_MS = 200;
/**
 * After the safe horizon, ease velocity to zero instead of hitting a visible
 * plateau on one frame. The bounded tail bridges a slow request without
 * allowing stale snapshots to drift indefinitely.
 */
export const MAX_EXTRAPOLATION_MS = 350;

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
  correctionOrigin: Vec2;
  correctionStartedAt: number;
  motion: MotionSnapshot;
  receivedAt: number;
  lastFrameAt: number;
  durationMs: number;
}

export type RenderPositions = Record<PlayerId, Vec2>;

export interface SmoothedPositions {
  /** Snapshot-cadence positions for React/SVG fallback rendering. */
  readonly positions: RenderPositions;
  /** Frame-cadence positions consumed by imperative renderers. */
  readonly positionsRef: RefObject<RenderPositions>;
}

export function useSmoothedPositions(
  state: GameState,
  enabled: boolean,
  publishFramesToReact = false,
): SmoothedPositions {
  const canonical = canonicalPositions(state);
  const tracks = useRef<Record<PlayerId, PositionTrack>>(
    Object.fromEntries(
      PLAYER_IDS.map((playerId) => [playerId, createTrack(state, playerId)]),
    ) as Record<PlayerId, PositionTrack>,
  );
  const positionsRef = useRef<RenderPositions>(canonical);
  const [published, setPublished] = useState<RenderPositions>(canonical);
  const [reduceMotion, setReduceMotion] = useState(prefersReducedMotion);
  const smoothingActive = useRef(enabled);
  const publishingFrames = useRef(publishFramesToReact);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReduceMotion(media.matches);
    updatePreference();
    media.addEventListener("change", updatePreference);
    return () => media.removeEventListener("change", updatePreference);
  }, []);

  useLayoutEffect(() => {
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
      const observedSnapshotInterval = track.receivedAt > 0
        ? Math.max(0, now - track.receivedAt)
        : MIN_CORRECTION_MS;

      track.motion = motionSnapshot(astronaut);
      track.receivedAt = now;
      track.lastFrameAt = now;
      track.correctionStartedAt = now;
      track.durationMs = reduceMotion
        ? 0
        : astronaut.movement.mode === "burst"
          ? BURST_CORRECTION_MS
          : clamp(
              observedSnapshotInterval,
              MIN_CORRECTION_MS,
              MAX_CORRECTION_MS,
            );

      if (shouldSnap) {
        track.displayed = { ...target };
        track.correctionOrigin = { x: 0, y: 0 };
        snapped = true;
      } else {
        // Spread reconciliation across roughly one observed snapshot interval.
        // A timeline curve avoids the old 80 ms exponential correction, which
        // removed most of the error on its first frame and caused a visible
        // pulse at every authoritative update.
        track.correctionOrigin = {
          x: track.displayed.x - target.x,
          y: track.displayed.y - target.y,
        };
      }
    }

    copyCurrentPositions(tracks.current, positionsRef.current);

    const smoothing = enabled;
    const resumedSmoothing = smoothing && !smoothingActive.current;
    const startedPublishingFrames = publishFramesToReact && !publishingFrames.current;
    smoothingActive.current = smoothing;
    publishingFrames.current = publishFramesToReact;
    if (shouldSyncReactPositions(
      publishFramesToReact,
      smoothing,
      snapped,
      resumedSmoothing,
      startedPublishingFrames,
    )) {
      markPublished(tracks.current);
      setPublished(currentPositions(tracks.current));
    } else if (!smoothing) {
      setPublished(canonical);
    }
    // Reconcile only when authoritative motion changes. Other player fields
    // such as oxygen and inventory must not reset the prediction horizon.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    publishFramesToReact,
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
    return subscribePresentationFrame(({ timeMs }) => {
      let changed = false;
      for (const playerId of PLAYER_IDS) {
        const track = tracks.current[playerId];
        advanceTrack(track, timeMs);
        if (distance(track.displayed, track.published) > POSITION_EPSILON) {
          changed = true;
        }
      }
      if (changed) {
        copyCurrentPositions(tracks.current, positionsRef.current);
        markPublished(tracks.current);
        if (publishFramesToReact) {
          setPublished(currentPositions(tracks.current));
        }
      }
    }, PRESENTATION_FRAME_PRIORITY.positions);
  }, [enabled, publishFramesToReact]);

  return {
    positions: enabled && publishFramesToReact ? published : canonical,
    positionsRef,
  };
}

/**
 * The imperative renderer advances the shared tracks even while the SVG
 * fallback is dormant. When that fallback is enabled later, publish the live
 * track once so React cannot revive an older position and then remain idle.
 */
export function shouldSyncReactPositions(
  publishFramesToReact: boolean,
  smoothing: boolean,
  snapped: boolean,
  resumedSmoothing: boolean,
  startedPublishingFrames: boolean,
) {
  return publishFramesToReact && smoothing &&
    (snapped || resumedSmoothing || startedPublishingFrames);
}

function createTrack(state: GameState, playerId: PlayerId): PositionTrack {
  const astronaut = state.players[playerId].astronaut;
  return {
    displayed: { ...astronaut.position },
    published: { ...astronaut.position },
    correctionOrigin: { x: 0, y: 0 },
    correctionStartedAt: 0,
    motion: motionSnapshot(astronaut),
    receivedAt: 0,
    lastFrameAt: 0,
    durationMs: MIN_CORRECTION_MS,
  };
}

function advanceTrack(track: PositionTrack, now: number) {
  if (track.lastFrameAt === 0) {
    track.receivedAt = now;
    track.lastFrameAt = now;
    return;
  }
  const safeNow = Math.max(track.lastFrameAt, now);
  track.displayed = sampleSmoothedPosition(
    track.motion,
    track.correctionOrigin,
    safeNow - track.receivedAt,
    safeNow - track.correctionStartedAt,
    track.durationMs,
  );
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

  const safeElapsedMs = Math.min(
    MAX_EXTRAPOLATION_MS,
    Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0),
  );
  const decayWindowMs = MAX_EXTRAPOLATION_MS - FULL_SPEED_EXTRAPOLATION_MS;
  const decayAgeMs = Math.max(0, safeElapsedMs - FULL_SPEED_EXTRAPOLATION_MS);
  // Integral of a linear velocity fade. Position and velocity are both
  // continuous at the safe horizon, and velocity reaches zero at the cap.
  const effectiveTravelMs = safeElapsedMs <= FULL_SPEED_EXTRAPOLATION_MS
    ? safeElapsedMs
    : FULL_SPEED_EXTRAPOLATION_MS + decayAgeMs -
      decayAgeMs * decayAgeMs / (2 * decayWindowMs);
  const seconds = effectiveTravelMs / 1_000;
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
  correctionAgeMs: number,
  correctionDurationMs = MIN_CORRECTION_MS,
): { position: Vec2; correction: Vec2 } {
  const position = sampleSmoothedPosition(
    motion,
    correction,
    predictionAgeMs,
    correctionAgeMs,
    correctionDurationMs,
  );
  const prediction = extrapolateMotionPosition(motion, predictionAgeMs);

  return {
    position,
    correction: {
      x: position.x - prediction.x,
      y: position.y - prediction.y,
    },
  };
}

/**
 * Samples a prediction plus an authoritative correction distributed across a
 * snapshot-aware timeline. The smoothstep curve begins and ends gently, so a
 * newly received snapshot cannot consume most of its correction in one frame.
 */
export function sampleSmoothedPosition(
  motion: MotionSnapshot,
  correctionOrigin: Vec2,
  predictionAgeMs: number,
  correctionAgeMs: number,
  correctionDurationMs = MIN_CORRECTION_MS,
): Vec2 {
  const prediction = extrapolateMotionPosition(motion, predictionAgeMs);
  const safeDuration = Math.max(0, correctionDurationMs);
  const progress = safeDuration === 0
    ? 1
    : clamp(
        Number.isFinite(correctionAgeMs) ? correctionAgeMs / safeDuration : 1,
        0,
        1,
      );
  const eased = progress * progress * (3 - 2 * progress);
  const retainedCorrection = 1 - eased;
  return clampToWorld({
    x: prediction.x + correctionOrigin.x * retainedCorrection,
    y: prediction.y + correctionOrigin.y * retainedCorrection,
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

function copyCurrentPositions(
  tracks: Record<PlayerId, PositionTrack>,
  positions: RenderPositions,
) {
  for (const playerId of PLAYER_IDS) {
    positions[playerId].x = tracks[playerId].displayed.x;
    positions[playerId].y = tracks[playerId].displayed.y;
  }
}

function markPublished(tracks: Record<PlayerId, PositionTrack>) {
  for (const playerId of PLAYER_IDS) {
    tracks[playerId].published.x = tracks[playerId].displayed.x;
    tracks[playerId].published.y = tracks[playerId].displayed.y;
  }
}

function distance(a: Vec2, b: Vec2) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
