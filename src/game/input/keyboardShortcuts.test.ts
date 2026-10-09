import { describe, expect, it } from "vitest";
import { isDeployShortcut, type KeyboardShortcutState } from "./keyboardShortcuts";

const T_PRESS: KeyboardShortcutState = {
  code: "KeyT",
  repeat: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
};

describe("keyboard shortcuts", () => {
  it("recognizes a single physical T press for tether deployment", () => {
    expect(isDeployShortcut(T_PRESS)).toBe(true);
  });

  it.each([
    { label: "repeat", change: { repeat: true } },
    { label: "Command", change: { metaKey: true } },
    { label: "Control", change: { ctrlKey: true } },
    { label: "Alt", change: { altKey: true } },
    { label: "Shift", change: { shiftKey: true } },
    { label: "composition", change: { isComposing: true } },
  ])("rejects a $label-modified T press", ({ change }) => {
    expect(isDeployShortcut({ ...T_PRESS, ...change })).toBe(false);
  });

  it("rejects other physical keys", () => {
    expect(isDeployShortcut({ ...T_PRESS, code: "KeyR" })).toBe(false);
    expect(isDeployShortcut({ ...T_PRESS, code: "ArrowUp" })).toBe(false);
  });
});
