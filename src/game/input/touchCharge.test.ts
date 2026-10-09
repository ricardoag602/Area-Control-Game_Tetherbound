import { describe, expect, it } from "vitest";
import { getTouchChargeInput } from "./touchCharge";

const FACING_UP = { x: 0, y: -1 };

describe("touch charge steering", () => {
  it("holds a forward charge when the finger stays ahead", () => {
    expect(getTouchChargeInput(FACING_UP, FACING_UP, true)).toEqual({
      throttle: 1,
      steering: 0,
    });
  });

  it("turns toward an aimed point on the astronaut's left", () => {
    expect(getTouchChargeInput(FACING_UP, { x: -1, y: 0 }, true)).toEqual({
      throttle: 1,
      steering: -1,
    });
  });

  it("turns toward an aimed point on the astronaut's right", () => {
    expect(getTouchChargeInput(FACING_UP, { x: 1, y: 0 }, true)).toEqual({
      throttle: 1,
      steering: 1,
    });
  });

  it("keeps steering neutral without a deliberate aim", () => {
    expect(getTouchChargeInput(FACING_UP, { x: 1, y: 0 }, false)).toEqual({
      throttle: 1,
      steering: 0,
    });
  });

  it.each([-1, 1])(
    "ignores a %s degree wobble inside the angular dead zone",
    (degrees) => {
      const radians = degrees * Math.PI / 180;
      const aim = {
        x: Math.sin(radians),
        y: -Math.cos(radians),
      };

      expect(getTouchChargeInput(FACING_UP, aim, true)).toEqual({
        throttle: 1,
        steering: 0,
      });
    },
  );
});
