import { MOVEMENT_RULES } from "../movement/movement";
import type { MovementMode, MovementState } from "../types";

/**
 * A boost can only begin from ordinary movement. Inputs received while the
 * previous charge or launch is still committed remain movement-only inputs.
 */
export function canArmBoostCharge(mode: MovementMode) {
  return mode === "idle" || mode === "walking";
}

/**
 * Lets touch players enter the double-tap sequence just before landing. The
 * gesture may be primed in this window, but authoritative charging still waits
 * for the burst to finish.
 */
export function canPrepareTouchBoostCharge(
  movement: Pick<MovementState, "mode" | "burstDistanceRemaining">,
) {
  return getTouchBoostChargeActivation(movement) !== "blocked";
}

export type TouchBoostChargeActivation = "arm" | "prime" | "blocked";

export function getTouchBoostChargeActivation(
  movement: Pick<MovementState, "mode" | "burstDistanceRemaining">,
): TouchBoostChargeActivation {
  if (canArmBoostCharge(movement.mode)) return "arm";
  if (
    movement.mode !== "burst" ||
    !Number.isFinite(movement.burstDistanceRemaining) ||
    movement.burstDistanceRemaining < 0
  ) return "blocked";
  const leadDistance = MOVEMENT_RULES.burstSpeed *
    MOVEMENT_RULES.touchBoostRearmLeadSeconds;
  return movement.burstDistanceRemaining <= leadDistance ? "prime" : "blocked";
}
