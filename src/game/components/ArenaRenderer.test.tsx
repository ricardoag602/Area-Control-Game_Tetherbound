import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createInitialGameState } from "../state";
import {
  ArenaRenderer,
  getArenaPresentationState,
} from "./ArenaRenderer";

describe("getArenaPresentationState", () => {
  it("waits for terrain and both 3D model groups", () => {
    const readiness = {
      terrainReady: true,
      astronautsReady: true,
      objectsReady: true,
      loadFailed: false,
      compatibilityMode: false,
    };

    expect(getArenaPresentationState(readiness)).toBe("ready");
    expect(getArenaPresentationState({ ...readiness, terrainReady: false })).toBe("loading");
    expect(getArenaPresentationState({ ...readiness, astronautsReady: false })).toBe("loading");
    expect(getArenaPresentationState({ ...readiness, objectsReady: false })).toBe("loading");
  });

  it("keeps terrain or model failures concealed until compatibility mode is explicit", () => {
    const failed = {
      terrainReady: false,
      astronautsReady: false,
      objectsReady: true,
      loadFailed: true,
      compatibilityMode: false,
    };

    expect(getArenaPresentationState(failed)).toBe("failed");
    expect(getArenaPresentationState({ ...failed, compatibilityMode: true })).toBe("fallback");
  });
});

describe("ArenaRenderer player layering", () => {
  it("conceals the world until every 3D layer has rendered", () => {
    const markup = renderToStaticMarkup(
      <ArenaRenderer
        state={createInitialGameState("three-loading-gate")}
        localPlayerId="player"
        onMovementCommand={() => undefined}
      />,
    );

    expect(markup).toContain("world-stage world-stage--loading");
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("three-astronaut-layer");
    expect(markup).not.toContain("world-stage--three-astronauts");
    expect(markup).not.toContain("world-stage--three-objects");
  });

  it("only exposes sprite fallback when compatibility mode is explicit", () => {
    const markup = renderToStaticMarkup(
      <ArenaRenderer
        state={createInitialGameState("compatibility-mode")}
        localPlayerId="player"
        compatibilityMode={true}
        onMovementCommand={() => undefined}
      />,
    );

    expect(markup).toContain("world-stage world-stage--fallback");
    expect(markup).toContain("world__astronaut-sprite--active");
    expect(markup).not.toContain("three-astronaut-layer");
  });

  it("raises oxygen above the world while keeping other player cues in the underlay", () => {
    const state = createInitialGameState("player-underlay");
    state.players.player.astronaut.oxygen = 50;
    state.players.player.astronaut.movement.mode = "charging";
    state.players.player.astronaut.movement.chargeSeconds = 0.5;

    const markup = renderToStaticMarkup(
      <ArenaRenderer
        state={state}
        localPlayerId="player"
        onMovementCommand={() => undefined}
        tutorialStep="boost"
      />,
    );
    const underlay = markup.match(
      /<svg class="world world--player-underlay"[\s\S]*?<\/svg>/,
    )?.[0];
    const interactiveWorld = markup.match(
      /<svg class="world"[\s\S]*?<\/svg>/,
    )?.[0];
    const overlay = markup.match(
      /<svg class="world world--player-overlay"[\s\S]*?<\/svg>/,
    )?.[0];

    expect(overlay).toContain("world__oxygen-meter");
    expect(overlay).toContain("world__oxygen-meter-label");
    expect(overlay).toContain("O²");
    expect(underlay).not.toContain("world__oxygen-meter");
    expect(underlay).toContain("world__tutorial-cue");
    expect(underlay).toContain("world__charge-feedback");
    expect(underlay).not.toContain("world__astronaut");
    expect(interactiveWorld).toContain("world__astronaut");
    expect(interactiveWorld).not.toContain("world__tutorial-cue");
    expect(interactiveWorld).not.toContain("world__charge-feedback");
  });
});
