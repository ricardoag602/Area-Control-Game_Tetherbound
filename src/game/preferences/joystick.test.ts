import { describe, expect, it, vi } from "vitest";
import {
  ALWAYS_SHOW_JOYSTICK_PREFERENCE_KEY,
  readAlwaysShowJoystickPreference,
  writeAlwaysShowJoystickPreference,
  type JoystickPreferenceStorage,
} from "./joystick";

describe("always-show joystick preference", () => {
  it("defaults to a transient joystick when no preference was saved", () => {
    const storage = createStorage(null);

    expect(readAlwaysShowJoystickPreference(storage)).toBe(false);
    expect(storage.getItem).toHaveBeenCalledWith(
      ALWAYS_SHOW_JOYSTICK_PREFERENCE_KEY,
    );
  });

  it("only enables the permanent joystick for the exact persisted value true", () => {
    expect(readAlwaysShowJoystickPreference(createStorage("true"))).toBe(true);
    expect(readAlwaysShowJoystickPreference(createStorage("TRUE"))).toBe(false);
    expect(readAlwaysShowJoystickPreference(createStorage(" true"))).toBe(false);
    expect(readAlwaysShowJoystickPreference(createStorage("1"))).toBe(false);
  });

  it("persists explicit boolean strings", () => {
    const storage = createStorage(null);

    writeAlwaysShowJoystickPreference(true, storage);
    expect(storage.setItem).toHaveBeenLastCalledWith(
      ALWAYS_SHOW_JOYSTICK_PREFERENCE_KEY,
      "true",
    );

    writeAlwaysShowJoystickPreference(false, storage);
    expect(storage.setItem).toHaveBeenLastCalledWith(
      ALWAYS_SHOW_JOYSTICK_PREFERENCE_KEY,
      "false",
    );
  });

  it("falls back safely when reading or writing storage throws", () => {
    const storage: JoystickPreferenceStorage = {
      getItem: vi.fn(() => {
        throw new DOMException("blocked", "SecurityError");
      }),
      setItem: vi.fn(() => {
        throw new DOMException("blocked", "SecurityError");
      }),
    };

    expect(readAlwaysShowJoystickPreference(storage)).toBe(false);
    expect(() => writeAlwaysShowJoystickPreference(true, storage)).not.toThrow();
  });
});

function createStorage(value: string | null): JoystickPreferenceStorage {
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn(),
  };
}
