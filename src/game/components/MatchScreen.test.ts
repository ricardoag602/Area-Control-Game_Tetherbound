import { describe, expect, it } from "vitest";
import { createInitialGameState } from "../state";
import type { Anchor, PlayerId, Vec2 } from "../types";
import { findTutorialTarget } from "./MatchScreen";

describe("tutorial target selection", () => {
  it("points conversion at the nearest powered tether owned by the player", () => {
    const state = createInitialGameState("conversion-target");
    state.players.player.astronaut.position = { x: 100, y: 100 };
    state.players.player.astronaut.carriedSalvage = 3;
    state.anchors = [
      createAnchor("rival", "nearby-enemy", { x: 101, y: 100 }),
      { ...createAnchor("player", "offline-own", { x: 102, y: 100 }), powered: false },
      createAnchor("player", "far-own", { x: 130, y: 100 }),
      createAnchor("player", "nearest-own", { x: 108, y: 100 }),
    ];

    expect(findTutorialTarget(state, "player", "bank")).toEqual({ x: 108, y: 100 });
  });

  it("does not substitute the home base when no powered tether anchor exists", () => {
    const state = createInitialGameState("conversion-target-empty");
    state.players.player.astronaut.carriedSalvage = 3;

    expect(findTutorialTarget(state, "player", "bank")).toBeNull();
  });

  it("keeps pointing to salvage until the conversion recipe is available", () => {
    const state = createInitialGameState("conversion-needs-material");
    state.players.player.astronaut.position = { x: 100, y: 100 };
    state.players.player.astronaut.carriedSalvage = 1;
    state.salvage = [
      { id: "far-material", position: { x: 150, y: 100 }, collected: false },
      { id: "near-material", position: { x: 108, y: 100 }, collected: false },
    ];
    state.anchors = [
      createAnchor("player", "ready-anchor", { x: 101, y: 100 }),
    ];

    expect(findTutorialTarget(state, "player", "bank")).toEqual({ x: 108, y: 100 });
  });
});

function createAnchor(
  owner: PlayerId,
  id: string,
  position: Vec2,
): Anchor {
  return {
    id,
    owner,
    position,
    parentId: `${owner}-base`,
    powered: true,
    disruptedUntilMs: null,
    protectedUntilMs: null,
    overloadProgress: 0,
    repairProgress: 0,
  };
}
