import { describe, expect, it } from "vitest";
import {
  CHARGE_RADAR_RULES,
  buildChargeRadarPath,
  calculateChargeRadar,
  chargeRadarEndpoint,
} from "./chargeRadar";
import {
  advanceMovement,
  createMovementState,
  MOVEMENT_RULES,
} from "./movement";
import { WORLD } from "./constants";

function chargingMovement(chargeSeconds: number) {
  return {
    ...createMovementState({ x: 0, y: -1 }),
    mode: "charging" as const,
    tankThrottle: 1 as const,
    chargeSeconds,
  };
}

describe("charge radar", () => {
  it("shares the exact minimum and maximum launch distances", () => {
    const empty = calculateChargeRadar(chargingMovement(0));
    const full = calculateChargeRadar(
      chargingMovement(MOVEMENT_RULES.fullChargeSeconds),
    );

    expect(empty.burstDistance).toBe(MOVEMENT_RULES.minimumBurstDistance);
    expect(empty.powerRatio).toBe(0);
    expect(empty.canRelease).toBe(false);
    expect(full.burstDistance).toBe(MOVEMENT_RULES.maximumBurstDistance);
    expect(full.powerRatio).toBe(1);
    expect(full.canRelease).toBe(true);
    expect(full.outerRadius).toBe(CHARGE_RADAR_RULES.maximumOuterRadius);
  });

  it("does not promise launch reach before the minimum release charge", () => {
    const before = calculateChargeRadar(
      chargingMovement(MOVEMENT_RULES.minimumBurstChargeSeconds - 0.001),
    );
    const ready = calculateChargeRadar(
      chargingMovement(MOVEMENT_RULES.minimumBurstChargeSeconds),
    );

    expect(before.canRelease).toBe(false);
    expect(ready.canRelease).toBe(true);
    expect(ready.burstDistance).toBeGreaterThanOrEqual(
      MOVEMENT_RULES.minimumBurstDistance,
    );
  });

  it("begins as a forward semicircle and narrows with turn authority", () => {
    const early = calculateChargeRadar(chargingMovement(0));
    const later = calculateChargeRadar(chargingMovement(0.6));
    const settled = calculateChargeRadar(chargingMovement(1));
    const span = (radar: ReturnType<typeof calculateChargeRadar>) =>
      radar.maximumTurnRadians - radar.minimumTurnRadians;

    expect(span(early)).toBeCloseTo(Math.PI, 8);
    expect(span(later)).toBeGreaterThan(0);
    expect(span(later)).toBeLessThan(span(early));
    expect(span(settled)).toBeCloseTo(0, 8);
  });

  it("biases the remaining envelope in the direction of turn inertia", () => {
    const clockwise = calculateChargeRadar({
      ...chargingMovement(0.55),
      angularVelocity: Math.PI,
    });

    expect(clockwise.maximumTurnRadians).toBeGreaterThan(0);
    expect(clockwise.maximumTurnRadians).toBeGreaterThan(
      Math.abs(clockwise.minimumTurnRadians),
    );
    expect(clockwise.minimumTurnRadians).toBeLessThanOrEqual(0);
  });

  it("uses terrain turn authority when predicting the remaining envelope", () => {
    const movement = chargingMovement(0.7);
    const normal = calculateChargeRadar(movement, 1);
    const slowed = calculateChargeRadar(movement, 0.55);
    const span = (radar: ReturnType<typeof calculateChargeRadar>) =>
      radar.maximumTurnRadians - radar.minimumTurnRadians;

    expect(span(slowed)).toBeLessThan(span(normal));
  });

  it("narrows monotonically through an authoritative moving turn charge", () => {
    let position = { x: 50, y: 80 };
    let movement = createMovementState({ x: 0, y: -1 });
    let sequence = 1;
    let step = advanceMovement(
      position,
      movement,
      [{
        sequence: sequence++,
        command: { type: "tank_drive", throttle: 1, steering: 1 },
      }],
      0.3,
      100,
      160,
    );
    position = step.position;
    movement = step.movement;
    let previousSpan = Number.POSITIVE_INFINITY;

    for (let index = 0; index < 20; index += 1) {
      step = advanceMovement(
        position,
        movement,
        index === 0
          ? [{
              sequence: sequence++,
              command: { type: "tank_charge", throttle: 1, steering: 1 },
            }]
          : [],
        0.05,
        100,
        160,
      );
      position = step.position;
      movement = step.movement;
      const radar = calculateChargeRadar(movement);
      const span = radar.maximumTurnRadians - radar.minimumTurnRadians;
      expect(span).toBeLessThanOrEqual(previousSpan + 0.000001);
      previousSpan = span;
    }

    expect(previousSpan).toBeCloseTo(0, 8);
  });

  it("points reverse-charge reach behind the astronaut", () => {
    const radar = calculateChargeRadar({
      ...chargingMovement(0.5),
      tankThrottle: -1,
      direction: { x: 0, y: 1 },
      facing: { x: 0, y: -1 },
    });
    const endpoint = chargeRadarEndpoint({ x: 50, y: 80 }, radar);

    expect(endpoint.x).toBeCloseTo(50, 8);
    expect(endpoint.y).toBeGreaterThan(80);
  });

  it("gives touch and keyboard charges the same visible steering envelope", () => {
    const keyboard = calculateChargeRadar(chargingMovement(0.5));
    // Touch uses the same tank-charge state after its hold gesture arms.
    const touch = calculateChargeRadar({
      ...chargingMovement(0.5),
      tankThrottle: 1,
      tankSteering: 0,
      direction: { x: -1, y: 0.000000001 },
      facing: { x: -1, y: 0.000000001 },
    });
    const path = buildChargeRadarPath({ x: 1, y: 1 }, touch);
    const endpoint = chargeRadarEndpoint({ x: 1, y: 1 }, touch);

    expect(touch.maximumTurnRadians - touch.minimumTurnRadians).toBeCloseTo(
      keyboard.maximumTurnRadians - keyboard.minimumTurnRadians,
      8,
    );
    expect(touch.maximumTurnRadians - touch.minimumTurnRadians).toBeGreaterThan(0);
    expect(touch.powerRatio).toBeCloseTo(keyboard.powerRatio, 10);
    expect(touch.canRelease).toBe(keyboard.canRelease);
    expect(path).not.toMatch(/NaN|Infinity/);
    expect(Number.isFinite(endpoint.x)).toBe(true);
    expect(Number.isFinite(endpoint.y)).toBe(true);
    expect(path.startsWith("M ")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
  });

  it("clips the projected endpoint to the arena boundary", () => {
    const radar = calculateChargeRadar({
      ...chargingMovement(MOVEMENT_RULES.fullChargeSeconds),
      direction: { x: 1, y: 0 },
    });
    const endpoint = chargeRadarEndpoint({ x: WORLD.width - 2, y: 80 }, radar);

    expect(endpoint).toEqual({ x: WORLD.width, y: 80 });
  });

  it("falls back from a malformed direction without emitting invalid reach", () => {
    const radar = calculateChargeRadar({
      ...chargingMovement(0.5),
      direction: { x: Number.NaN, y: Number.POSITIVE_INFINITY },
    });
    const endpoint = chargeRadarEndpoint({ x: 50, y: 80 }, radar);

    expect(radar.travelDirection).toEqual({ x: 0, y: -1 });
    expect(Number.isFinite(endpoint.x)).toBe(true);
    expect(Number.isFinite(endpoint.y)).toBe(true);
  });
});
