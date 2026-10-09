import { WORLD_BOUNDS } from "./world";

/** Shared alias retained for movement, protocol, and renderer consumers. */
export const WORLD = WORLD_BOUNDS;

export const SIMULATION_RULES = {
  ticksPerSecond: 20,
  maximumCatchUpSteps: 5,
} as const;

export const GAME_RULES = {
  matchDurationMs: 5 * 60 * 1000,
  oxygenMaximum: 100,
  oxygenDrainPerSecond: 9,
  oxygenRecoveryPerSecond: 22,
  safeZoneRadius: 18,
  maximumLinkDistance: 28,
  minimumAnchorSpacing: 7,
  collectionRadius: 3.5,
  deliveryRadius: 4.5,
  salvageCarryLimit: 3,
  salvagePerTether: 3,
  maximumAnchorsPerPlayer: 8,
} as const;
