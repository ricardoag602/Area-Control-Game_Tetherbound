import { describe, expect, it } from "vitest";
import {
  advanceMovement,
  createMovementState,
  MOVEMENT_RULES,
} from "./movement";
import type { GameInput, MovementState, Vec2 } from "./types";

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

    const first = advance(
      start,
      createMovementState({ x: 1, y: 0 }),
      [input(1, { type: "walk", target })],
      0.1,
    );
    const second = advance(first.position, first.movement, [], 0.1);
    const third = advance(second.position, second.movement, [], 0.1);

    expect(first.movement.velocity.x).toBeCloseTo(8, 8);
    expect(second.movement.velocity.x).toBeCloseTo(16, 8);
    expect(third.movement.velocity.x).toBeCloseTo(24, 8);
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
      0.1,
    );
    const stopped = advance(slowing.position, slowing.movement, [], 0.2);
    expect(slowing.movement.velocity.x).toBeGreaterThan(0);
    expect(slowing.movement.velocity.x).toBeLessThan(third.movement.velocity.x);
    expect(stopped.movement.velocity).toEqual({ x: 0, y: 0 });
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
      expect(result.position.x).toBeCloseTo(35, 9);
      expect(result.position.y).toBeCloseTo(80, 9);
      expect(result.movement.gaitDistance).toBeCloseTo(25, 9);
      expect(result.movement.gaitPhase).toBeCloseTo(
        ((25 / MOVEMENT_RULES.stepCycleDistance) * TAU) % TAU,
        9,
      );
    }
  });

  it("slows during charge and clamps authoritative charge at 1.8 seconds", () => {
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
    expect(MOVEMENT_RULES.gestureArmMs / 1_000 + MOVEMENT_RULES.fullChargeSeconds).toBe(2);
    expect(full.movement.chargeSeconds).toBe(MOVEMENT_RULES.fullChargeSeconds);
    expect(overheld.movement.chargeSeconds).toBe(MOVEMENT_RULES.fullChargeSeconds);
    expect(overheld.movement.velocity).toEqual({ x: 0, y: 0 });
  });

  it.each([
    { label: "partial", seconds: MOVEMENT_RULES.fullChargeSeconds / 2, expected: 14.5 },
    { label: "full", seconds: MOVEMENT_RULES.fullChargeSeconds, expected: 24 },
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
