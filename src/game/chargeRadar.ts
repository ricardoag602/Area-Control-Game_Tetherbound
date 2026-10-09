import { SIMULATION_RULES, WORLD } from "./constants";
import {
  MOVEMENT_RULES,
  getBurstDistance,
  stepChargingTurn,
} from "./movement";
import type { MovementState, TankAxis, Vec2 } from "./types";

export const CHARGE_RADAR_RULES = {
  innerRadius: 4.25,
  minimumOuterRadius: 6.25,
  maximumOuterRadius: 8.5,
  maximumHalfAngleRadians: Math.PI / 2,
  minimumVisibleSpanRadians: Math.PI / 60,
  angularSettleEpsilon: 0.0001,
  maximumPredictionSteps: 64,
} as const;

export interface ChargeRadar {
  travelDirection: Vec2;
  burstDistance: number;
  powerRatio: number;
  canRelease: boolean;
  innerRadius: number;
  outerRadius: number;
  minimumTurnRadians: number;
  maximumTurnRadians: number;
}

/**
 * Predicts the launch power and the remaining left/right steering envelope
 * from the same authoritative rules that advance a tank charge. The envelope
 * is limited to the requested forward semicircle; release-now is always
 * included, so the fan never claims that the player must keep turning.
 */
export function calculateChargeRadar(
  movement: MovementState,
  turnRateMultiplier = 1,
): ChargeRadar {
  const travelDirection = normalize(movement.direction, movement.facing);
  const burstDistance = getBurstDistance(movement.chargeSeconds);
  const burstRange = MOVEMENT_RULES.maximumBurstDistance -
    MOVEMENT_RULES.minimumBurstDistance;
  const powerRatio = burstRange <= 0
    ? 1
    : clamp(
        (burstDistance - MOVEMENT_RULES.minimumBurstDistance) / burstRange,
        0,
        1,
      );
  const outerRadius = lerp(
    CHARGE_RADAR_RULES.minimumOuterRadius,
    CHARGE_RADAR_RULES.maximumOuterRadius,
    powerRatio,
  );
  const canRelease = movement.chargeSeconds >=
    MOVEMENT_RULES.minimumBurstChargeSeconds;

  if (movement.tankThrottle === 0) {
    return {
      travelDirection,
      burstDistance,
      powerRatio,
      canRelease,
      innerRadius: CHARGE_RADAR_RULES.innerRadius,
      outerRadius,
      minimumTurnRadians: 0,
      maximumTurnRadians: 0,
    };
  }

  const left = predictRemainingTurn(movement, -1, turnRateMultiplier);
  const right = predictRemainingTurn(movement, 1, turnRateMultiplier);
  // Preserve the full semicircle at the start of a charge even when the
  // configured ready time is shorter than the natural steering envelope.
  // This visual floor smoothly disappears as launch power fills.
  const safeTurnRateMultiplier = Number.isFinite(turnRateMultiplier)
    ? clamp(turnRateMultiplier, 0.1, 2)
    : 1;
  const visualAuthorityScale = 1 +
    powerRatio * (safeTurnRateMultiplier - 1);
  const visualHalfAngle = CHARGE_RADAR_RULES.maximumHalfAngleRadians *
    (1 - powerRatio) * visualAuthorityScale;
  const predictedMinimum = Math.min(0, left, right);
  const predictedMaximum = Math.max(0, left, right);
  const visualSpan = Math.max(
    predictedMaximum - predictedMinimum,
    visualHalfAngle * 2,
  );
  const predictedMiddle = (predictedMinimum + predictedMaximum) / 2;
  const visualMiddle = clamp(
    predictedMiddle,
    -CHARGE_RADAR_RULES.maximumHalfAngleRadians + visualSpan / 2,
    CHARGE_RADAR_RULES.maximumHalfAngleRadians - visualSpan / 2,
  );
  return {
    travelDirection,
    burstDistance,
    powerRatio,
    canRelease,
    innerRadius: CHARGE_RADAR_RULES.innerRadius,
    outerRadius,
    minimumTurnRadians: clamp(
      visualMiddle - visualSpan / 2,
      -CHARGE_RADAR_RULES.maximumHalfAngleRadians,
      CHARGE_RADAR_RULES.maximumHalfAngleRadians,
    ),
    maximumTurnRadians: clamp(
      visualMiddle + visualSpan / 2,
      -CHARGE_RADAR_RULES.maximumHalfAngleRadians,
      CHARGE_RADAR_RULES.maximumHalfAngleRadians,
    ),
  };
}

/** Builds an annular fan in world coordinates, avoiding angle-wrap transforms. */
export function buildChargeRadarPath(center: Vec2, radar: ChargeRadar) {
  let minimum = radar.minimumTurnRadians;
  let maximum = radar.maximumTurnRadians;
  if (maximum - minimum < CHARGE_RADAR_RULES.minimumVisibleSpanRadians) {
    const middle = (minimum + maximum) / 2;
    const halfVisibleSpan = CHARGE_RADAR_RULES.minimumVisibleSpanRadians / 2;
    minimum = middle - halfVisibleSpan;
    maximum = middle + halfVisibleSpan;
  }

  const innerStart = offsetPoint(
    center,
    rotate(radar.travelDirection, minimum),
    radar.innerRadius,
  );
  const outerStart = offsetPoint(
    center,
    rotate(radar.travelDirection, minimum),
    radar.outerRadius,
  );
  const outerEnd = offsetPoint(
    center,
    rotate(radar.travelDirection, maximum),
    radar.outerRadius,
  );
  const innerEnd = offsetPoint(
    center,
    rotate(radar.travelDirection, maximum),
    radar.innerRadius,
  );
  const largeArc = maximum - minimum > Math.PI ? 1 : 0;

  return [
    `M ${point(innerStart)}`,
    `L ${point(outerStart)}`,
    `A ${number(radar.outerRadius)} ${number(radar.outerRadius)} 0 ${largeArc} 1 ${point(outerEnd)}`,
    `L ${point(innerEnd)}`,
    `A ${number(radar.innerRadius)} ${number(radar.innerRadius)} 0 ${largeArc} 0 ${point(innerStart)}`,
    "Z",
  ].join(" ");
}

export function chargeRadarEndpoint(center: Vec2, radar: ChargeRadar): Vec2 {
  const maximumDistance = Math.min(
    radar.burstDistance,
    distanceToBoundary(center, radar.travelDirection),
  );
  return offsetPoint(center, radar.travelDirection, Math.max(0, maximumDistance));
}

function predictRemainingTurn(
  movement: MovementState,
  steering: Exclude<TankAxis, 0>,
  turnRateMultiplier: number,
) {
  const seconds = 1 / SIMULATION_RULES.ticksPerSecond;
  let chargeSeconds = movement.chargeSeconds;
  let angularVelocity = movement.angularVelocity;
  let angleDelta = 0;

  for (
    let stepIndex = 0;
    stepIndex < CHARGE_RADAR_RULES.maximumPredictionSteps;
    stepIndex += 1
  ) {
    const step = stepChargingTurn(
      chargeSeconds,
      angularVelocity,
      steering,
      seconds,
      turnRateMultiplier,
    );
    chargeSeconds = step.chargeSeconds;
    angularVelocity = step.angularVelocity;
    angleDelta += step.angleDelta;

    if (
      chargeSeconds >= MOVEMENT_RULES.chargeSlowdownSeconds &&
      Math.abs(angularVelocity) <= CHARGE_RADAR_RULES.angularSettleEpsilon
    ) break;
  }

  return angleDelta;
}

function normalize(value: Vec2, fallback: Vec2): Vec2 {
  const length = Number.isFinite(value.x) && Number.isFinite(value.y)
    ? Math.hypot(value.x, value.y)
    : 0;
  if (length > 0.000001) return { x: value.x / length, y: value.y / length };
  const fallbackLength = Number.isFinite(fallback.x) && Number.isFinite(fallback.y)
    ? Math.hypot(fallback.x, fallback.y)
    : 0;
  if (fallbackLength > 0.000001) {
    return { x: fallback.x / fallbackLength, y: fallback.y / fallbackLength };
  }
  return { x: 0, y: -1 };
}

function distanceToBoundary(center: Vec2, direction: Vec2) {
  const distances: number[] = [];
  if (direction.x > 0.000001) {
    distances.push((WORLD.width - center.x) / direction.x);
  } else if (direction.x < -0.000001) {
    distances.push((0 - center.x) / direction.x);
  }
  if (direction.y > 0.000001) {
    distances.push((WORLD.height - center.y) / direction.y);
  } else if (direction.y < -0.000001) {
    distances.push((0 - center.y) / direction.y);
  }
  const forwardDistances = distances.filter((distance) =>
    Number.isFinite(distance) && distance >= 0
  );
  return forwardDistances.length > 0
    ? Math.min(...forwardDistances)
    : 0;
}

function rotate(value: Vec2, radians: number): Vec2 {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: value.x * cosine - value.y * sine,
    y: value.x * sine + value.y * cosine,
  };
}

function offsetPoint(center: Vec2, direction: Vec2, distance: number): Vec2 {
  return {
    x: center.x + direction.x * distance,
    y: center.y + direction.y * distance,
  };
}

function point(value: Vec2) {
  return `${number(value.x)} ${number(value.y)}`;
}

function number(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(5)) : 0;
}

function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
