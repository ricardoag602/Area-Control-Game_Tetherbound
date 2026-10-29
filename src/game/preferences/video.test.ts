import { describe, expect, it, vi } from "vitest";
import {
  VIDEO_MODE_PREFERENCE_KEY,
  getVideoRenderProfile,
  readVideoModePreference,
  writeVideoModePreference,
  type VideoPreferenceStorage,
} from "./video";

describe("video mode preference", () => {
  it("defaults to the established quality presentation", () => {
    const storage = createStorage(null);

    expect(readVideoModePreference(storage)).toBe("quality");
    expect(storage.getItem).toHaveBeenCalledWith(VIDEO_MODE_PREFERENCE_KEY);
  });

  it("only restores the exact persisted performance mode", () => {
    expect(readVideoModePreference(createStorage("performance"))).toBe("performance");
    expect(readVideoModePreference(createStorage("Performance"))).toBe("quality");
    expect(readVideoModePreference(createStorage("quality"))).toBe("quality");
  });

  it("persists either explicit mode", () => {
    const storage = createStorage(null);

    writeVideoModePreference("performance", storage);
    expect(storage.setItem).toHaveBeenLastCalledWith(
      VIDEO_MODE_PREFERENCE_KEY,
      "performance",
    );

    writeVideoModePreference("quality", storage);
    expect(storage.setItem).toHaveBeenLastCalledWith(
      VIDEO_MODE_PREFERENCE_KEY,
      "quality",
    );
  });

  it("falls back safely when storage is unavailable", () => {
    const storage: VideoPreferenceStorage = {
      getItem: vi.fn(() => {
        throw new DOMException("blocked", "SecurityError");
      }),
      setItem: vi.fn(() => {
        throw new DOMException("blocked", "SecurityError");
      }),
    };

    expect(readVideoModePreference(storage)).toBe("quality");
    expect(() => writeVideoModePreference("performance", storage)).not.toThrow();
  });

  it("uses a materially lighter renderer profile in performance mode", () => {
    const quality = getVideoRenderProfile("quality");
    const performance = getVideoRenderProfile("performance");

    expect(quality.maximumDevicePixelRatio).toBe(1.5);
    expect(quality.antialias).toBe(true);
    expect(quality.filteredTerrainLighting).toBe(true);
    expect(quality.particleEffects).toBe(true);
    expect(quality.idleObjectEffects).toBe(true);

    expect(performance.maximumDevicePixelRatio).toBe(1);
    expect(performance.antialias).toBe(false);
    expect(performance.filteredTerrainLighting).toBe(false);
    expect(performance.particleEffects).toBe(false);
    expect(performance.idleObjectEffects).toBe(false);
  });
});

function createStorage(value: string | null): VideoPreferenceStorage {
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn(),
  };
}
