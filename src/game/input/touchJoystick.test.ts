import { describe, expect, it } from "vitest";
import {
  getTouchJoystickDirection,
  getTouchJoystickThumbOffset,
  TOUCH_JOYSTICK_DEAD_ZONE_PX,
  TOUCH_JOYSTICK_RADIUS_PX,
  TOUCH_JOYSTICK_THUMB_RADIUS_PX,
} from "./touchJoystick";

describe("floating touch joystick", () => {
  it("keeps taps and tiny thumb motion neutral", () => {
    const origin = { x: 120, y: 240 };

    expect(getTouchJoystickDirection(origin, origin)).toBeNull();
    expect(getTouchJoystickDirection(origin, {
      x: origin.x + TOUCH_JOYSTICK_DEAD_ZONE_PX,
      y: origin.y,
    })).toBeNull();
  });

  it("normalizes a drag into a screen-space movement direction", () => {
    expect(getTouchJoystickDirection(
      { x: 40, y: 70 },
      { x: 70, y: 110 },
    )).toEqual({ x: 0.6, y: 0.8 });
  });

  it("clamps the visual thumb without changing its angle", () => {
    const offset = getTouchJoystickThumbOffset(
      { x: 0, y: 0 },
      { x: 300, y: 400 },
    );
    const maximumTravel = TOUCH_JOYSTICK_RADIUS_PX -
      TOUCH_JOYSTICK_THUMB_RADIUS_PX;

    expect(Math.hypot(offset.x, offset.y)).toBeCloseTo(maximumTravel, 10);
    expect(offset.x / offset.y).toBeCloseTo(3 / 4, 10);
  });

  it("fails neutral for invalid browser coordinates", () => {
    expect(getTouchJoystickDirection(
      { x: 10, y: 10 },
      { x: Number.NaN, y: 20 },
    )).toBeNull();
    expect(getTouchJoystickThumbOffset(
      { x: Number.POSITIVE_INFINITY, y: 10 },
      { x: 20, y: 20 },
    )).toEqual({ x: 0, y: 0 });
  });
});
