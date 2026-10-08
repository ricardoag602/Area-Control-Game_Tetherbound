import { clampToWorld, distance } from "./geometry";
import type { GameInput, MovementState, Vec2 } from "./types";

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

    stepCycleDistance: 7.5,
    visualSwayDistance: 0.34,
    visualBobDistance: 0.12,
    visualLeanDegrees: 2.5,

    gestureArmMs: 200,
    keyboardBoostDoubleTapMs: 300,
    keyboardBoostTapMaximumMs: 220,
    gestureSlopPx: 12,
    astronautHitRadiusPx: 24,
    largeControlHitRadiusPx: 28,
    aimDeadZonePx: 16,
    aimVectorDistance: 12,

    // The 200 ms gesture arm plus 1.8 seconds of server charge equals a
    // two-second hold before the ready flash appears.
    fullChargeSeconds: 0.8,
    chargeSlowdownSeconds: 1,
    minimumBurstChargeSeconds: 0.2,

    minimumBurstDistance: 5,
    maximumBurstDistance: 27,
    burstSpeed: 70,
} as const;

export function createMovementState(direction: Vec2): MovementState {
    return {
        mode: "idle",
        target: null,
        queuedDirection: null,
        direction: normalize(direction, { x: 0, y: -1 }),
        velocity: { ...ZERO },
        gaitDistance: 0,
        gaitPhase: 0,
        chargeSeconds: 0,
        burstDistanceRemaining: 0,
        burstDistanceTotal: 0,
        lastCommandSequence: 0,
    };
}

export function cancelMovement(movement: MovementState): MovementState {
    return {
        ...movement,
        mode: "idle",
        target: null,
        queuedDirection: null,
        velocity: { ...ZERO },
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
): MovementStep {
    const acceptedInputs: GameInput[] = [];
    let latestSequence = movement.lastCommandSequence;
    for (const input of inputs) {
        if (input.sequence <= latestSequence) continue;
        acceptedInputs.push(input);
        latestSequence = input.sequence;
    }

    const possibleStop = acceptedInputs[acceptedInputs.length - 1];
    const precedingInput = acceptedInputs[acceptedInputs.length - 2];
    const terminalKeyboardStop =
        possibleStop?.command.type === "stop" &&
            precedingInput?.command.type === "walk_direction"
            ? possibleStop
            : null;
    let nextMovement = movement;
    const immediateInputs = terminalKeyboardStop
        ? acceptedInputs.slice(0, -1)
        : acceptedInputs;
    for (const input of immediateInputs) {
        nextMovement = applyCommand(position, nextMovement, input);
    }

    // A key press and release can both arrive inside one 20 Hz tick. Give that
    // tap the same single movement step it would receive across a tick boundary,
    // then consume its stop without advancing simulation time a second time.
    const deferredStop =
        terminalKeyboardStop &&
            nextMovement.mode === "walking" &&
            nextMovement.target === null
            ? terminalKeyboardStop
            : null;
    if (terminalKeyboardStop && !deferredStop) {
        nextMovement = applyCommand(position, nextMovement, terminalKeyboardStop);
    }
    const finalize = (step: MovementStep): MovementStep => deferredStop
        ? {
            position: step.position,
            movement: applyCommand(step.position, step.movement, deferredStop),
        }
        : step;

    const seconds = Math.max(0, deltaSeconds);
    if (seconds === 0) {
        return finalize({ position: { ...position }, movement: nextMovement });
    }

    if (nextMovement.mode === "burst") {
        return finalize(
            advanceBurst(position, nextMovement, seconds, worldWidth, worldHeight),
        );
    }

    const previousMode = nextMovement.mode;
    const previousCharge = nextMovement.chargeSeconds;
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

            const direction = normalize(subtract(nextMovement.target, position), nextMovement.direction);
            const stoppingSpeed = Math.sqrt(2 * MOVEMENT_RULES.walkDeceleration * remaining);
            const desiredSpeed = Math.min(MOVEMENT_RULES.walkMaximumSpeed, stoppingSpeed);
            desiredVelocity = scale(direction, desiredSpeed);
            acceleration =
                magnitude(nextMovement.velocity) > desiredSpeed
                    ? MOVEMENT_RULES.walkDeceleration
                    : MOVEMENT_RULES.walkAcceleration;
            nextMovement = { ...nextMovement, direction };
        } else {
            desiredVelocity = scale(nextMovement.direction, MOVEMENT_RULES.walkMaximumSpeed);
            acceleration =
                magnitude(nextMovement.velocity) > MOVEMENT_RULES.walkMaximumSpeed
                    ? MOVEMENT_RULES.walkDeceleration
                    : MOVEMENT_RULES.walkAcceleration;
        }
    } else if (nextMovement.mode === "charging") {
        const nextCharge = Math.min(
            MOVEMENT_RULES.fullChargeSeconds,
            previousCharge + seconds,
        );
        const slowdown = smoothstep(
            Math.min(1, nextCharge / MOVEMENT_RULES.chargeSlowdownSeconds),
        );
        const speedCap = MOVEMENT_RULES.walkMaximumSpeed * (1 - slowdown);
        desiredVelocity = scale(nextMovement.direction, speedCap);
        acceleration =
            magnitude(nextMovement.velocity) > speedCap
                ? MOVEMENT_RULES.walkDeceleration
                : MOVEMENT_RULES.walkAcceleration;
        nextMovement = { ...nextMovement, chargeSeconds: nextCharge };
    }

    const velocity = approachVector(
        nextMovement.velocity,
        desiredVelocity,
        acceleration * seconds,
    );
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
        }
    }

    const traveled = distance(position, nextPosition);
    const gaitDistance =
        previousMode === "walking" || previousMode === "charging" || traveled > 0
            ? nextMovement.gaitDistance + traveled
            : nextMovement.gaitDistance;

    return finalize({
        position: nextPosition,
        movement: {
            ...nextMovement,
            velocity: nextMovement.mode === "idle" && magnitude(velocity) < 0.01 ? { ...ZERO } : velocity,
            gaitDistance,
            gaitPhase: ((gaitDistance / MOVEMENT_RULES.stepCycleDistance) * TAU) % TAU,
        },
    });
}

function applyCommand(
    position: Vec2,
    movement: MovementState,
    input: GameInput,
): MovementState {
    const { command } = input;
    const withSequence = { ...movement, lastCommandSequence: input.sequence };

    if (movement.mode === "burst") {
        // A burst is committed once released. A walk pressed during flight is
        // remembered and begins on landing; stop simply clears that queued walk.
        if (command.type === "walk") {
            return {
                ...withSequence,
                target: { ...command.target },
                queuedDirection: null,
            };
        }
        if (command.type === "walk_direction") {
            // Remember held keyboard movement authoritatively. This avoids relying
            // on a client observing the short-lived burst state before it can resume.
            return {
                ...withSequence,
                target: null,
                queuedDirection: normalize(command.direction, movement.direction),
            };
        }
        if (command.type === "release" || command.type === "release_direction") {
            // A stale client may try to begin and release another boost while the
            // authoritative player is still in flight. The release means that input
            // is no longer held, so it must not leave an earlier walk queued.
            return { ...withSequence, target: null, queuedDirection: null };
        }
        if (command.type === "stop") {
            return { ...withSequence, target: null, queuedDirection: null };
        }
        return withSequence;
    }

    if (command.type === "stop") {
        return {
            ...withSequence,
            mode: "idle",
            target: null,
            queuedDirection: null,
            chargeSeconds: 0,
            burstDistanceRemaining: 0,
            burstDistanceTotal: 0,
        };
    }

    if (command.type === "walk_direction") {
        return {
            ...withSequence,
            mode: "walking",
            target: null,
            queuedDirection: null,
            direction: normalize(command.direction, movement.direction),
            chargeSeconds: 0,
            burstDistanceRemaining: 0,
            burstDistanceTotal: 0,
        };
    }

    const direction = "direction" in command
        ? normalize(command.direction, movement.direction)
        : normalize(subtract(command.target, position), movement.direction);
    if (command.type === "walk") {
        return {
            ...withSequence,
            mode: "walking",
            target: { ...command.target },
            queuedDirection: null,
            direction,
            chargeSeconds: 0,
            burstDistanceRemaining: 0,
            burstDistanceTotal: 0,
        };
    }

    if (command.type === "charge" || command.type === "charge_direction") {
        return {
            ...withSequence,
            mode: "charging",
            target: command.type === "charge" ? { ...command.target } : null,
            queuedDirection: null,
            direction,
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

    const chargeRatio = Math.min(
        1,
        movement.chargeSeconds / MOVEMENT_RULES.fullChargeSeconds,
    );
    const easedCharge = smoothstep(chargeRatio);
    const burstDistance =
        MOVEMENT_RULES.minimumBurstDistance +
        (MOVEMENT_RULES.maximumBurstDistance - MOVEMENT_RULES.minimumBurstDistance) * easedCharge;

    return {
        ...withSequence,
        mode: "burst",
        target: null,
        queuedDirection: null,
        direction,
        velocity: scale(direction, MOVEMENT_RULES.burstSpeed),
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
): MovementStep {
    const requestedDistance = Math.min(
        movement.burstDistanceRemaining,
        MOVEMENT_RULES.burstSpeed * deltaSeconds,
    );
    const nextPosition = clampToWorld(
        add(position, scale(movement.direction, requestedDistance)),
        worldWidth,
        worldHeight,
    );
    const actualDistance = distance(position, nextPosition);
    const remaining = Math.max(0, movement.burstDistanceRemaining - actualDistance);
    const finished = remaining <= 0.0001 || actualDistance + 0.0001 < requestedDistance;

    return {
        position: nextPosition,
        movement: finished
            ? {
                ...movement,
                mode: movement.target || movement.queuedDirection ? "walking" : "idle",
                direction: movement.queuedDirection ?? movement.direction,
                queuedDirection: null,
                velocity: { ...ZERO },
                chargeSeconds: 0,
                burstDistanceRemaining: 0,
                burstDistanceTotal: 0,
            }
            : {
                ...movement,
                velocity: scale(movement.direction, MOVEMENT_RULES.burstSpeed),
                burstDistanceRemaining: remaining,
            },
    };
}

function approachVector(current: Vec2, target: Vec2, maximumDelta: number): Vec2 {
    const delta = subtract(target, current);
    const deltaMagnitude = magnitude(delta);
    if (deltaMagnitude <= maximumDelta || deltaMagnitude === 0) return { ...target };
    return add(current, scale(delta, maximumDelta / deltaMagnitude));
}

function normalize(value: Vec2, fallback: Vec2): Vec2 {
    const length = magnitude(value);
    return length <= 0.000001 ? { ...fallback } : scale(value, 1 / length);
}

function magnitude(value: Vec2) {
    return Math.hypot(value.x, value.y);
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
