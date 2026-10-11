import type { SalvageDropEvent, WorldTimelineEvent } from "../world/timeline";

/** Long enough to notice during play, short enough to keep the map uncluttered. */
export const SUPPLY_DROP_BLIP_DURATION_MS = 1_800;

export interface SupplyDropBlip {
  event: SalvageDropEvent;
  ageMs: number;
  opacity: number;
  coreOpacity: number;
  ringHalfSize: number;
}

/**
 * Derives the transient minimap signal from authoritative match time. This
 * keeps local play, multiplayer snapshots, and reconnects on the same fade.
 */
export function calculateSupplyDropBlip(
  event: WorldTimelineEvent | null | undefined,
  elapsedMs: number,
  ticksPerSecond: number,
): SupplyDropBlip | null {
  if (
    event?.kind !== "salvage_drop" ||
    !Number.isFinite(elapsedMs) ||
    !Number.isFinite(ticksPerSecond) ||
    ticksPerSecond <= 0
  ) {
    return null;
  }

  const landedAtMs = event.scheduledTick / ticksPerSecond * 1_000;
  const ageMs = elapsedMs - landedAtMs;
  if (ageMs < 0 || ageMs >= SUPPLY_DROP_BLIP_DURATION_MS) return null;

  const progress = ageMs / SUPPLY_DROP_BLIP_DURATION_MS;
  return {
    event,
    ageMs,
    opacity: Math.pow(1 - progress, 1.2),
    coreOpacity:
      ageMs < 900 && Math.floor(ageMs / 180) % 2 === 1 ? 0.3 : 1,
    ringHalfSize: 3.5 + progress * 8,
  };
}
