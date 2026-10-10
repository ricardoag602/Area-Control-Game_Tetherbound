import { describe, expect, it } from "vitest";
import {
  canArmBoostCharge,
  canPrepareTouchBoostCharge,
  getTouchBoostChargeActivation,
} from "./chargeActivation";
import { MOVEMENT_RULES } from "../movement/movement";
import type { MovementMode } from "../types";

describe("boost charge activation", () => {
  it.each(["idle", "walking"] as const)(
    "allows a fresh double-tap or hold while %s",
    (mode) => expect(canArmBoostCharge(mode)).toBe(true),
  );

  it.each(["charging", "burst"] as const)(
    "keeps an input movement-only while the player is %s",
    (mode) => expect(canArmBoostCharge(mode)).toBe(false),
  );

  it("defines a result for every movement mode", () => {
    const modes: MovementMode[] = ["idle", "walking", "charging", "burst"];
    expect(modes.map(canArmBoostCharge)).toEqual([true, true, false, false]);
  });

  describe("touch re-arm preparation", () => {
    const leadDistance = MOVEMENT_RULES.burstSpeed *
      MOVEMENT_RULES.touchBoostRearmLeadSeconds;

    it("allows the double-tap sequence at the inclusive landing buffer", () => {
      const movement = {
        mode: "burst",
        burstDistanceRemaining: leadDistance,
      } as const;
      expect(canPrepareTouchBoostCharge(movement)).toBe(true);
      expect(getTouchBoostChargeActivation(movement)).toBe("prime");
    });

    it("rejects preparation immediately before the landing buffer", () => {
      expect(canPrepareTouchBoostCharge({
        mode: "burst",
        burstDistanceRemaining: leadDistance + 0.001,
      })).toBe(false);
    });

    it.each(["idle", "walking"] as const)(
      "remains available during ordinary %s movement",
      (mode) => {
        const movement = { mode, burstDistanceRemaining: 999 };
        expect(canPrepareTouchBoostCharge(movement)).toBe(true);
        expect(getTouchBoostChargeActivation(movement)).toBe("arm");
      },
    );

    it.each([
      { mode: "charging" as const, burstDistanceRemaining: 0 },
      { mode: "burst" as const, burstDistanceRemaining: Number.NaN },
      { mode: "burst" as const, burstDistanceRemaining: -1 },
    ])("rejects an unavailable or invalid state $mode", (movement) => {
      expect(canPrepareTouchBoostCharge(movement)).toBe(false);
      expect(getTouchBoostChargeActivation(movement)).toBe("blocked");
    });
  });
});
