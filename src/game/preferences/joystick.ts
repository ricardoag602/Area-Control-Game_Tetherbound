export const ALWAYS_SHOW_JOYSTICK_PREFERENCE_KEY =
  "tetherbound.alwaysShowJoystick";

export interface JoystickPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The joystick is transient by default; only an explicit saved value enables it. */
export function readAlwaysShowJoystickPreference(
  storage?: JoystickPreferenceStorage | null,
): boolean {
  try {
    return (storage ?? getBrowserStorage())?.getItem(
      ALWAYS_SHOW_JOYSTICK_PREFERENCE_KEY,
    ) === "true";
  } catch {
    return false;
  }
}

export function writeAlwaysShowJoystickPreference(
  enabled: boolean,
  storage?: JoystickPreferenceStorage | null,
): void {
  try {
    (storage ?? getBrowserStorage())?.setItem(
      ALWAYS_SHOW_JOYSTICK_PREFERENCE_KEY,
      String(enabled),
    );
  } catch {
    // Storage may be unavailable in private browsing or embedded contexts.
  }
}

function getBrowserStorage(): JoystickPreferenceStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
