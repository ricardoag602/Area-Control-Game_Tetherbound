import { describe, expect, it } from "vitest";
import { isTactileFeedbackTarget } from "./UiTactileFeedbackLayer";

describe("shared tactile UI feedback", () => {
  it("accepts an enabled interactive control", () => {
    expect(isTactileFeedbackTarget(fakeTarget())).toBe(true);
  });

  it("ignores non-controls, disabled controls, and explicit exclusions", () => {
    expect(isTactileFeedbackTarget(null)).toBe(false);
    expect(isTactileFeedbackTarget(fakeTarget({ interactive: false }))).toBe(false);
    expect(isTactileFeedbackTarget(fakeTarget({ disabled: true }))).toBe(false);
    expect(isTactileFeedbackTarget(fakeTarget({ ariaDisabled: true }))).toBe(false);
    expect(isTactileFeedbackTarget(fakeTarget({ excluded: true }))).toBe(false);
  });
});

function fakeTarget({
  interactive = true,
  disabled = false,
  ariaDisabled = false,
  excluded = false,
}: {
  interactive?: boolean;
  disabled?: boolean;
  ariaDisabled?: boolean;
  excluded?: boolean;
} = {}) {
  const control = {
    disabled,
    closest: () => excluded ? {} : null,
    getAttribute: (name: string) => (
      name === "aria-disabled" && ariaDisabled ? "true" : null
    ),
  };
  return {
    closest: () => interactive ? control : null,
  } as unknown as EventTarget;
}
