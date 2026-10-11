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
  // Allows charge zoom-out, spring overshoot, and low-oxygen zoom to combine.
  minimumSpringZoom: 0.84,
  maximumSpringZoom: 1.16,
  springAngularFrequency: 16,
  springDampingRatio: 0.78,
  maximumSpringDeltaSeconds: 1 / 30,
  springSettleDistance: 0.0001,
  springSettleVelocity: 0.0005,
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
 * Frames the camera around the supplied point without clamping it to the map.
 * The resulting overscan keeps the controlled astronaut screen-locked even at
 * an edge. Very wide viewports are fitted to the world's width first so they do
 * not unintentionally reveal more than the entire horizontal playfield.
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

  const width = baseWidth / safeZoom;
  const height = baseHeight / safeZoom;
  return {
    x: safeCenter.x - width / 2,
    y: safeCenter.y - height / 2,
    width,
    height,
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

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
