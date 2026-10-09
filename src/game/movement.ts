import { clampToWorld, distance } from "./geometry";
import type {
  GameInput,
  MovementState,
  TankInput,
  Vec2,
} from "./types";

const TAU = Math.PI * 2;
const ZERO: Vec2 = { x: 0, y: 0 };

/**
 * All movement feel lives here so it can be tuned without touching networking,
 * input handling, or the rest of the game simulation.
 */
export const MOVEMENT_RULES = {
  walkMaximumSpeed: 10,
  walkAcceleration: 100,
  walkDeceleration: 220,
  walkArrivalRadius: 0.25,

  tankTurnMaximumRadiansPerSecond: Math.PI * 1.5,
  tankTurnAcceleration: Math.PI * 8,
  tankTurnDeceleration: Math.PI * 7,

  stepCycleDistance: 7.5,
  visualSwayDistance: 0.34,
  visualBobDistance: 0.12,
  visualLeanDegrees: 2.5,

  gestureArmMs: 200,
  keyboardBoostDoubleTapMs: 300,
  keyboardBoostTapMaximumMs: 220,
  gestureSlopPx: 12,
  touchGestureSlopPx: 20,
  astronautHitRadiusPx: 24,
  largeControlHitRadiusPx: 28,
  aimDeadZonePx: 16,
  aimVectorDistance: 12,

  // The 200 ms gesture arm plus 0.8 seconds of authoritative charging equals
  // one second before the ready flash appears.
  fullChargeSeconds: 0.8,
  chargeSlowdownSeconds: 1,
  minimumBurstChargeSeconds: 0.2,

  minimumBurstDistance: 5,
  maximumBurstDistance: 27,
  burstSpeed: 70,
} as const;

export interface TankTurnStep {
  angularVelocity: number;
  angleDelta: number;
}

export interface ChargingTurnStep extends TankTurnStep {
  chargeSeconds: number;
}

export interface MovementEnvironment {
  speedMultiplier?: number;
  turnRateMultiplier?: number;
}

/** Shared by authoritative movement and the charge radar prediction. */
export function stepChargingTurn(
  chargeSeconds: number,
  angularVelocity: number,
  steering: TankInput["steering"],
  deltaSeconds: number,
  turnRateMultiplier = 1,
): ChargingTurnStep {
  const seconds = Math.max(0, deltaSeconds);
  const nextCharge = Math.min(
    MOVEMENT_RULES.fullChargeSeconds,
    Math.max(0, chargeSeconds) + seconds,
  );
  return {
    chargeSeconds: nextCharge,
    ...stepTankTurn(
      angularVelocity,
      steering,
      getChargeMotionScale(nextCharge),
      seconds,
      sanitizeMultiplier(turnRateMultiplier),
    ),
  };
}

export function getChargeMotionScale(chargeSeconds: number) {
  const safeCharge = Number.isFinite(chargeSeconds) ? chargeSeconds : 0;
  // A ready charge must always be fully settled, even when the tunable ready
  // time is shorter than the preferred slowdown window.
  const effectiveSlowdownSeconds = Math.min(
    MOVEMENT_RULES.fullChargeSeconds,
    MOVEMENT_RULES.chargeSlowdownSeconds,
  );
  return 1 - smoothstep(
    clamp(safeCharge / effectiveSlowdownSeconds, 0, 1),
  );
}

export function getBurstDistance(chargeSeconds: number) {
  const safeCharge = Number.isFinite(chargeSeconds) ? chargeSeconds : 0;
  const chargeRatio = clamp(
    safeCharge / MOVEMENT_RULES.fullChargeSeconds,
    0,
    1,
  );
  return MOVEMENT_RULES.minimumBurstDistance +
    (MOVEMENT_RULES.maximumBurstDistance - MOVEMENT_RULES.minimumBurstDistance) *
      smoothstep(chargeRatio);
}

export function createMovementState(direction: Vec2): MovementState {
  const facing = normalize(direction, { x: 0, y: -1 });
  return {
    mode: "idle",
    target: null,
    queuedDirection: null,
    direction: { ...facing },
    facing,
    headingRadians: Math.atan2(facing.y, facing.x),
    velocity: { ...ZERO },
    forwardSpeed: 0,
    angularVelocity: 0,
    tankThrottle: 0,
    tankSteering: 0,
    queuedTankInput: null,
    gaitDistance: 0,
    gaitPhase: 0,
    chargeSeconds: 0,
    burstDistanceRemaining: 0,
    burstDistanceTotal: 0,
    lastCommandSequence: 0,
  };
}

/** Hard cancellation used for respawns, disconnects, and disabled controls. */
export function cancelMovement(movement: MovementState): MovementState {
  return {
    ...movement,
    mode: "idle",
    target: null,
    queuedDirection: null,
    velocity: { ...ZERO },
    forwardSpeed: 0,
    angularVelocity: 0,
    tankThrottle: 0,
    tankSteering: 0,
    queuedTankInput: null,
    chargeSeconds: 0,
    burstDistanceRemaining: 0,
    burstDistanceTotal: 0,
  };
}

export interface MovementStep {
  position: Vec2;
  movement: MovementState;
}

export function advanceMovement(
  position: Vec2,
  movement: MovementState,
  inputs: GameInput[],
  deltaSeconds: number,
  worldWidth: number,
  worldHeight: number,
  environment: MovementEnvironment = {},
): MovementStep {
  const acceptedInputs: GameInput[] = [];
  let latestSequence = movement.lastCommandSequence;
  for (const input of inputs) {
    if (input.sequence <= latestSequence) continue;
    acceptedInputs.push(input);
    latestSequence = input.sequence;
  }

  const possibleTerminalInput = acceptedInputs[acceptedInputs.length - 1];
  const precedingInput = acceptedInputs[acceptedInputs.length - 2];
  const terminalKeyboardUpdate = shouldDeferKeyboardTransition(
    precedingInput?.command,
    possibleTerminalInput?.command,
  )
      ? possibleTerminalInput
      : null;
  // Development hot reloads and older reconnect snapshots may predate the
  // continuous heading field. Migrate them from their facing vector once.
  let nextMovement = Number.isFinite(movement.headingRadians)
    ? movement
    : { ...movement, headingRadians: movementHeading(movement) };
  const immediateInputs = terminalKeyboardUpdate
    ? acceptedInputs.slice(0, -1)
    : acceptedInputs;
  for (const input of immediateInputs) {
    nextMovement = applyCommand(position, nextMovement, input);
  }

  // A keyboard axis can be pressed and released inside one 20 Hz tick, even
  // while another axis stays held. Simulate one step with that short input,
  // then commit the final held-key snapshot.
  const deferredKeyboardUpdate =
    terminalKeyboardUpdate &&
      (nextMovement.mode === "walking" || nextMovement.mode === "charging")
      ? terminalKeyboardUpdate
      : null;
  if (terminalKeyboardUpdate && !deferredKeyboardUpdate) {
    nextMovement = applyCommand(position, nextMovement, terminalKeyboardUpdate);
  }
  const finalize = (step: MovementStep): MovementStep => deferredKeyboardUpdate
    ? {
        position: step.position,
        movement: applyCommand(
          step.position,
          step.movement,
          deferredKeyboardUpdate,
        ),
      }
    : step;

  const seconds = Math.max(0, deltaSeconds);
  const speedMultiplier = sanitizeMultiplier(environment.speedMultiplier ?? 1);
  const turnRateMultiplier = sanitizeMultiplier(
    environment.turnRateMultiplier ?? 1,
  );
  if (seconds === 0) {
    return finalize({ position: { ...position }, movement: nextMovement });
  }

  if (nextMovement.mode === "burst") {
    return finalize(
      advanceBurst(
        position,
        nextMovement,
        seconds,
        worldWidth,
        worldHeight,
        speedMultiplier,
      ),
    );
  }

  let velocity = { ...nextMovement.velocity };

  if (isTankControlled(nextMovement)) {
    nextMovement = advanceTankControls(
      nextMovement,
      seconds,
      speedMultiplier,
      turnRateMultiplier,
    );
    velocity = scale(nextMovement.facing, nextMovement.forwardSpeed);
  } else {
    let desiredVelocity = { ...ZERO };
    let acceleration: number = MOVEMENT_RULES.walkDeceleration;

    if (nextMovement.mode === "walking") {
      if (nextMovement.target) {
        const remaining = distance(position, nextMovement.target);
        if (remaining <= MOVEMENT_RULES.walkArrivalRadius) {
          return finalize({
            position: { ...nextMovement.target },
            movement: {
              ...nextMovement,
              mode: "idle",
              target: null,
              queuedDirection: null,
              velocity: { ...ZERO },
            },
          });
        }

        const direction = normalize(
          subtract(nextMovement.target, position),
          nextMovement.direction,
        );
        const stoppingSpeed = Math.sqrt(
          2 * MOVEMENT_RULES.walkDeceleration * remaining,
        );
        const desiredSpeed = Math.min(
          MOVEMENT_RULES.walkMaximumSpeed * speedMultiplier,
          stoppingSpeed,
        );
        desiredVelocity = scale(direction, desiredSpeed);
        acceleration = magnitude(nextMovement.velocity) > desiredSpeed
          ? MOVEMENT_RULES.walkDeceleration
          : MOVEMENT_RULES.walkAcceleration;
        nextMovement = {
          ...nextMovement,
          direction,
          facing: direction,
          headingRadians: alignHeadingToDirection(
            nextMovement.headingRadians,
            direction,
          ),
        };
      } else {
        desiredVelocity = scale(
          nextMovement.direction,
          MOVEMENT_RULES.walkMaximumSpeed * speedMultiplier,
        );
        acceleration = magnitude(nextMovement.velocity) >
            MOVEMENT_RULES.walkMaximumSpeed * speedMultiplier
          ? MOVEMENT_RULES.walkDeceleration
          : MOVEMENT_RULES.walkAcceleration;
      }
    } else if (nextMovement.mode === "charging") {
      const nextCharge = Math.min(
        MOVEMENT_RULES.fullChargeSeconds,
        nextMovement.chargeSeconds + seconds,
      );
      const speedCap = MOVEMENT_RULES.walkMaximumSpeed * speedMultiplier *
        getChargeMotionScale(nextCharge);
      desiredVelocity = scale(nextMovement.direction, speedCap);
      acceleration = magnitude(nextMovement.velocity) > speedCap
        ? MOVEMENT_RULES.walkDeceleration
        : MOVEMENT_RULES.walkAcceleration;
      nextMovement = { ...nextMovement, chargeSeconds: nextCharge };
    }

    velocity = approachVector(
      nextMovement.velocity,
      desiredVelocity,
      acceleration * seconds,
    );
  }

  let nextPosition = clampToWorld(
    add(position, scale(velocity, seconds)),
    worldWidth,
    worldHeight,
  );

  if (nextMovement.mode === "walking" && nextMovement.target) {
    const before = distance(position, nextMovement.target);
    const after = distance(nextPosition, nextMovement.target);
    if (after <= MOVEMENT_RULES.walkArrivalRadius || after > before + 0.001) {
      nextPosition = { ...nextMovement.target };
      nextMovement = {
        ...nextMovement,
        mode: "idle",
        target: null,
        velocity: { ...ZERO },
      };
      velocity = { ...ZERO };
    }
  }

  const traveled = distance(position, nextPosition);
  const gaitDistance = nextMovement.gaitDistance + traveled;

  return finalize({
    position: nextPosition,
    movement: {
      ...nextMovement,
      velocity:
        nextMovement.mode === "idle" && magnitude(velocity) < 0.01
          ? { ...ZERO }
          : velocity,
      gaitDistance,
      gaitPhase: ((gaitDistance / MOVEMENT_RULES.stepCycleDistance) * TAU) % TAU,
    },
  });
}

function advanceTankControls(
  movement: MovementState,
  seconds: number,
  speedMultiplier: number,
  turnRateMultiplier: number,
): MovementState {
  const charging = movement.mode === "charging";
  const turn = charging
    ? stepChargingTurn(
        movement.chargeSeconds,
        movement.angularVelocity,
        movement.tankSteering,
        seconds,
        turnRateMultiplier,
      )
    : {
        chargeSeconds: 0,
        ...stepTankTurn(
          movement.angularVelocity,
          movement.tankSteering,
          1,
          seconds,
          turnRateMultiplier,
        ),
      };
  const headingRadians = movementHeading(movement) + turn.angleDelta;
  const facing = turn.angleDelta === 0 && Number.isFinite(movement.headingRadians)
    ? movement.facing
    : directionFromHeading(headingRadians);
  const motionScale = charging ? getChargeMotionScale(turn.chargeSeconds) : 1;

  const desiredForwardSpeed =
    movement.tankThrottle * MOVEMENT_RULES.walkMaximumSpeed * speedMultiplier *
    motionScale;
  const forwardAcceleration =
    Math.abs(desiredForwardSpeed) > Math.abs(movement.forwardSpeed) &&
      (movement.forwardSpeed === 0 ||
        Math.sign(desiredForwardSpeed) === Math.sign(movement.forwardSpeed))
      ? MOVEMENT_RULES.walkAcceleration
      : MOVEMENT_RULES.walkDeceleration;
  const forwardSpeed = approachScalar(
    movement.forwardSpeed,
    desiredForwardSpeed,
    forwardAcceleration * seconds,
  );
  const travelDirection = movement.tankThrottle < 0
    ? scale(facing, -1)
    : facing;

  return {
    ...movement,
    direction: travelDirection,
    facing,
    headingRadians,
    forwardSpeed,
    angularVelocity: turn.angularVelocity,
    chargeSeconds: turn.chargeSeconds,
  };
}

function applyCommand(
  position: Vec2,
  movement: MovementState,
  input: GameInput,
): MovementState {
  const { command } = input;
  const withSequence = { ...movement, lastCommandSequence: input.sequence };

  if (movement.mode === "burst") {
    if (command.type === "walk") {
      return {
        ...withSequence,
        target: { ...command.target },
        queuedDirection: null,
        queuedTankInput: null,
      };
    }
    if (command.type === "walk_direction") {
      return {
        ...withSequence,
        target: null,
        queuedDirection: normalize(command.direction, movement.direction),
        queuedTankInput: null,
      };
    }
    if (command.type === "tank_drive") {
      return {
        ...withSequence,
        target: null,
        queuedDirection: null,
        queuedTankInput: isNeutralTankInput(command) ? null : tankInput(command),
      };
    }
    if (
      command.type === "release" ||
      command.type === "release_direction" ||
      command.type === "tank_release" ||
      command.type === "stop"
    ) {
      return {
        ...withSequence,
        target: null,
        queuedDirection: null,
        queuedTankInput: null,
      };
    }
    return withSequence;
  }

  if (command.type === "stop") {
    return softStop(withSequence);
  }

  if (command.type === "tank_drive") {
    if (isNeutralTankInput(command)) return softStop(withSequence);
    const wasTankControlled = isTankControlled(movement);
    const forwardSpeed = wasTankControlled
      ? movement.forwardSpeed
      : clamp(
          dot(movement.velocity, movement.facing),
          -MOVEMENT_RULES.walkMaximumSpeed,
          MOVEMENT_RULES.walkMaximumSpeed,
        );
    return {
      ...withSequence,
      mode: "walking",
      target: null,
      queuedDirection: null,
      forwardSpeed,
      tankThrottle: command.throttle,
      tankSteering: command.steering,
      queuedTankInput: null,
      chargeSeconds: 0,
      burstDistanceRemaining: 0,
      burstDistanceTotal: 0,
    };
  }

  if (command.type === "tank_charge") {
    if (command.throttle === 0) return softStop(withSequence);
    const wasTankControlled = isTankControlled(movement);
    const forwardSpeed = wasTankControlled
      ? movement.forwardSpeed
      : clamp(
          dot(movement.velocity, movement.facing),
          -MOVEMENT_RULES.walkMaximumSpeed,
          MOVEMENT_RULES.walkMaximumSpeed,
        );
    const direction = command.throttle < 0
      ? scale(movement.facing, -1)
      : movement.facing;
    return {
      ...withSequence,
      mode: "charging",
      target: null,
      queuedDirection: null,
      direction,
      forwardSpeed,
      tankThrottle: command.throttle,
      tankSteering: command.steering,
      queuedTankInput: null,
      chargeSeconds: movement.mode === "charging" ? movement.chargeSeconds : 0,
      burstDistanceRemaining: 0,
      burstDistanceTotal: 0,
    };
  }

  if (command.type === "walk_direction") {
    const direction = normalize(command.direction, movement.direction);
    const headingRadians = alignHeadingToDirection(
      movement.headingRadians,
      direction,
    );
    return {
      ...withSequence,
      mode: "walking",
      target: null,
      queuedDirection: null,
      direction,
      facing: direction,
      headingRadians,
      forwardSpeed: 0,
      angularVelocity: 0,
      tankThrottle: 0,
      tankSteering: 0,
      queuedTankInput: null,
      chargeSeconds: 0,
      burstDistanceRemaining: 0,
      burstDistanceTotal: 0,
    };
  }

  if (command.type === "walk") {
    const direction = normalize(
      subtract(command.target, position),
      movement.direction,
    );
    const headingRadians = alignHeadingToDirection(
      movement.headingRadians,
      direction,
    );
    return {
      ...withSequence,
      mode: "walking",
      target: { ...command.target },
      queuedDirection: null,
      direction,
      facing: direction,
      headingRadians,
      forwardSpeed: 0,
      angularVelocity: 0,
      tankThrottle: 0,
      tankSteering: 0,
      queuedTankInput: null,
      chargeSeconds: 0,
      burstDistanceRemaining: 0,
      burstDistanceTotal: 0,
    };
  }

  if (command.type === "charge" || command.type === "charge_direction") {
    const direction = command.type === "charge_direction"
      ? normalize(command.direction, movement.direction)
      : normalize(subtract(command.target, position), movement.direction);
    const headingRadians = alignHeadingToDirection(
      movement.headingRadians,
      direction,
    );
    return {
      ...withSequence,
      mode: "charging",
      target: command.type === "charge" ? { ...command.target } : null,
      queuedDirection: null,
      direction,
      facing: direction,
      headingRadians,
      forwardSpeed: 0,
      angularVelocity: 0,
      tankThrottle: 0,
      tankSteering: 0,
      queuedTankInput: null,
      chargeSeconds: movement.mode === "charging" ? movement.chargeSeconds : 0,
      burstDistanceRemaining: 0,
      burstDistanceTotal: 0,
    };
  }

  if (
    movement.mode !== "charging" ||
    movement.chargeSeconds < MOVEMENT_RULES.minimumBurstChargeSeconds
  ) {
    return cancelMovement(withSequence);
  }

  let direction = movement.direction;
  let facing = movement.facing;
  let headingRadians = movementHeading(movement);
  if (command.type === "release") {
    direction = normalize(subtract(command.target, position), movement.direction);
    facing = direction;
    headingRadians = alignHeadingToDirection(headingRadians, direction);
  } else if (command.type === "release_direction") {
    direction = normalize(command.direction, movement.direction);
    facing = direction;
    headingRadians = alignHeadingToDirection(headingRadians, direction);
  }

  const burstDistance = getBurstDistance(movement.chargeSeconds);

  return {
    ...withSequence,
    mode: "burst",
    target: null,
    queuedDirection: null,
    direction,
    facing,
    headingRadians,
    velocity: scale(direction, MOVEMENT_RULES.burstSpeed),
    forwardSpeed: 0,
    angularVelocity: 0,
    tankThrottle: 0,
    tankSteering: 0,
    queuedTankInput: null,
    chargeSeconds: movement.chargeSeconds,
    burstDistanceRemaining: burstDistance,
    burstDistanceTotal: burstDistance,
  };
}

function advanceBurst(
  position: Vec2,
  movement: MovementState,
  deltaSeconds: number,
  worldWidth: number,
  worldHeight: number,
  speedMultiplier: number,
): MovementStep {
  const requestedDistance = Math.min(
    movement.burstDistanceRemaining,
    MOVEMENT_RULES.burstSpeed * speedMultiplier * deltaSeconds,
  );
  const nextPosition = clampToWorld(
    add(position, scale(movement.direction, requestedDistance)),
    worldWidth,
    worldHeight,
  );
  const actualDistance = distance(position, nextPosition);
  const remaining = Math.max(
    0,
    movement.burstDistanceRemaining - actualDistance,
  );
  const finished =
    remaining <= 0.0001 || actualDistance + 0.0001 < requestedDistance;

  if (!finished) {
    return {
      position: nextPosition,
      movement: {
        ...movement,
        velocity: scale(
          movement.direction,
          MOVEMENT_RULES.burstSpeed * speedMultiplier,
        ),
        burstDistanceRemaining: remaining,
      },
    };
  }

  const queuedTankInput = movement.queuedTankInput;
  const resumesTank = queuedTankInput !== null &&
    !isNeutralTankInput(queuedTankInput);
  const mode = movement.target || movement.queuedDirection || resumesTank
    ? "walking"
    : "idle";
  const direction = movement.queuedDirection ?? movement.direction;
  const facing = movement.queuedDirection ?? movement.facing;
  const currentHeading = movementHeading(movement);
  const headingRadians = movement.queuedDirection
    ? alignHeadingToDirection(currentHeading, movement.queuedDirection)
    : currentHeading;

  return {
    position: nextPosition,
    movement: {
      ...movement,
      mode,
      direction,
      facing,
      headingRadians,
      queuedDirection: null,
      velocity: { ...ZERO },
      forwardSpeed: 0,
      angularVelocity: 0,
      tankThrottle: queuedTankInput?.throttle ?? 0,
      tankSteering: queuedTankInput?.steering ?? 0,
      queuedTankInput: null,
      chargeSeconds: 0,
      burstDistanceRemaining: 0,
      burstDistanceTotal: 0,
    },
  };
}

function softStop(movement: MovementState): MovementState {
  return {
    ...movement,
    mode: "idle",
    target: null,
    queuedDirection: null,
    forwardSpeed: 0,
    angularVelocity: 0,
    tankThrottle: 0,
    tankSteering: 0,
    queuedTankInput: null,
    chargeSeconds: 0,
    burstDistanceRemaining: 0,
    burstDistanceTotal: 0,
  };
}

function shouldDeferKeyboardTransition(
  previous: GameInput["command"] | undefined,
  next: GameInput["command"] | undefined,
) {
  if (!previous || !next) return false;
  if (next.type === "stop") {
    return previous.type === "walk_direction" ||
      (previous.type === "tank_drive" && !isNeutralTankInput(previous));
  }
  if (previous.type === "tank_drive" && next.type === "tank_drive") {
    return releasesTankAxis(previous, next);
  }
  if (previous.type === "tank_charge" && next.type === "tank_charge") {
    return releasesTankAxis(previous, next);
  }
  return false;
}

function releasesTankAxis(previous: TankInput, next: TankInput) {
  return (previous.throttle !== 0 && next.throttle === 0) ||
    (previous.steering !== 0 && next.steering === 0);
}

function isTankControlled(movement: MovementState) {
  return movement.tankThrottle !== 0 || movement.tankSteering !== 0;
}

function tankInput(input: TankInput): TankInput {
  return { throttle: input.throttle, steering: input.steering };
}

function isNeutralTankInput(input: TankInput) {
  return input.throttle === 0 && input.steering === 0;
}

function approachVector(current: Vec2, target: Vec2, maximumDelta: number): Vec2 {
  const delta = subtract(target, current);
  const deltaMagnitude = magnitude(delta);
  if (deltaMagnitude <= maximumDelta || deltaMagnitude === 0) return { ...target };
  return add(current, scale(delta, maximumDelta / deltaMagnitude));
}

function approachScalar(current: number, target: number, maximumDelta: number) {
  if (current < target) return Math.min(target, current + maximumDelta);
  if (current > target) return Math.max(target, current - maximumDelta);
  return target;
}

function stepTankTurn(
  angularVelocity: number,
  steering: TankInput["steering"],
  motionScale: number,
  seconds: number,
  turnRateMultiplier = 1,
): TankTurnStep {
  const desiredAngularVelocity =
    steering * MOVEMENT_RULES.tankTurnMaximumRadiansPerSecond * motionScale *
    turnRateMultiplier;
  const angularAcceleration =
    Math.abs(desiredAngularVelocity) > Math.abs(angularVelocity) &&
      (angularVelocity === 0 ||
        Math.sign(desiredAngularVelocity) === Math.sign(angularVelocity))
      ? MOVEMENT_RULES.tankTurnAcceleration
      : MOVEMENT_RULES.tankTurnDeceleration;
  const nextAngularVelocity = approachScalar(
    angularVelocity,
    desiredAngularVelocity,
    angularAcceleration * turnRateMultiplier * seconds,
  );
  return {
    angularVelocity: nextAngularVelocity,
    angleDelta: (angularVelocity + nextAngularVelocity) / 2 * seconds,
  };
}

function normalize(value: Vec2, fallback: Vec2): Vec2 {
  const length = magnitude(value);
  return length <= 0.000001 ? { ...fallback } : scale(value, 1 / length);
}

function directionFromHeading(radians: number): Vec2 {
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

function alignHeadingToDirection(currentRadians: number, direction: Vec2) {
  const desiredRadians = Math.atan2(direction.y, direction.x);
  const safeCurrent = Number.isFinite(currentRadians)
    ? currentRadians
    : desiredRadians;
  const shortestDelta = Math.atan2(
    Math.sin(desiredRadians - safeCurrent),
    Math.cos(desiredRadians - safeCurrent),
  );
  return safeCurrent + shortestDelta;
}

function movementHeading(movement: MovementState) {
  return Number.isFinite(movement.headingRadians)
    ? movement.headingRadians
    : Math.atan2(movement.facing.y, movement.facing.x);
}

function magnitude(value: Vec2) {
  return Math.hypot(value.x, value.y);
}

function dot(a: Vec2, b: Vec2) {
  return a.x * b.x + a.y * b.y;
}

function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

function subtract(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function scale(value: Vec2, amount: number): Vec2 {
  return { x: value.x * amount, y: value.y * amount };
}

function smoothstep(value: number) {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped * clamped * (3 - 2 * clamped);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function sanitizeMultiplier(value: number) {
  return Number.isFinite(value) ? clamp(value, 0.1, 2) : 1;
}
