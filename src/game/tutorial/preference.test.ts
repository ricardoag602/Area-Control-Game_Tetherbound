import { describe, expect, it, vi } from "vitest";
import {
  TUTORIAL_PREFERENCE_KEY,
  TUTORIAL_RECOMMENDATION_DISMISSED_KEY,
  readTutorialRecommendationDismissed,
  readTutorialPreference,
  writeTutorialRecommendationDismissed,
  writeTutorialPreference,
  type TutorialPreferenceStorage,
} from "./preference";

describe("tutorial preference", () => {
  it("defaults to enabled when no preference was saved", () => {
    const storage = createStorage(null);

    expect(readTutorialPreference(storage)).toBe(true);
    expect(storage.getItem).toHaveBeenCalledWith(TUTORIAL_PREFERENCE_KEY);
  });

  it("only disables for the exact persisted value false", () => {
    expect(readTutorialPreference(createStorage("false"))).toBe(false);
    expect(readTutorialPreference(createStorage("FALSE"))).toBe(true);
    expect(readTutorialPreference(createStorage(" false"))).toBe(true);
    expect(readTutorialPreference(createStorage("0"))).toBe(true);
  });

  it("persists explicit boolean strings", () => {
    const storage = createStorage(null);

    writeTutorialPreference(false, storage);
    expect(storage.setItem).toHaveBeenLastCalledWith(TUTORIAL_PREFERENCE_KEY, "false");

    writeTutorialPreference(true, storage);
    expect(storage.setItem).toHaveBeenLastCalledWith(TUTORIAL_PREFERENCE_KEY, "true");
  });

  it("keeps the recommendation visible until it is explicitly dismissed", () => {
    expect(readTutorialRecommendationDismissed(createStorage(null))).toBe(false);
    expect(readTutorialRecommendationDismissed(createStorage("false"))).toBe(false);
    expect(readTutorialRecommendationDismissed(createStorage("true"))).toBe(true);
  });

  it("persists recommendation dismissal separately from the guide setting", () => {
    const storage = createStorage(null);

    writeTutorialRecommendationDismissed(true, storage);

    expect(storage.setItem).toHaveBeenCalledWith(
      TUTORIAL_RECOMMENDATION_DISMISSED_KEY,
      "true",
    );
  });

  it("falls back safely when reading or writing storage throws", () => {
    const storage: TutorialPreferenceStorage = {
      getItem: vi.fn(() => {
        throw new DOMException("blocked", "SecurityError");
      }),
      setItem: vi.fn(() => {
        throw new DOMException("blocked", "SecurityError");
      }),
    };

    expect(readTutorialPreference(storage)).toBe(true);
    expect(() => writeTutorialPreference(false, storage)).not.toThrow();
    expect(readTutorialRecommendationDismissed(storage)).toBe(false);
    expect(() => writeTutorialRecommendationDismissed(true, storage)).not.toThrow();
  });
});

function createStorage(value: string | null): TutorialPreferenceStorage {
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn(),
  };
}
