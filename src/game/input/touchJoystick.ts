import type { Vec2 } from "../types";

/** The floating control is intentionally large enough for a relaxed thumb drag. */
export const TOUCH_JOYSTICK_RADIUS_PX = 60;
export const TOUCH_JOYSTICK_THUMB_RADIUS_PX = 21;
export const TOUCH_JOYSTICK_DEAD_ZONE_PX = 10;

/**
 * Converts a screen-space drag into the direction consumed by walk_direction.
 * A small dead zone lets a tap (including the first boost tap) stay neutral.
 */
export function getTouchJoystickDirection(
  origin: Vec2,
  current: Vec2,
  deadZone = TOUCH_JOYSTICK_DEAD_ZONE_PX,
): Vec2 | null {
  const delta = joystickDelta(origin, current);
  if (!delta) return null;
  const length = Math.hypot(delta.x, delta.y);
  const safeDeadZone = Number.isFinite(deadZone) ? Math.max(0, deadZone) : 0;
  if (length <= safeDeadZone) return null;
  return { x: delta.x / length, y: delta.y / length };
}

/** Keeps the thumb inside the translucent outer ring while preserving direction. */
export function getTouchJoystickThumbOffset(
  origin: Vec2,
  current: Vec2,
  radius = TOUCH_JOYSTICK_RADIUS_PX,
  thumbRadius = TOUCH_JOYSTICK_THUMB_RADIUS_PX,
): Vec2 {
  const delta = joystickDelta(origin, current);
  if (!delta) return { x: 0, y: 0 };

  const maximumTravel = Math.max(0, finiteOr(radius, 0) - finiteOr(thumbRadius, 0));
  const length = Math.hypot(delta.x, delta.y);
  if (length <= maximumTravel || length <= Number.EPSILON) return delta;
  const scale = maximumTravel / length;
  return { x: delta.x * scale, y: delta.y * scale };
}

function joystickDelta(origin: Vec2, current: Vec2): Vec2 | null {
  if (!isFinitePoint(origin) || !isFinitePoint(current)) return null;
  return { x: current.x - origin.x, y: current.y - origin.y };
}

function isFinitePoint(point: Vec2) {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function finiteOr(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}
