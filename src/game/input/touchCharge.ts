import { MOVEMENT_RULES } from "../movement/movement";
import type { TankInput, Vec2 } from "../types";

/** Prevents tiny finger motion from making charge steering chatter left/right. */
export const CHARGE_STEERING_DEAD_ZONE_RADIANS = Math.PI / 18;

export interface TouchBoostTap {
  pointerType: string;
  pressedAt: number;
  releasedAt: number;
  position: Vec2;
}

/** Touch and pen use screen-wide charge aiming; mouse keeps its own gesture. */
export function usesDirectTouchCharge(pointerType: string) {
  return pointerType === "touch" || pointerType === "pen";
}

/** A long press is movement only and can never become the first boost tap. */
export function isTouchBoostTap(
  pressedAt: number,
  releasedAt: number,
  origin: Vec2,
  releasedPosition: Vec2,
) {
  if (
    !Number.isFinite(pressedAt) ||
    !Number.isFinite(releasedAt) ||
    !isFinitePoint(origin) ||
    !isFinitePoint(releasedPosition)
  ) return false;
  const heldFor = releasedAt - pressedAt;
  return heldFor >= 0 &&
    heldFor <= MOVEMENT_RULES.touchBoostTapMaximumMs &&
    pointDistance(origin, releasedPosition) <= MOVEMENT_RULES.touchGestureSlopPx;
}

/**
 * The second press must begin near the first tap and inside one total window
 * measured from the first pointer-down. Holding the first touch cannot extend
 * this window.
 */
export function isTouchBoostDoubleTap(
  previousTap: TouchBoostTap | null,
  pointerType: string,
  position: Vec2,
  pressedAt: number,
) {
  if (
    !usesDirectTouchCharge(pointerType) ||
    !previousTap ||
    previousTap.pointerType !== pointerType ||
    !isTouchBoostTap(
      previousTap.pressedAt,
      previousTap.releasedAt,
      previousTap.position,
      previousTap.position,
    ) ||
    !isFinitePoint(previousTap.position) ||
    !isFinitePoint(position) ||
    !Number.isFinite(pressedAt)
  ) return false;
  const pauseBeforeSecondPress = pressedAt - previousTap.releasedAt;
  const elapsedSinceFirstPress = pressedAt - previousTap.pressedAt;
  return pauseBeforeSecondPress >= 0 &&
    elapsedSinceFirstPress >= 0 &&
    elapsedSinceFirstPress <= MOVEMENT_RULES.touchBoostDoubleTapMs &&
    pointDistance(previousTap.position, position) <=
      MOVEMENT_RULES.touchBoostDoubleTapDistancePx;
}

/**
 * Creates a stable aim target along the astronaut-to-finger vector. Keeping a
 * fixed target distance makes only direction authoritative and safely handles
 * touches directly over the astronaut or briefly invalid browser coordinates.
 */
export function getDirectTouchChargeTarget(
  astronautPosition: Vec2,
  touchPosition: Vec2,
  fallbackDirection: Vec2,
  targetDistance: number,
): Vec2 {
  const direction = normalize(
    {
      x: touchPosition.x - astronautPosition.x,
      y: touchPosition.y - astronautPosition.y,
    },
    fallbackDirection,
  );
  const distance = Number.isFinite(targetDistance) && targetDistance > 0
    ? targetDistance
    : 1;
  return {
    x: astronautPosition.x + direction.x * distance,
    y: astronautPosition.y + direction.y * distance,
  };
}

/**
 * Converts the screen-wide touch vector into the same tank-charge input used
 * by desktop. The touch chooses which way to turn; authoritative charge physics
 * still removes movement and turning authority as the charge reaches full.
 */
export function getScreenTouchChargeInput(
  facing: Vec2,
  astronautPosition: Vec2,
  touchPosition: Vec2,
  fallbackDirection: Vec2,
): TankInput {
  const target = getDirectTouchChargeTarget(
    astronautPosition,
    touchPosition,
    fallbackDirection,
    1,
  );
  return getTankChargeInput(
    facing,
    {
      x: target.x - astronautPosition.x,
      y: target.y - astronautPosition.y,
    },
    true,
  );
}

/**
 * Converts a touch aim into the same digital steering input used by desktop.
 * Touch never writes a launch heading directly; the authoritative tank-charge
 * simulation decides how much of this requested turn remains possible.
 */
export function getTankChargeInput(
  facing: Vec2,
  aimDirection: Vec2,
  hasAim: boolean,
): TankInput {
  if (!hasAim) return { throttle: 1, steering: 0 };

  const normalizedFacing = normalize(facing, { x: 0, y: -1 });
  const normalizedAim = normalize(aimDirection, normalizedFacing);
  const signedAngle = Math.atan2(
    normalizedFacing.x * normalizedAim.y -
      normalizedFacing.y * normalizedAim.x,
    normalizedFacing.x * normalizedAim.x +
      normalizedFacing.y * normalizedAim.y,
  );
  const steering = Math.abs(signedAngle) <=
      CHARGE_STEERING_DEAD_ZONE_RADIANS
    ? 0
    : signedAngle > 0
      ? 1
      : -1;

  return { throttle: 1, steering };
}

function normalize(value: Vec2, fallback: Vec2): Vec2 {
  const length = Number.isFinite(value.x) && Number.isFinite(value.y)
    ? Math.hypot(value.x, value.y)
    : 0;
  if (length > 0.000001) {
    return { x: value.x / length, y: value.y / length };
  }

  const fallbackLength = Number.isFinite(fallback.x) && Number.isFinite(fallback.y)
    ? Math.hypot(fallback.x, fallback.y)
    : 0;
  return fallbackLength > 0.000001
    ? { x: fallback.x / fallbackLength, y: fallback.y / fallbackLength }
    : { x: 0, y: -1 };
}

function isFinitePoint(point: Vec2) {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function pointDistance(a: Vec2, b: Vec2) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
