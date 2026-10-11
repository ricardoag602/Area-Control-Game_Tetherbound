import { WORLD_BOUNDS } from "./world/map";

/** Shared alias retained for movement, protocol, and renderer consumers. */
export const WORLD = WORLD_BOUNDS;

export const SIMULATION_RULES = {
  ticksPerSecond: 20,
  maximumCatchUpSteps: 5,
} as const;

export const GAME_RULES = {
  matchDurationMs: 5 * 60 * 1000,
  /** Opening portion of regulation in which territory does not score. */
  setupDurationMs: 30 * 1000,
  /** Closing portion of regulation in which territory earns bonus points. */
  scoreSurgeDurationMs: 60 * 1000,
  scoreSurgeMultiplier: 1.5,
  /** Regulation enters overtime when the scores differ by at most this ratio. */
  overtimeScoreMarginRatio: 0.03,
  overtimeDurationMs: 60 * 1000,
  /** Overtime-only score advantage required for an immediate win. */
  overtimeLeadPoints: 5,
  /** Radius of the hold zone around a vulnerable enemy base. */
  baseCollapseRadius: 8,
  baseCollapseHoldMs: 12 * 1000,
  /** Seconds of unattended capture progress lost per elapsed second. */
  baseCollapseDecayPerSecond: 1,
  /** Defender presence clears capture progress more quickly. */
  baseCollapseDefenseRecoveryPerSecond: 3,
  oxygenMaximum: 100,
  oxygenDrainPerSecond: 9,
  oxygenRecoveryPerSecond: 22,
  safeZoneRadius: 23.5,
  // Long links let one deliberate expedition create meaningful map progress.
  maximumLinkDistance: 84,
  minimumAnchorSpacing: 7,
  collectionRadius: 3.5,
  deliveryRadius: 4.5,
  salvageCarryLimit: 6,
  salvagePerTether: 3,
  /** Radius around an anchor where astronauts can overload or repair it. */
  anchorInteractionRadius: 6.5,
  /** Unopposed time required to knock an enemy anchor offline. */
  anchorOverloadSeconds: 2.1,
  /** Idle overload progress drains slowly so a committed push still matters. */
  anchorOverloadDecayPerSecond: 0.32,
  /** A nearby defender scrubs hostile progress more quickly. */
  anchorDefenseRecoveryPerSecond: 0.72,
  /** Time an overloaded anchor remains offline without an astronaut repair. */
  anchorDisruptionDurationMs: 20_000,
  /** Time required for an owner to restore a directly disrupted anchor. */
  anchorRepairSeconds: 1.35,
  anchorRepairDecayPerSecond: 0.5,
  /** Brief immunity keeps a recovered node from being camped indefinitely. */
  anchorReactivationShieldMs: 2_500,
} as const;
