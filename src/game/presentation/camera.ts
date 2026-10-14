import { WORLD } from "../constants";
import type { Vec2 } from "../types";

/**
 * Presentation-only camera tuning. Keeping this separate from movement rules
 * lets each client frame its own astronaut without affecting simulation state.
 */
export const CAMERA_RULES = {
  // Keep more nearby terrain and network decisions visible during normal play.
  baseVisibleHeight: 96,
  // Charging opens the frame further so the player can read the launch route.
  maximumChargeZoomOut: 0.14,
  chargeZoomDecayRate: 4,
  // A wide browser can turn otherwise unused side gutters into a small view bonus.
  maximumViewportBufferZoomOut: 0.06,
  // Allows charge zoom-out, the desktop view bonus, and low-oxygen zoom to combine.
  minimumSpringZoom: 0.8,
  maximumSpringZoom: 1.16,
  springAngularFrequency: 16,
  springDampingRatio: 0.78,
  maximumSpringDeltaSeconds: 1 / 30,
  springSettleDistance: 0.0001,
  springSettleVelocity: 0.0005,
  matchEndOverviewDurationMs: 850,
} as const;

export interface CameraViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CameraZoomSpring {
  zoom: number;
  velocity: number;
}

/**
 * Produces a quick initial zoom-out that gradually tapers as the charge fills.
 * Normalizing the exponential curve keeps its endpoints exactly at 0 and 1.
 */
export function chargeZoomTarget(chargeProgress: number) {
  const progress = clamp(finiteOr(chargeProgress, 0), 0, 1);
  const decay = CAMERA_RULES.chargeZoomDecayRate;
  const eased = (1 - Math.exp(-decay * progress)) /
    (1 - Math.exp(-decay));
  return 1 - CAMERA_RULES.maximumChargeZoomOut * eased;
}

/**
 * Converts unused horizontal browser space into a subtle camera advantage.
 * The bonus grows with the combined side gutters and caps once those gutters
 * equal the arena width, keeping ultrawide screens from revealing too much.
 */
export function calculateViewportBufferZoom(
  viewportWidth: number,
  arenaWidth: number,
) {
  const safeArenaWidth = finitePositiveOr(arenaWidth, 0);
  const safeViewportWidth = finitePositiveOr(viewportWidth, safeArenaWidth);
  if (safeArenaWidth === 0 || safeViewportWidth <= safeArenaWidth) return 1;

  const bufferRatio = clamp(
    (safeViewportWidth - safeArenaWidth) / safeArenaWidth,
    0,
    1,
  );
  return 1 - CAMERA_RULES.maximumViewportBufferZoomOut * bufferRatio;
}

/**
 * Frames the camera around the supplied point while keeping the complete view
 * inside the map. At an arena edge the camera stops and the controlled
 * astronaut moves toward the corresponding screen edge instead of revealing
 * empty space beyond the terrain.
 */
export function calculateCameraViewBox(
  center: Vec2,
  aspectRatio: number,
  zoom: number,
): CameraViewBox {
  const safeAspect = sanitizeAspectRatio(aspectRatio);
  const safeCenter = {
    x: finiteOr(center.x, WORLD.width / 2),
    y: finiteOr(center.y, WORLD.height / 2),
  };
  const safeZoom = clamp(
    finiteOr(zoom, 1),
    CAMERA_RULES.minimumSpringZoom,
    CAMERA_RULES.maximumSpringZoom,
  );

  let baseHeight = Math.min(CAMERA_RULES.baseVisibleHeight, WORLD.height);
  let baseWidth = baseHeight * safeAspect;
  if (baseWidth > WORLD.width) {
    baseWidth = WORLD.width;
    baseHeight = baseWidth / safeAspect;
  }

  const rawWidth = baseWidth / safeZoom;
  const rawHeight = baseHeight / safeZoom;
  const worldFit = Math.min(
    1,
    WORLD.width / rawWidth,
    WORLD.height / rawHeight,
  );
  const width = rawWidth * worldFit;
  const height = rawHeight * worldFit;
  return {
    x: clamp(safeCenter.x - width / 2, 0, WORLD.width - width),
    y: clamp(safeCenter.y - height / 2, 0, WORLD.height - height),
    width,
    height,
  };
}

/** Fits the complete arena around its fixed center without cropping an edge. */
export function calculateOverviewViewBox(aspectRatio: number): CameraViewBox {
  const safeAspect = sanitizeAspectRatio(aspectRatio);
  const worldAspect = WORLD.width / WORLD.height;
  const padding = 1.04;
  let width: number;
  let height: number;

  if (safeAspect >= worldAspect) {
    height = WORLD.height * padding;
    width = height * safeAspect;
  } else {
    width = WORLD.width * padding;
    height = width / safeAspect;
  }

  return {
    x: WORLD.width / 2 - width / 2,
    y: WORLD.height / 2 - height / 2,
    width,
    height,
  };
}

/** Front-loads the pullback, then eases gently into the fixed overview. */
export function easeMatchEndOverview(progress: number) {
  const clamped = clamp(finiteOr(progress, 0), 0, 1);
  return 1 - Math.pow(1 - clamped, 4);
}

export function interpolateCameraViewBox(
  from: CameraViewBox,
  to: CameraViewBox,
  amount: number,
): CameraViewBox {
  const progress = clamp(finiteOr(amount, 0), 0, 1);
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
    width: from.width + (to.width - from.width) * progress,
    height: from.height + (to.height - from.height) * progress,
  };
}

/**
 * Advances a bounded damped spring using a semi-implicit Euler step. Long or
 * delayed frames are intentionally capped so returning from a background tab
 * cannot fling the camera through its target.
 */
export function stepCameraZoomSpring(
  spring: CameraZoomSpring,
  targetZoom: number,
  deltaSeconds: number,
): CameraZoomSpring {
  const zoom = clamp(
    finiteOr(spring.zoom, 1),
    CAMERA_RULES.minimumSpringZoom,
    CAMERA_RULES.maximumSpringZoom,
  );
  const velocity = finiteOr(spring.velocity, 0);
  const target = clamp(
    finiteOr(targetZoom, 1),
    CAMERA_RULES.minimumSpringZoom,
    CAMERA_RULES.maximumSpringZoom,
  );
  const seconds = clamp(
    finiteOr(deltaSeconds, 0),
    0,
    CAMERA_RULES.maximumSpringDeltaSeconds,
  );

  if (seconds === 0) return { zoom, velocity };

  const frequency = CAMERA_RULES.springAngularFrequency;
  const damping = CAMERA_RULES.springDampingRatio;
  const acceleration = frequency * frequency * (target - zoom) -
    2 * damping * frequency * velocity;
  let nextVelocity = velocity + acceleration * seconds;
  const unboundedZoom = zoom + nextVelocity * seconds;
  const nextZoom = clamp(
    unboundedZoom,
    CAMERA_RULES.minimumSpringZoom,
    CAMERA_RULES.maximumSpringZoom,
  );

  if (nextZoom !== unboundedZoom) nextVelocity = 0;
  if (
    Math.abs(target - nextZoom) <= CAMERA_RULES.springSettleDistance &&
    Math.abs(nextVelocity) <= CAMERA_RULES.springSettleVelocity
  ) {
    return { zoom: target, velocity: 0 };
  }

  return { zoom: nextZoom, velocity: nextVelocity };
}

function sanitizeAspectRatio(aspectRatio: number) {
  return Number.isFinite(aspectRatio) && aspectRatio > 0
    ? aspectRatio
    : WORLD.width / WORLD.height;
}

function finiteOr(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function finitePositiveOr(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
