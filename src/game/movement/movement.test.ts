import { describe, expect, it } from "vitest";
import {
  advanceMovement,
  createMovementState,
  MOVEMENT_RULES,
} from "./movement";
import type { GameInput, MovementState, Vec2 } from "../types";

const WORLD_WIDTH = 100;
const WORLD_HEIGHT = 160;
const TAU = Math.PI * 2;

function input(sequence: number, command: GameInput["command"]): GameInput {
  return { sequence, command };
}

function advance(
  position: Vec2,
  movement: MovementState,
  inputs: GameInput[],
  deltaSeconds: number,
) {
  return advanceMovement(
    position,
    movement,
    inputs,
    deltaSeconds,
    WORLD_WIDTH,
    WORLD_HEIGHT,
  );
}

function chargeAt(position: Vec2, target: Vec2, seconds: number) {
  return advance(
    position,
    createMovementState({ x: 1, y: 0 }),
    [input(1, { type: "charge", target })],
    seconds,
  );
}

describe("astronaut movement", () => {
  it("charges and releases a normalized keyboard boost direction", () => {
    const start = { x: 50, y: 80 };
    const charging = advance(
      start,
      createMovementState({ x: 1, y: 0 }),
      [input(1, {
        type: "charge_direction",
        direction: { x: 1, y: -1 },
      })],
      MOVEMENT_RULES.fullChargeSeconds,
    );

    expect(charging.position).toEqual(start);
    expect(charging.movement).toMatchObject({
      mode: "charging",
      target: null,
      chargeSeconds: MOVEMENT_RULES.fullChargeSeconds,
      lastCommandSequence: 1,
    });
    expect(charging.movement.direction.x).toBeCloseTo(Math.SQRT1_2, 10);
    expect(charging.movement.direction.y).toBeCloseTo(-Math.SQRT1_2, 10);

    const released = advance(
      charging.position,
      charging.movement,
      [input(2, {
        type: "release_direction",
        direction: { x: 0, y: -1 },
      })],
      0,
    );

    expect(released.movement).toMatchObject({
      mode: "burst",
      target: null,
      direction: { x: 0, y: -1 },
      velocity: { x: 0, y: -MOVEMENT_RULES.burstSpeed },
      burstDistanceTotal: MOVEMENT_RULES.maximumBurstDistance,
      lastCommandSequence: 2,
    });
  });

  it("does not release a keyboard boost before its minimum charge", () => {
    const start = { x: 50, y: 80 };
    const charging = advance(
      start,
      createMovementState({ x: 0, y: -1 }),
      [input(1, {
        type: "charge_direction",
        direction: { x: 0, y: -1 },
      })],
      MOVEMENT_RULES.minimumBurstChargeSeconds / 2,
    );
    const released = advance(
      charging.position,
      charging.movement,
      [input(2, {
        type: "release_direction",
        direction: { x: 0, y: -1 },
      })],
      0,
    );

    expect(released.position).toEqual(charging.position);
    expect(released.movement).toMatchObject({
      mode: "idle",
      target: null,
      chargeSeconds: 0,
      burstDistanceRemaining: 0,
      lastCommandSequence: 2,
    });
  });

  it("supports persistent normalized keyboard direction and wall sliding", () => {
    const moving = advance(
      { x: 100, y: 80 },
      createMovementState({ x: 0, y: -1 }),
      [input(1, { type: "walk_direction", direction: { x: 1, y: -1 } })],
      0.1,
    );

    expect(moving.movement).toMatchObject({
      mode: "walking",
      target: null,
      lastCommandSequence: 1,
    });
    expect(Math.hypot(
      moving.movement.direction.x,
      moving.movement.direction.y,
    )).toBeCloseTo(1, 10);
    expect(moving.position.x).toBe(100);
    expect(moving.position.y).toBeLessThan(80);
  });

  it("turns in place quickly without translating", () => {
    const start = { x: 50, y: 80 };
    const turned = advance(
      start,
      createMovementState({ x: 0, y: -1 }),
      [input(1, {
        type: "tank_drive",
        throttle: 0,
        steering: 1,
      })],
      0.1,
    );

    expect(turned.position).toEqual(start);
    expect(turned.movement.mode).toBe("walking");
    expect(turned.movement.facing.x).toBeGreaterThan(0);
    expect(turned.movement.facing.y).toBeLessThan(0);
    expect(turned.movement.angularVelocity).toBeGreaterThan(0);
    expect(Math.hypot(
      turned.movement.facing.x,
      turned.movement.facing.y,
    )).toBeCloseTo(1, 10);
  });

  it("reaches walking and turning speed quickly after an input", () => {
    const start = { x: 50, y: 80 };
    const firstTick = advance(
      start,
      createMovementState({ x: 0, y: -1 }),
      [input(1, {
        type: "tank_drive",
        throttle: 1,
        steering: 1,
      })],
      1 / 20,
    );

    expect(firstTick.movement.forwardSpeed).toBeGreaterThan(
      MOVEMENT_RULES.walkMaximumSpeed * 0.75,
    );

    const fourthTick = advance(
      firstTick.position,
      firstTick.movement,
      [],
      3 / 20,
    );

    expect(fourthTick.movement.forwardSpeed).toBe(
      MOVEMENT_RULES.walkMaximumSpeed,
    );
    expect(fourthTick.movement.angularVelocity).toBeCloseTo(
      MOVEMENT_RULES.tankTurnMaximumRadiansPerSecond,
      10,
    );
  });

  it("keeps an unwrapped authoritative heading through repeated revolutions", () => {
    const start = { x: 50, y: 80 };
    let position = start;
    let movement = createMovementState({ x: 0, y: -1 });
    const initialHeading = movement.headingRadians;
    let previousHeading = initialHeading;

    for (let frame = 0; frame < 160; frame += 1) {
      const step = advance(
        position,
        movement,
        frame === 0
          ? [input(1, { type: "tank_drive", throttle: 0, steering: 1 })]
          : [],
        0.05,
      );
      position = step.position;
      movement = step.movement;

      expect(movement.headingRadians).toBeGreaterThan(previousHeading);
      previousHeading = movement.headingRadians;
    }

    expect(position).toEqual(start);
    expect(movement.headingRadians - initialHeading).toBeGreaterThan(3 * TAU);
    expect(movement.facing.x).toBeCloseTo(Math.cos(movement.headingRadians), 10);
    expect(movement.facing.y).toBeCloseTo(Math.sin(movement.headingRadians), 10);
  });

  it("crosses the signed-angle seam without unwinding prior revolutions", () => {
    const start = { x: 50, y: 80 };
    const positiveFacing = directionAtDegrees(179);
    const positiveHeading = 2 * TAU + radians(179);
    const positiveState: MovementState = {
      ...createMovementState(positiveFacing),
      headingRadians: positiveHeading,
    };
    const clockwise = advance(
      start,
      positiveState,
      [input(1, {
        type: "walk_direction",
        direction: directionAtDegrees(-179),
      })],
      0,
    );

    expect(clockwise.movement.headingRadians).toBeCloseTo(
      2 * TAU + radians(181),
      10,
    );

    const negativeFacing = directionAtDegrees(-179);
    const negativeState: MovementState = {
      ...createMovementState(negativeFacing),
      headingRadians: -2 * TAU + radians(-179),
    };
    const counterclockwiseTarget = directionAtDegrees(179);
    const counterclockwise = advance(
      start,
      negativeState,
      [input(1, {
        type: "walk",
        target: {
          x: start.x + counterclockwiseTarget.x * 10,
          y: start.y + counterclockwiseTarget.y * 10,
        },
      })],
      0,
    );

    expect(counterclockwise.movement.headingRadians).toBeCloseTo(
      -2 * TAU + radians(-181),
      10,
    );
  });

  it("migrates a legacy heading from facing before crossing the seam", () => {
    const start = { x: 50, y: 80 };
    const legacy = createMovementState(directionAtDegrees(179)) as
      Omit<MovementState, "headingRadians"> & { headingRadians?: number };
    delete legacy.headingRadians;

    const crossed = advance(
      start,
      legacy as MovementState,
      [input(1, {
        type: "walk_direction",
        direction: directionAtDegrees(-179),
      })],
      0,
    );

    expect(crossed.movement.headingRadians).toBeCloseTo(radians(181), 10);
  });

  it("drives an arc instead of strafing when thrusting and turning", () => {
    const start = { x: 50, y: 80 };
    const first = advance(
      start,
      createMovementState({ x: 0, y: -1 }),
      [input(1, {
        type: "tank_drive",
        throttle: 1,
        steering: 1,
      })],
      0.1,
    );
    const second = advance(first.position, first.movement, [], 0.1);

    expect(first.position.x).toBeGreaterThan(start.x);
    expect(first.position.y).toBeLessThan(start.y);
    expect(second.position.x).toBeGreaterThan(first.position.x);
    expect(second.position.y).toBeLessThan(first.position.y);
    expect(second.movement.facing.x).toBeGreaterThan(first.movement.facing.x);
  });

  it("reverses along the facing without flipping the astronaut", () => {
    const start = { x: 50, y: 80 };
    const reversed = advance(
      start,
      createMovementState({ x: 0, y: -1 }),
      [input(1, {
        type: "tank_drive",
        throttle: -1,
        steering: 0,
      })],
      0.1,
    );

    expect(reversed.position.y).toBeGreaterThan(start.y);
    expect(reversed.movement.facing).toEqual({ x: 0, y: -1 });
    expect(reversed.movement.direction.x).toBeCloseTo(0, 10);
    expect(reversed.movement.direction.y).toBeCloseTo(1, 10);
    expect(reversed.movement.forwardSpeed).toBeLessThan(0);
  });

  it("eases forward and angular speed to zero while charging through a turn", () => {
    const start = { x: 50, y: 100 };
    const driving = advance(
      start,
      createMovementState({ x: 0, y: -1 }),
      [input(1, {
        type: "tank_drive",
        throttle: 1,
        steering: 1,
      })],
      0.3,
    );
    let charging = advance(
      driving.position,
      driving.movement,
      [input(2, {
        type: "tank_charge",
        throttle: 1,
        steering: 1,
      })],
      0.1,
    );
    const angularSpeeds = [Math.abs(charging.movement.angularVelocity)];
    const forwardSpeeds = [Math.abs(charging.movement.forwardSpeed)];
    const headings = [charging.movement.headingRadians];
    for (let step = 1; step < 18; step += 1) {
      charging = advance(charging.position, charging.movement, [], 0.1);
      angularSpeeds.push(Math.abs(charging.movement.angularVelocity));
      forwardSpeeds.push(Math.abs(charging.movement.forwardSpeed));
      headings.push(charging.movement.headingRadians);
    }

    expect(charging.movement.chargeSeconds).toBeCloseTo(
      MOVEMENT_RULES.fullChargeSeconds,
      10,
    );
    expect(charging.movement.angularVelocity).toBeCloseTo(0, 10);
    expect(charging.movement.forwardSpeed).toBeCloseTo(0, 10);
    for (let index = 1; index < angularSpeeds.length; index += 1) {
      expect(angularSpeeds[index]).toBeLessThanOrEqual(angularSpeeds[index - 1]);
      expect(forwardSpeeds[index]).toBeLessThanOrEqual(forwardSpeeds[index - 1]);
      expect(headings[index]).toBeGreaterThanOrEqual(headings[index - 1]);
    }
    expect(headings.at(-1)).toBeGreaterThan(headings[0]);
    expect(charging.movement.facing.x).toBeCloseTo(
      Math.cos(charging.movement.headingRadians),
      10,
    );
    expect(charging.movement.facing.y).toBeCloseTo(
      Math.sin(charging.movement.headingRadians),
      10,
    );

    const released = advance(
      charging.position,
      charging.movement,
      [input(3, { type: "tank_release" })],
      0,
    );
    expect(released.movement.mode).toBe("burst");
    expect(released.movement.direction.x).toBeCloseTo(
      charging.movement.facing.x,
      10,
    );
    expect(released.movement.direction.y).toBeCloseTo(
      charging.movement.facing.y,
      10,
    );
  });

  it("preserves one authoritative tank step for a tap inside one tick", () => {
    const start = { x: 50, y: 80 };
    const tapped = advance(
      start,
      createMovementState({ x: 0, y: -1 }),
      [
        input(1, { type: "tank_drive", throttle: 1, steering: 0 }),
        input(2, { type: "stop" }),
      ],
      1 / 20,
    );

    expect(tapped.position.y).toBeLessThan(start.y);
    expect(tapped.movement).toMatchObject({
      mode: "idle",
      tankThrottle: 0,
      tankSteering: 0,
      lastCommandSequence: 2,
    });
  });

  it("preserves a quick steering tap while forward thrust remains held", () => {
    const start = { x: 50, y: 80 };
    const tapped = advance(
      start,
      createMovementState({ x: 0, y: -1 }),
      [
        input(1, { type: "tank_drive", throttle: 1, steering: 0 }),
        input(2, { type: "tank_drive", throttle: 1, steering: -1 }),
        input(3, { type: "tank_drive", throttle: 1, steering: 0 }),
      ],
      1 / 20,
    );

    expect(tapped.movement.facing.x).toBeLessThan(0);
    expect(tapped.movement).toMatchObject({
      mode: "walking",
      tankThrottle: 1,
      tankSteering: 0,
      lastCommandSequence: 3,
    });
  });

  it("preserves a quick thrust tap while steering remains held", () => {
    const start = { x: 50, y: 80 };
    const tapped = advance(
      start,
      createMovementState({ x: 0, y: -1 }),
      [
        input(1, { type: "tank_drive", throttle: 0, steering: -1 }),
        input(2, { type: "tank_drive", throttle: 1, steering: -1 }),
        input(3, { type: "tank_drive", throttle: 0, steering: -1 }),
      ],
      1 / 20,
    );

    expect(distanceBetween(start, tapped.position)).toBeGreaterThan(0);
    expect(tapped.movement).toMatchObject({
      mode: "walking",
      tankThrottle: 0,
      tankSteering: -1,
      lastCommandSequence: 3,
    });
  });

  it("preserves one authoritative step for a keyboard tap inside one tick", () => {
    const start = { x: 50, y: 80 };
    const tickSeconds = 1 / 20;
    const direction = input(1, {
      type: "walk_direction",
      direction: { x: 0, y: -1 },
    });
    const stop = input(2, { type: "stop" });
    const batched = advance(
      start,
      createMovementState({ x: 0, y: -1 }),
      [direction, stop],
      tickSeconds,
    );

    expect(batched.position.y).toBeCloseTo(
      start.y - MOVEMENT_RULES.walkAcceleration * tickSeconds * tickSeconds,
      10,
    );
    expect(batched.movement).toMatchObject({
      mode: "idle",
      target: null,
      lastCommandSequence: 2,
    });

    const afterBatchedStop = advance(
      batched.position,
      batched.movement,
      [],
      tickSeconds,
    );
    const pressed = advance(
      start,
      createMovementState({ x: 0, y: -1 }),
      [direction],
      tickSeconds,
    );
    const stoppedOnNextTick = advance(
      pressed.position,
      pressed.movement,
      [stop],
      tickSeconds,
    );
    expect(afterBatchedStop).toEqual(stoppedOnNextTick);
  });

  it("does not let tap handling create time or use stale commands", () => {
    const start = { x: 50, y: 80 };
    const idle = createMovementState({ x: 0, y: -1 });
    const direction = { type: "walk_direction", direction: { x: 1, y: 0 } } as const;

    const zeroTime = advance(
      start,
      idle,
      [input(1, direction), input(2, { type: "stop" })],
      0,
    );
    expect(zeroTime.position).toEqual(start);
    expect(zeroTime.movement).toMatchObject({ mode: "idle", lastCommandSequence: 2 });

    const staleStop = advance(
      start,
      idle,
      [input(2, direction), input(1, { type: "stop" })],
      1 / 20,
    );
    expect(staleStop.movement.mode).toBe("walking");
    expect(staleStop.movement.lastCommandSequence).toBe(2);

    const pointerTap = advance(
      start,
      idle,
      [
        input(1, { type: "walk", target: { x: 90, y: 80 } }),
        input(2, { type: "stop" }),
      ],
      1 / 20,
    );
    expect(pointerTap.position).toEqual(start);

    const repeated = advance(
      start,
      idle,
      [
        input(1, direction),
        input(2, { type: "stop" }),
        input(3, direction),
        input(4, { type: "stop" }),
      ],
      1 / 20,
    );
    expect(distanceBetween(start, repeated.position)).toBeLessThanOrEqual(
      MOVEMENT_RULES.walkMaximumSpeed / 20,
    );
    expect(repeated.movement).toMatchObject({ mode: "idle", lastCommandSequence: 4 });
  });

  it("accelerates and decelerates smoothly while gait phase follows distance", () => {
    const start = { x: 10, y: 80 };
    const target = { x: 90, y: 80 };
    const stepSeconds = 0.025;

    const first = advance(
      start,
      createMovementState({ x: 1, y: 0 }),
      [input(1, { type: "walk", target })],
      stepSeconds,
    );
    const second = advance(first.position, first.movement, [], stepSeconds);
    const third = advance(second.position, second.movement, [], stepSeconds);

    expect(first.movement.velocity.x).toBeCloseTo(
      MOVEMENT_RULES.walkAcceleration * stepSeconds,
      8,
    );
    expect(second.movement.velocity.x).toBeCloseTo(
      MOVEMENT_RULES.walkAcceleration * stepSeconds * 2,
      8,
    );
    expect(third.movement.velocity.x).toBeCloseTo(
      Math.min(
        MOVEMENT_RULES.walkMaximumSpeed,
        MOVEMENT_RULES.walkAcceleration * stepSeconds * 3,
      ),
      8,
    );
    expect(first.movement.velocity.x).toBeLessThan(second.movement.velocity.x);
    expect(second.movement.velocity.x).toBeLessThan(third.movement.velocity.x);

    const expectedPhase =
      ((third.movement.gaitDistance / MOVEMENT_RULES.stepCycleDistance) * TAU) % TAU;
    expect(third.movement.gaitPhase).toBeCloseTo(expectedPhase, 10);
    expect(Math.sin(third.movement.gaitPhase)).toBeCloseTo(
      Math.sin(expectedPhase),
      10,
    );

    const slowing = advance(
      third.position,
      third.movement,
      [input(2, { type: "stop" })],
      stepSeconds,
    );
    const stopped = advance(slowing.position, slowing.movement, [], 0.2);
    expect(slowing.movement.velocity.x).toBeGreaterThan(0);
    expect(slowing.movement.velocity.x).toBeLessThan(third.movement.velocity.x);
    expect(stopped.movement.velocity).toEqual({ x: 0, y: 0 });
  });

  it("keeps the original step-animation cadence at the faster walk speed", () => {
    expect(
      MOVEMENT_RULES.walkMaximumSpeed / MOVEMENT_RULES.stepCycleDistance,
    ).toBeCloseTo(10 / 7.5, 10);
  });

  it("keeps steady walking distance and gait phase independent of frame partition", () => {
    function walkAt(frameSeconds: number) {
      let position = { x: 10, y: 80 };
      let movement: MovementState = {
        ...createMovementState({ x: 1, y: 0 }),
        mode: "walking",
        target: { x: 90, y: 80 },
        velocity: { x: MOVEMENT_RULES.walkMaximumSpeed, y: 0 },
      };
      const frames = Math.round(1 / frameSeconds);
      for (let frame = 0; frame < frames; frame += 1) {
        const step = advance(position, movement, [], frameSeconds);
        position = step.position;
        movement = step.movement;
      }
      return { position, movement };
    }

    const at20Fps = walkAt(1 / 20);
    const at60Fps = walkAt(1 / 60);
    const at120Fps = walkAt(1 / 120);

    for (const result of [at20Fps, at60Fps, at120Fps]) {
      expect(result.position.x).toBeCloseTo(
        10 + MOVEMENT_RULES.walkMaximumSpeed,
        9,
      );
      expect(result.position.y).toBeCloseTo(80, 9);
      expect(result.movement.gaitDistance).toBeCloseTo(
        MOVEMENT_RULES.walkMaximumSpeed,
        9,
      );
      expect(result.movement.gaitPhase).toBeCloseTo(
        ((MOVEMENT_RULES.walkMaximumSpeed / MOVEMENT_RULES.stepCycleDistance) * TAU) % TAU,
        9,
      );
    }
  });

  it("slows during charge and clamps at the configured ready time", () => {
    const start = { x: 10, y: 80 };
    const moving: MovementState = {
      ...createMovementState({ x: 1, y: 0 }),
      mode: "walking",
      target: { x: 90, y: 80 },
      velocity: { x: MOVEMENT_RULES.walkMaximumSpeed, y: 0 },
    };

    const charging = advance(
      start,
      moving,
      [input(1, { type: "charge", target: { x: 90, y: 80 } })],
      0.25,
    );
    expect(charging.movement.mode).toBe("charging");
    expect(charging.movement.chargeSeconds).toBeCloseTo(0.25, 10);
    expect(charging.movement.velocity.x).toBeGreaterThan(0);
    expect(charging.movement.velocity.x).toBeLessThan(MOVEMENT_RULES.walkMaximumSpeed);

    const full = advance(
      charging.position,
      charging.movement,
      [],
      MOVEMENT_RULES.fullChargeSeconds,
    );
    const overheld = advance(full.position, full.movement, [], 5);
    const promptToReadySeconds =
      MOVEMENT_RULES.gestureArmMs / 1_000 + MOVEMENT_RULES.fullChargeSeconds;
    expect(promptToReadySeconds).toBeCloseTo(0.92, 10);
    expect(promptToReadySeconds).toBeLessThan(1);
    expect(full.movement.chargeSeconds).toBe(MOVEMENT_RULES.fullChargeSeconds);
    expect(overheld.movement.chargeSeconds).toBe(MOVEMENT_RULES.fullChargeSeconds);
    expect(overheld.movement.velocity).toEqual({ x: 0, y: 0 });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.1])(
    "does not advance a new charge with an invalid elapsed time of %s",
    (deltaSeconds) => {
      const start = { x: 20, y: 80 };
      const charging = advance(
        start,
        createMovementState({ x: 1, y: 0 }),
        [input(1, { type: "tank_charge", throttle: 1, steering: 0 })],
        deltaSeconds,
      );

      expect(charging.position).toEqual(start);
      expect(charging.movement.mode).toBe("charging");
      expect(charging.movement.chargeSeconds).toBe(0);
      expect(Object.values(charging.movement.velocity).every(Number.isFinite))
        .toBe(true);
    },
  );

  it("preserves accumulated charge when steering updates arrive", () => {
    const start = { x: 20, y: 80 };
    const began = advance(
      start,
      createMovementState({ x: 1, y: 0 }),
      [input(1, { type: "tank_charge", throttle: 1, steering: 0 })],
      0.1,
    );
    const steered = advance(
      began.position,
      began.movement,
      [input(2, { type: "tank_charge", throttle: 1, steering: 1 })],
      0.1,
    );

    expect(steered.movement.mode).toBe("charging");
    expect(steered.movement.chargeSeconds).toBeCloseTo(0.2, 10);
    expect(steered.movement.tankSteering).toBe(1);
  });

  it("cannot create an accidental burst from charge and release in one tick", () => {
    const start = { x: 20, y: 80 };
    const result = advance(
      start,
      createMovementState({ x: 1, y: 0 }),
      [
        input(1, { type: "tank_charge", throttle: 1, steering: 0 }),
        input(2, { type: "tank_release" }),
      ],
      0.05,
    );

    expect(result.position).toEqual(start);
    expect(result.movement.mode).toBe("idle");
    expect(result.movement.chargeSeconds).toBe(0);
    expect(result.movement.burstDistanceRemaining).toBe(0);
  });

  it("releases at the inclusive minimum-charge boundary", () => {
    const start = { x: 20, y: 80 };
    const charged = chargeAt(
      start,
      { x: 100, y: 80 },
      MOVEMENT_RULES.minimumBurstChargeSeconds,
    );
    const released = advance(
      charged.position,
      charged.movement,
      [input(2, { type: "release", target: { x: 100, y: 80 } })],
      0,
    );

    expect(released.movement.mode).toBe("burst");
    expect(released.movement.burstDistanceRemaining).toBeGreaterThanOrEqual(
      MOVEMENT_RULES.minimumBurstDistance,
    );
  });

  it("launches along the final direct-target vector supplied at release", () => {
    const start = { x: 50, y: 80 };
    const initiallyAimedRight = chargeAt(
      start,
      { x: 90, y: 80 },
      MOVEMENT_RULES.fullChargeSeconds,
    );
    const releasedTowardTouch = advance(
      initiallyAimedRight.position,
      initiallyAimedRight.movement,
      [input(2, { type: "release", target: { x: 50, y: 120 } })],
      0,
    );

    expect(releasedTowardTouch.movement.mode).toBe("burst");
    expect(releasedTowardTouch.movement.direction.x).toBeCloseTo(0, 10);
    expect(releasedTowardTouch.movement.direction.y).toBeCloseTo(1, 10);
    expect(releasedTowardTouch.movement.velocity.x).toBeCloseTo(0, 10);
    expect(releasedTowardTouch.movement.velocity.y).toBeCloseTo(
      MOVEMENT_RULES.burstSpeed,
      10,
    );
  });

  it.each([
    { label: "partial", seconds: MOVEMENT_RULES.fullChargeSeconds / 2, expected: 20.8 },
    { label: "full", seconds: MOVEMENT_RULES.fullChargeSeconds, expected: 35.1 },
  ])("turns a $label charge into one burst", ({ seconds, expected }) => {
    const start = { x: 20, y: 80 };
    const charged = chargeAt(start, { x: 100, y: 80 }, seconds);
    const released = advance(
      charged.position,
      charged.movement,
      [input(2, { type: "release", target: { x: 100, y: 80 } })],
      0,
    );

    expect(released.movement.mode).toBe("burst");
    expect(released.movement.burstDistanceTotal).toBeCloseTo(expected, 8);
    expect(released.movement.burstDistanceRemaining).toBeCloseTo(expected, 8);

    const completed = advance(
      released.position,
      released.movement,
      [],
      expected / MOVEMENT_RULES.burstSpeed,
    );
    const repeated = advance(
      completed.position,
      completed.movement,
      [
        input(2, { type: "release", target: { x: 100, y: 80 } }),
        input(1, { type: "charge", target: { x: 100, y: 80 } }),
      ],
      1,
    );

    expect(completed.position.x).toBeCloseTo(released.position.x + expected, 8);
    expect(completed.movement).toMatchObject({
      mode: "idle",
      chargeSeconds: 0,
      burstDistanceRemaining: 0,
      lastCommandSequence: 2,
    });
    expect(repeated.position).toEqual(completed.position);
    expect(repeated.movement.lastCommandSequence).toBe(2);
  });

  it("does not burst below the minimum charge", () => {
    const start = { x: 20, y: 80 };
    const charged = chargeAt(
      start,
      { x: 100, y: 80 },
      MOVEMENT_RULES.minimumBurstChargeSeconds / 2,
    );
    const released = advance(
      charged.position,
      charged.movement,
      [input(2, { type: "release", target: { x: 100, y: 80 } })],
      1,
    );

    expect(released.position).toEqual(charged.position);
    expect(released.movement).toMatchObject({
      mode: "idle",
      chargeSeconds: 0,
      burstDistanceRemaining: 0,
    });
  });

  it("commits to a burst and starts a queued walk after landing", () => {
    const charged = chargeAt(
      { x: 20, y: 80 },
      { x: 100, y: 80 },
      MOVEMENT_RULES.fullChargeSeconds,
    );
    const released = advance(
      charged.position,
      charged.movement,
      [input(2, { type: "release", target: { x: 100, y: 80 } })],
      0,
    );
    const landed = advance(
      released.position,
      released.movement,
      [input(3, { type: "walk", target: { x: 50, y: 120 } })],
      MOVEMENT_RULES.maximumBurstDistance / MOVEMENT_RULES.burstSpeed,
    );

    expect(landed.movement).toMatchObject({
      mode: "walking",
      target: { x: 50, y: 120 },
      lastCommandSequence: 3,
    });
    expect(landed.position.x).toBeGreaterThan(released.position.x);
  });

  it("authoritatively resumes a held keyboard direction after landing", () => {
    const start = { x: 20, y: 80 };
    const charged = advance(
      start,
      createMovementState({ x: 1, y: 0 }),
      [input(1, { type: "charge_direction", direction: { x: 1, y: 0 } })],
      MOVEMENT_RULES.fullChargeSeconds,
    );
    const releasedAndHeld = advance(
      charged.position,
      charged.movement,
      [
        input(2, { type: "release_direction", direction: { x: 1, y: 0 } }),
        input(3, { type: "walk_direction", direction: { x: 0, y: -1 } }),
      ],
      0,
    );

    expect(releasedAndHeld.movement).toMatchObject({
      mode: "burst",
      target: null,
      queuedDirection: { x: 0, y: -1 },
      lastCommandSequence: 3,
    });

    const landed = advance(
      releasedAndHeld.position,
      releasedAndHeld.movement,
      [],
      MOVEMENT_RULES.maximumBurstDistance / MOVEMENT_RULES.burstSpeed,
    );
    expect(landed.movement).toMatchObject({
      mode: "walking",
      target: null,
      queuedDirection: null,
      direction: { x: 0, y: -1 },
      lastCommandSequence: 3,
    });

    const continued = advance(landed.position, landed.movement, [], 0.1);
    expect(continued.position.y).toBeLessThan(landed.position.y);
  });

  it("aligns a queued direction across the angle seam when a burst lands", () => {
    const start = { x: 50, y: 80 };
    const burstFacing = directionAtDegrees(179);
    const charged: MovementState = {
      ...createMovementState(burstFacing),
      mode: "charging",
      direction: burstFacing,
      facing: burstFacing,
      headingRadians: 2 * TAU + radians(179),
      chargeSeconds: MOVEMENT_RULES.fullChargeSeconds,
    };
    const queuedDirection = directionAtDegrees(-179);
    const releasedAndQueued = advance(
      start,
      charged,
      [
        input(1, { type: "tank_release" }),
        input(2, { type: "walk_direction", direction: queuedDirection }),
      ],
      0,
    );
    const landed = advance(
      releasedAndQueued.position,
      releasedAndQueued.movement,
      [],
      MOVEMENT_RULES.maximumBurstDistance / MOVEMENT_RULES.burstSpeed,
    );

    expect(landed.movement).toMatchObject({
      mode: "walking",
      direction: queuedDirection,
      facing: queuedDirection,
      queuedDirection: null,
    });
    expect(landed.movement.headingRadians).toBeCloseTo(
      2 * TAU + radians(181),
      10,
    );
  });

  it("queues held tank controls during a burst and resumes them on landing", () => {
    const start = { x: 50, y: 100 };
    const charged = advance(
      start,
      createMovementState({ x: 0, y: -1 }),
      [input(1, {
        type: "tank_charge",
        throttle: 1,
        steering: 1,
      })],
      MOVEMENT_RULES.fullChargeSeconds,
    );
    const releasedAndHeld = advance(
      charged.position,
      charged.movement,
      [
        input(2, { type: "tank_release" }),
        input(3, { type: "tank_drive", throttle: 0, steering: 1 }),
      ],
      0,
    );

    expect(releasedAndHeld.movement).toMatchObject({
      mode: "burst",
      queuedTankInput: { throttle: 0, steering: 1 },
      lastCommandSequence: 3,
    });
    const landed = advance(
      releasedAndHeld.position,
      releasedAndHeld.movement,
      [],
      MOVEMENT_RULES.maximumBurstDistance / MOVEMENT_RULES.burstSpeed,
    );
    expect(landed.movement).toMatchObject({
      mode: "walking",
      tankThrottle: 0,
      tankSteering: 1,
      queuedTankInput: null,
      chargeSeconds: 0,
    });
    const turning = advance(landed.position, landed.movement, [], 0.1);
    expect(turning.position).toEqual(landed.position);
    expect(turning.movement.angularVelocity).toBeGreaterThan(0);
  });

  it("never turns a stale charge command during a burst into a chained charge", () => {
    const start = { x: 50, y: 100 };
    const charged = advance(
      start,
      createMovementState({ x: 0, y: -1 }),
      [input(1, { type: "tank_charge", throttle: 1, steering: 0 })],
      MOVEMENT_RULES.fullChargeSeconds,
    );
    const released = advance(
      charged.position,
      charged.movement,
      [input(2, { type: "tank_release" })],
      0,
    );
    const staleCharge = advance(
      released.position,
      released.movement,
      [input(3, { type: "tank_charge", throttle: 1, steering: 1 })],
      0,
    );
    const landed = advance(
      staleCharge.position,
      staleCharge.movement,
      [],
      MOVEMENT_RULES.maximumBurstDistance / MOVEMENT_RULES.burstSpeed,
    );

    expect(staleCharge.movement.mode).toBe("burst");
    expect(staleCharge.movement.queuedTankInput).toBeNull();
    expect(landed.movement).toMatchObject({
      mode: "idle",
      chargeSeconds: 0,
      queuedTankInput: null,
    });
  });

  it("clears a queued keyboard direction when the held key is released in flight", () => {
    const start = { x: 20, y: 80 };
    const charged = advance(
      start,
      createMovementState({ x: 1, y: 0 }),
      [input(1, { type: "charge_direction", direction: { x: 1, y: 0 } })],
      MOVEMENT_RULES.fullChargeSeconds,
    );
    const releasedThenStopped = advance(
      charged.position,
      charged.movement,
      [
        input(2, { type: "release_direction", direction: { x: 1, y: 0 } }),
        input(3, { type: "walk_direction", direction: { x: 0, y: -1 } }),
        input(4, { type: "stop" }),
      ],
      0,
    );

    expect(releasedThenStopped.movement).toMatchObject({
      mode: "burst",
      target: null,
      queuedDirection: null,
      lastCommandSequence: 4,
    });
    const landed = advance(
      releasedThenStopped.position,
      releasedThenStopped.movement,
      [],
      MOVEMENT_RULES.maximumBurstDistance / MOVEMENT_RULES.burstSpeed,
    );
    expect(landed.movement.mode).toBe("idle");
  });

  it("does not retain stale queued walking when a boost release arrives in flight", () => {
    const start = { x: 20, y: 80 };
    const charged = advance(
      start,
      createMovementState({ x: 1, y: 0 }),
      [input(1, { type: "charge_direction", direction: { x: 1, y: 0 } })],
      MOVEMENT_RULES.fullChargeSeconds,
    );
    const released = advance(
      charged.position,
      charged.movement,
      [input(2, { type: "release_direction", direction: { x: 1, y: 0 } })],
      0,
    );
    const staleGesture = advance(
      released.position,
      released.movement,
      [
        input(3, { type: "walk_direction", direction: { x: 0, y: -1 } }),
        input(4, { type: "charge_direction", direction: { x: 0, y: -1 } }),
        input(5, { type: "release_direction", direction: { x: 0, y: -1 } }),
      ],
      0,
    );

    expect(staleGesture.movement).toMatchObject({
      mode: "burst",
      target: null,
      queuedDirection: null,
      lastCommandSequence: 5,
    });
    const landed = advance(
      staleGesture.position,
      staleGesture.movement,
      [],
      MOVEMENT_RULES.maximumBurstDistance / MOVEMENT_RULES.burstSpeed,
    );
    expect(landed.movement.mode).toBe("idle");
  });

  it.each([
    { start: { x: 99, y: 80 }, target: { x: 100, y: 80 }, end: { x: 100, y: 80 } },
    { start: { x: 1, y: 80 }, target: { x: 0, y: 80 }, end: { x: 0, y: 80 } },
    { start: { x: 50, y: 159 }, target: { x: 50, y: 160 }, end: { x: 50, y: 160 } },
    { start: { x: 50, y: 1 }, target: { x: 50, y: 0 }, end: { x: 50, y: 0 } },
    { start: { x: 99, y: 159 }, target: { x: 100, y: 160 }, end: { x: 100, y: 160 } },
  ])("clamps a full burst at world boundary $end", ({ start, target, end }) => {
    const charged = chargeAt(start, target, MOVEMENT_RULES.fullChargeSeconds);
    const completed = advance(
      charged.position,
      charged.movement,
      [input(2, { type: "release", target })],
      1,
    );

    expect(completed.position).toEqual(end);
    expect(completed.movement.mode).toBe("idle");
    expect(completed.movement.burstDistanceRemaining).toBe(0);
  });
});

function distanceBetween(a: Vec2, b: Vec2) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function radians(degrees: number) {
  return degrees * Math.PI / 180;
}

function directionAtDegrees(degrees: number): Vec2 {
  const angle = radians(degrees);
  return { x: Math.cos(angle), y: Math.sin(angle) };
}
