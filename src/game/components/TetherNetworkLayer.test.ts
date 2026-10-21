import { describe, expect, it } from "vitest";
import { baseId, createInitialGameState } from "../state";
import type { GameState } from "../types";
import {
  getInteractionFilamentPath,
  sameStaticNetworkProps,
} from "./TetherNetworkLayer";

function stateWithAnchor(): GameState {
  const state = createInitialGameState("tether-network-layer");
  state.anchors = [{
    id: "anchor-1",
    owner: "player",
    position: { x: 120, y: 100 },
    parentId: baseId("player"),
    powered: true,
    disruptedUntilMs: null,
    protectedUntilMs: null,
    overloadProgress: 0,
    repairProgress: 0,
  }];
  state.hasDeployedAnchor.player = true;
  return state;
}

function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

function networkProps(state: GameState) {
  return { state, localPlayerId: "player" as const };
}

describe("tether network presentation equality", () => {
  it("accepts JSON-shaped clones with identical presentation data", () => {
    const previous = stateWithAnchor();
    const next = cloneState(previous);

    expect(previous.anchors).not.toBe(next.anchors);
    expect(previous.anchors[0]).not.toBe(next.anchors[0]);
    expect(sameStaticNetworkProps(
      networkProps(previous),
      networkProps(next),
    )).toBe(true);
  });

  it("detects anchor geometry, progress, and timed power changes", () => {
    const previous = stateWithAnchor();

    const moved = cloneState(previous);
    moved.anchors[0].position.x += 1;
    expect(sameStaticNetworkProps(
      networkProps(previous),
      networkProps(moved),
    )).toBe(false);

    const progressing = cloneState(previous);
    progressing.anchors[0].overloadProgress = 0.25;
    expect(sameStaticNetworkProps(
      networkProps(previous),
      networkProps(progressing),
    )).toBe(false);

    previous.elapsedMs = 50;
    previous.anchors[0].protectedUntilMs = 100;
    const expired = cloneState(previous);
    expired.elapsedMs = 150;
    expect(sameStaticNetworkProps(
      networkProps(previous),
      networkProps(expired),
    )).toBe(false);
  });

  it("detects base and collapse presentation changes", () => {
    const previous = stateWithAnchor();
    const movedBase = cloneState(previous);
    movedBase.players.player.basePosition.y += 1;
    expect(sameStaticNetworkProps(
      networkProps(previous),
      networkProps(movedBase),
    )).toBe(false);

    const collapsing = cloneState(previous);
    collapsing.baseCollapseProgressMs.rival = 500;
    collapsing.baseCollapseAttacker.rival = "player";
    expect(sameStaticNetworkProps(
      networkProps(previous),
      networkProps(collapsing),
    )).toBe(false);
  });
});

describe("interaction filament geometry", () => {
  it("changes the path when its live astronaut endpoint advances", () => {
    const end = { x: 11, y: 2 };
    const first = getInteractionFilamentPath({ x: 1, y: 2 }, end);
    const advanced = getInteractionFilamentPath({ x: 4, y: 2 }, end);

    expect(first).toBe("M 1 2 Q 6 3.1 11 2");
    expect(advanced).not.toBe(first);
    expect(advanced).toMatch(/^M 4 2 Q /);
  });
});
