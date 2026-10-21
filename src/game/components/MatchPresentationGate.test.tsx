import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitialGameState } from "../state";
import {
  MATCH_PRESENTATION_TIMEOUT_MS,
  MatchPresentationGate,
  MatchScreen,
  scheduleMatchPresentationTimeout,
} from "./MatchScreen";

afterEach(() => {
  vi.useRealTimers();
});

describe("MatchScreen 3D readiness gate", () => {
  it("shows an accessible launch state instead of an initial gameplay frame", () => {
    const markup = renderToStaticMarkup(
      <MatchScreen
        alwaysShowJoystick={false}
        audioEnabled={false}
        tutorialEnabled={false}
        state={createInitialGameState("match-presentation-gate")}
        localPlayerId="player"
        statusText="Mechanics sandbox"
        onMovementCommand={() => undefined}
        onDeploy={() => undefined}
        onLeave={() => undefined}
      />,
    );

    expect(markup).toContain("screen--presentation-loading");
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('class="match-presentation-content" aria-hidden="true" inert=""');
    expect(markup).toContain("Preparing the frontier…");
    expect(markup).toContain("Loading the terrain, astronauts, and tether equipment before launch.");
    expect(markup).toContain("world-stage--loading");
    expect(markup).not.toContain("Use compatibility graphics");
  });

  it("turns a 3D failure into an actionable accessible alert", () => {
    const markup = renderToStaticMarkup(
      <MatchPresentationGate
        failed={true}
        onRetry={() => undefined}
        onUseCompatibilityMode={() => undefined}
        onLeave={() => undefined}
      />,
    );

    expect(markup).toContain('role="alertdialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("3D scene unavailable");
    expect(markup).toContain("Try 3D again");
    expect(markup).toContain("Use compatibility graphics");
    expect(markup).toContain("Return to menu");
  });

  it("fails a stalled presentation after the watchdog deadline", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();

    scheduleMatchPresentationTimeout(onTimeout);
    vi.advanceTimersByTime(MATCH_PRESENTATION_TIMEOUT_MS - 1);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it("cancels the watchdog once presentation loading settles", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();

    const cancel = scheduleMatchPresentationTimeout(onTimeout);
    cancel();
    vi.advanceTimersByTime(MATCH_PRESENTATION_TIMEOUT_MS);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
