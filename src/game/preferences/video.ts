export const VIDEO_MODE_PREFERENCE_KEY = "tetherbound.videoMode";

export type VideoMode = "quality" | "performance";

export interface VideoPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface VideoRenderProfile {
  readonly maximumDevicePixelRatio: number;
  readonly antialias: boolean;
  readonly filteredTerrainLighting: boolean;
  readonly particleEffects: boolean;
  readonly idleObjectEffects: boolean;
}

export const VIDEO_RENDER_PROFILES: Readonly<Record<VideoMode, VideoRenderProfile>> = {
  quality: {
    maximumDevicePixelRatio: 1.5,
    antialias: true,
    filteredTerrainLighting: true,
    particleEffects: true,
    idleObjectEffects: true,
  },
  performance: {
    maximumDevicePixelRatio: 1,
    antialias: false,
    filteredTerrainLighting: false,
    particleEffects: false,
    idleObjectEffects: false,
  },
};

export function getVideoRenderProfile(mode: VideoMode): VideoRenderProfile {
  return VIDEO_RENDER_PROFILES[mode];
}

/** Quality preserves the established presentation until a player opts into Performance. */
export function readVideoModePreference(
  storage?: VideoPreferenceStorage | null,
): VideoMode {
  try {
    return (storage ?? getBrowserStorage())?.getItem(VIDEO_MODE_PREFERENCE_KEY) ===
        "performance"
      ? "performance"
      : "quality";
  } catch {
    return "quality";
  }
}

export function writeVideoModePreference(
  mode: VideoMode,
  storage?: VideoPreferenceStorage | null,
): void {
  try {
    (storage ?? getBrowserStorage())?.setItem(VIDEO_MODE_PREFERENCE_KEY, mode);
  } catch {
    // The live in-memory choice still applies when storage is unavailable.
  }
}

function getBrowserStorage(): VideoPreferenceStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
