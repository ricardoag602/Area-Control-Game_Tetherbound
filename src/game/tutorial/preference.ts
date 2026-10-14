export const TUTORIAL_PREFERENCE_KEY = "tetherbound.tutorialEnabled";

export interface TutorialPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The guide is opt-out: only the exact persisted value "false" disables it. */
export function readTutorialPreference(
  storage?: TutorialPreferenceStorage | null,
): boolean {
  try {
    return (storage ?? getBrowserStorage())?.getItem(TUTORIAL_PREFERENCE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function writeTutorialPreference(
  enabled: boolean,
  storage?: TutorialPreferenceStorage | null,
): void {
  try {
    (storage ?? getBrowserStorage())?.setItem(TUTORIAL_PREFERENCE_KEY, String(enabled));
  } catch {
    // Storage may be unavailable in private browsing or embedded contexts.
  }
}

function getBrowserStorage(): TutorialPreferenceStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
