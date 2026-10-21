import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  GuidedSetupCoach,
  GuidedSetupObjectiveReminder,
} from "./GuidedSetupCoach";

describe("GuidedSetupCoach", () => {
  it("hands the player a game-like objective after training", () => {
    const markup = renderToStaticMarkup(<GuidedSetupObjectiveReminder />);

    expect(markup).toContain('class="guided-setup guided-setup--objective"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-atomic="true"');
    expect(markup).toContain("Training complete");
    expect(markup).toContain("Claim the frontier");
    expect(markup).toContain("cover more territory");
    expect(markup).toContain("rack up signal points");
    expect(markup).toContain("the highest score wins");
  });

  it("renders an accessible, visual six-step setup card", () => {
    const markup = renderToStaticMarkup(
      <GuidedSetupCoach
        step="deploy"
        completedStepIds={["move", "boost"]}
        materialsCollected={0}
      />,
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("Plant your first tether");
    expect(markup).toContain("Tap the glowing Deploy control");
    expect(markup).toContain("Press T");
    expect(markup).not.toContain("Hide guided setup");
    expect(markup).toContain('aria-label="Guided setup progress"');
    expect(markup).toContain('aria-current="step"');
    expect(markup.match(/<li/g)).toHaveLength(6);
    expect(markup.match(/is-complete/g)).toHaveLength(2);
  });

  it.each([
    ["move", "Move into the frontier"],
    ["boost", "Launch a charged burst"],
    ["deploy", "Plant your first tether"],
    ["salvage", "Collect 3 gold materials"],
    ["bank", "Convert material into a tether"],
    ["break", "Break an enemy tether"],
  ] as const)("gives %s an action-first instruction", (step, title) => {
    const markup = renderToStaticMarkup(
      <GuidedSetupCoach
        step={step}
        completedStepIds={[]}
        materialsCollected={0}
      />,
    );

    expect(markup).toContain(title);
    expect(markup).toContain('aria-hidden="true"');
  });

  it("teaches the floating touch joystick while preserving desktop controls", () => {
    const markup = renderToStaticMarkup(
      <GuidedSetupCoach
        step="move"
        completedStepIds={[]}
        materialsCollected={0}
      />,
    );

    expect(markup).toContain("Touch anywhere · drag to steer · release to stop");
    expect(markup).toContain("W/S move · A/D turn");
    expect(markup).not.toContain("Drag anywhere");
  });

  it("explains how the floating joystick aims a charged burst", () => {
    const markup = renderToStaticMarkup(
      <GuidedSetupCoach
        step="boost"
        completedStepIds={["move"]}
        materialsCollected={0}
      />,
    );

    expect(markup).toContain("Quick tap · hold nearby · drag to aim · release");
    expect(markup).toContain("Tap W/S · hold again · release");
  });

  it("shows live material progress until all three are collected", () => {
    const markup = renderToStaticMarkup(
      <GuidedSetupCoach
        step="salvage"
        completedStepIds={["move", "boost", "deploy"]}
        materialsCollected={2}
      />,
    );

    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-label="Gold materials collected"');
    expect(markup).toContain('aria-valuenow="2"');
    expect(markup).toContain("2 / 3");
    expect(markup.match(/is-filled/g)).toHaveLength(2);
  });

  it("clamps displayed material progress to the three-material goal", () => {
    const markup = renderToStaticMarkup(
      <GuidedSetupCoach
        step="salvage"
        completedStepIds={[]}
        materialsCollected={7}
      />,
    );

    expect(markup).toContain('aria-valuenow="3"');
    expect(markup).toContain("3 / 3");
    expect(markup.match(/is-filled/g)).toHaveLength(3);
  });

  it("shows the three-material tether conversion recipe", () => {
    const markup = renderToStaticMarkup(
      <GuidedSetupCoach
        step="bank"
        completedStepIds={["move", "boost", "deploy", "salvage"]}
        materialsCollected={3}
      />,
    );

    expect(markup).toContain('aria-label="3 of 3 materials ready; 3 materials convert into 1 tether"');
    expect(markup).toContain("1 tether");
    expect(markup.match(/is-filled/g)).toHaveLength(3);
  });

  it("keeps step five collecting until three usable materials are ready", () => {
    const markup = renderToStaticMarkup(
      <GuidedSetupCoach
        step="bank"
        completedStepIds={["move", "boost", "deploy", "salvage"]}
        materialsCollected={3}
        materialsAvailable={1}
      />,
    );

    expect(markup).toContain("Collect 2 more gold materials");
    expect(markup).toContain("Follow the gold material marker");
    expect(markup).toContain('aria-label="1 of 3 materials ready; 3 materials convert into 1 tether"');
    expect(markup.match(/is-filled/g)).toHaveLength(1);
  });

  it.each([
    ["salvage", "Waiting for the next gold material signal"],
    ["break", "Waiting for a vulnerable enemy tether"],
  ] as const)("uses honest waiting copy when %s has no target", (step, copy) => {
    const markup = renderToStaticMarkup(
      <GuidedSetupCoach
        step={step}
        completedStepIds={[]}
        materialsCollected={2}
        targetAvailable={false}
      />,
    );

    expect(markup).toContain(copy);
    expect(markup).not.toContain("marked powered tether");
  });

  it("waits for a tether anchor once all conversion materials are ready", () => {
    const markup = renderToStaticMarkup(
      <GuidedSetupCoach
        step="bank"
        completedStepIds={["move", "boost", "deploy", "salvage"]}
        materialsCollected={3}
        materialsAvailable={3}
        targetAvailable={false}
      />,
    );

    expect(markup).toContain("Waiting for one of your tether anchors to reconnect");
  });

  it("waits for material instead when conversion inventory was lost or spent", () => {
    const markup = renderToStaticMarkup(
      <GuidedSetupCoach
        step="bank"
        completedStepIds={["move", "boost", "deploy", "salvage"]}
        materialsCollected={3}
        materialsAvailable={0}
        targetAvailable={false}
      />,
    );

    expect(markup).toContain("Waiting for the next gold material signal");
  });
});
