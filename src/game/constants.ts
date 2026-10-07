export const WORLD = {
  width: 100,
  height: 160,
} as const;

export const GAME_RULES = {
  matchDurationMs: 5 * 60 * 1000,
  movementSpeed: 25,
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
