import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createInitialGameState } from "../state";
import { ArenaRenderer } from "./ArenaRenderer";

describe("ArenaRenderer player layering", () => {
  it("keeps player-linked world indicators in the underlay", () => {
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

    expect(underlay).toContain("world__oxygen-meter");
    expect(underlay).toContain("world__tutorial-cue");
    expect(underlay).toContain("world__charge-feedback");
    expect(underlay).not.toContain("world__astronaut");
    expect(interactiveWorld).toContain("world__astronaut");
    expect(interactiveWorld).not.toContain("world__tutorial-cue");
    expect(interactiveWorld).not.toContain("world__charge-feedback");
  });
});
