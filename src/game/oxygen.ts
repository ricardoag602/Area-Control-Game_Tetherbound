/**
 * Presentation-only oxygen tuning. These values do not affect simulation or
 * oxygen consumption, so renderers are free to apply the returned effects
 * without becoming a source of gameplay state.
 */
export const OXYGEN_PRESENTATION_RULES = {
  lowOxygenThreshold: 0.4,
  maximumCameraZoomOffset: 0.05,
  maximumRedVignetteOpacity: 0.72,
  maximumRedWashOpacity: 0.14,
} as const;

export interface OxygenPresentation {
  /** Remaining oxygen from 0 (empty) to 1 (full). */
  normalizedOxygen: number;
  /** Eased warning strength from 0 (safe) to 1 (empty). */
  lowOxygenIntensity: number;
  /** Additive zoom amount, capped by maximumCameraZoomOffset. */
  cameraZoomOffset: number;
  /** Multiplier equivalent of cameraZoomOffset for renderer convenience. */
  cameraZoomMultiplier: number;
  redVignetteOpacity: number;
  redWashOpacity: number;
}

/**
 * Converts an oxygen amount and capacity into a renderer-friendly ratio.
 * Invalid capacities and NaN amounts fail to a normal, unobstructed view.
 * Infinite amounts still behave like clamped values at either endpoint.
 */
export function normalizeOxygen(
  oxygen: number,
  maximumOxygen: number,
): number {
  if (!Number.isFinite(maximumOxygen) || maximumOxygen <= 0) return 1;
  if (Number.isNaN(oxygen)) return 1;
  if (oxygen === Number.POSITIVE_INFINITY) return 1;
  if (oxygen === Number.NEGATIVE_INFINITY) return 0;

  return clamp(oxygen / maximumOxygen, 0, 1);
}

/**
 * Derives all local oxygen feedback from the same normalized source. Effects
 * begin gently below the low-oxygen threshold and remain strictly bounded at
 * zero oxygen. The wash uses a second-order curve so the outer vignette warns
 * first and the full screen only becomes noticeably red near empty.
 */
export function calculateOxygenPresentation(
  oxygen: number,
  maximumOxygen: number,
): OxygenPresentation {
  const normalizedOxygen = normalizeOxygen(oxygen, maximumOxygen);
  const threshold = OXYGEN_PRESENTATION_RULES.lowOxygenThreshold;
  const rawIntensity = clamp(
    (threshold - normalizedOxygen) / threshold,
    0,
    1,
  );
  const lowOxygenIntensity = smoothstep(rawIntensity);
  const cameraZoomOffset =
    OXYGEN_PRESENTATION_RULES.maximumCameraZoomOffset * lowOxygenIntensity;

  return {
    normalizedOxygen,
    lowOxygenIntensity,
    cameraZoomOffset,
    cameraZoomMultiplier: 1 + cameraZoomOffset,
    redVignetteOpacity:
      OXYGEN_PRESENTATION_RULES.maximumRedVignetteOpacity *
      lowOxygenIntensity,
    redWashOpacity:
      OXYGEN_PRESENTATION_RULES.maximumRedWashOpacity *
      lowOxygenIntensity *
      lowOxygenIntensity,
  };
}

function smoothstep(value: number) {
  const clamped = clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
