import type { TankInput, Vec2 } from "../types";

/** Prevents tiny finger motion from making charge steering chatter left/right. */
export const TOUCH_CHARGE_STEERING_DEAD_ZONE_RADIANS = Math.PI / 18;

/**
 * Converts a touch aim into the same digital steering input used by desktop.
 * Touch never writes a launch heading directly; the authoritative tank-charge
 * simulation decides how much of this requested turn remains possible.
 */
export function getTouchChargeInput(
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
      TOUCH_CHARGE_STEERING_DEAD_ZONE_RADIANS
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
