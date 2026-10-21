import { describe, expect, it } from "vitest";
import { GAME_RULES } from "../constants";
import { createInitialGameState } from "../state";
import type { Anchor, GameState, PlayerId, Vec2 } from "../types";
import {
  advanceTetherConflict,
  getAnchorPowerState,
  getPlayerConflictTarget,
  isAnchorProtected,
  resolveAnchorPower,
} from "./tetherConflict";
import {
  canDeployAnchor,
  getPoweredNodes,
  isAtDeliveryNode,
  isInsideSafeZone,
} from "./tetherNetwork";

describe("competitive tether conflict", () => {
  it("preserves static anchor and disruption identity when conflict is unchanged", () => {
    const state = conflictState([
      anchor("root", "player", { x: 100, y: 100 }),
    ]);
    state.players.player.astronaut.position = { x: 20, y: 330 };
    state.players.rival.astronaut.position = { x: 180, y: 20 };

    const next = advanceTetherConflict(state, 0.05);

    expect(next).toBe(state);
    expect(next.anchors).toBe(state.anchors);
    expect(next.anchors[0]).toBe(state.anchors[0]);
    expect(next.tetherDisruptions).toBe(state.tetherDisruptions);
  });

  it("replaces only anchors whose conflict presentation changes", () => {
    const state = conflictState([
      anchor("target", "player", { x: 100, y: 100 }),
      anchor("untouched", "player", { x: 140, y: 100 }),
    ]);
    state.players.player.astronaut.position = { x: 20, y: 330 };
    state.players.rival.astronaut.position = { x: 100, y: 100 };

    const next = advanceTetherConflict(state, 0.05);

    expect(next.anchors).not.toBe(state.anchors);
    expect(next.anchors[0]).not.toBe(state.anchors[0]);
    expect(next.anchors[1]).toBe(state.anchors[1]);
    expect(next.tetherDisruptions).toBe(state.tetherDisruptions);
  });

  it("overloads one enemy anchor only after the full unopposed hold", () => {
    let state = conflictState([
      anchor("root", "player", { x: 100, y: 100 }),
    ]);
    state.players.rival.astronaut.position = { x: 100, y: 100 };
    state.players.player.astronaut.position = { x: 20, y: 330 };

    state = step(state, GAME_RULES.anchorOverloadSeconds / 2);
    expect(state.anchors[0].powered).toBe(true);
    expect(state.anchors[0].overloadProgress).toBeCloseTo(0.5, 8);
    expect(state.tetherDisruptions.rival).toBe(0);

    state = step(state, GAME_RULES.anchorOverloadSeconds / 2);
    expect(state.anchors[0].powered).toBe(false);
    expect(state.anchors[0].disruptedUntilMs).toBe(
      state.elapsedMs + GAME_RULES.anchorDisruptionDurationMs,
    );
    expect(getAnchorPowerState(state.anchors[0], state.elapsedMs)).toBe(
      "disrupted",
    );
    expect(state.tetherDisruptions).toMatchObject({ player: 0, rival: 1 });
  });

  it("authoritatively credits every attacker helping finish a disruption", () => {
    let state = createInitialGameState("shared-disruption", 3);
    state.anchors = [anchor("root", "player", { x: 100, y: 100 })];
    state.players.player.astronaut.position = { x: 20, y: 330 };
    state.players.rival.astronaut.position = { x: 100, y: 100 };
    state.players.player3.astronaut.position = { x: 101, y: 100 };

    state = step(
      state,
      GAME_RULES.anchorOverloadSeconds,
      ["player", "rival", "player3"],
    );

    expect(state.anchors[0].powered).toBe(false);
    expect(state.tetherDisruptions).toMatchObject({
      player: 0,
      rival: 1,
      player3: 1,
    });
  });

  it("lets a nearby defender visibly scrub partial overload progress", () => {
    let state = conflictState([
      anchor("root", "player", { x: 100, y: 100 }),
    ]);
    state.players.rival.astronaut.position = { x: 100, y: 100 };
    state.players.player.astronaut.position = { x: 20, y: 330 };
    state = step(state, GAME_RULES.anchorOverloadSeconds / 2);

    state.players.player.astronaut.position = { x: 100, y: 100 };
    state = step(state, 0.5);

    expect(state.anchors[0].powered).toBe(true);
    expect(state.anchors[0].overloadProgress).toBeCloseTo(
      0.5 - GAME_RULES.anchorDefenseRecoveryPerSecond * 0.5,
      8,
    );
  });

  it("targets only the nearest eligible anchor in a cluster", () => {
    let state = conflictState([
      anchor("near", "player", { x: 100, y: 100 }),
      anchor("far", "player", { x: 105, y: 100 }),
    ]);
    state.players.rival.astronaut.position = { x: 99, y: 100 };
    state.players.player.astronaut.position = { x: 20, y: 330 };

    expect(getPlayerConflictTarget(state, "rival")).toEqual({
      kind: "overload",
      anchorId: "near",
    });
    state = step(state, 0.5);

    expect(state.anchors.find((candidate) => candidate.id === "near")
      ?.overloadProgress).toBeGreaterThan(0);
    expect(state.anchors.find((candidate) => candidate.id === "far")
      ?.overloadProgress).toBe(0);
  });

  it("severs every descendant but leaves an unrelated sibling powered", () => {
    const state = conflictState([
      anchor("root", "player", { x: 100, y: 100 }),
      anchor("child", "player", { x: 100, y: 80 }, "root"),
      anchor("grandchild", "player", { x: 100, y: 60 }, "child"),
      anchor("sibling", "player", { x: 125, y: 100 }),
    ]);
    state.anchors[0].disruptedUntilMs = 20_000;

    const [root, child, grandchild, sibling] = resolveAnchorPower(
      state.anchors,
      state.elapsedMs,
    );

    expect(root.powered).toBe(false);
    expect(child.powered).toBe(false);
    expect(grandchild.powered).toBe(false);
    expect(sibling.powered).toBe(true);
    expect(getAnchorPowerState(child, state.elapsedMs)).toBe("severed");
  });

  it("repairs a directly disrupted anchor early and grants recovery immunity", () => {
    let state = conflictState([
      {
        ...anchor("root", "player", { x: 100, y: 100 }),
        powered: false,
        disruptedUntilMs: 12_000,
      },
    ]);
    state.players.player.astronaut.position = { x: 100, y: 100 };
    state.players.rival.astronaut.position = { x: 180, y: 20 };

    state = step(state, GAME_RULES.anchorRepairSeconds / 2);
    expect(state.anchors[0].repairProgress).toBeCloseTo(0.5, 8);
    state = step(state, GAME_RULES.anchorRepairSeconds / 2);

    expect(state.anchors[0].powered).toBe(true);
    expect(state.anchors[0].disruptedUntilMs).toBeNull();
    expect(isAnchorProtected(state.anchors[0], state.elapsedMs)).toBe(true);
    expect(getAnchorPowerState(state.anchors[0], state.elapsedMs)).toBe(
      "shielded",
    );
  });

  it("pauses repair while the attacker camps the disabled node", () => {
    let state = conflictState([
      {
        ...anchor("root", "player", { x: 100, y: 100 }),
        powered: false,
        disruptedUntilMs: 12_000,
        repairProgress: 0.4,
      },
    ]);
    state.players.player.astronaut.position = { x: 100, y: 100 };
    state.players.rival.astronaut.position = { x: 102, y: 100 };

    state = step(state, 0.5);

    expect(state.anchors[0].repairProgress).toBeCloseTo(
      0.4 - GAME_RULES.anchorRepairDecayPerSecond * 0.5,
      8,
    );
  });

  it("automatically restores an expired branch with a brief shield", () => {
    let state = conflictState([
      {
        ...anchor("root", "player", { x: 100, y: 100 }),
        powered: false,
        disruptedUntilMs: 1_000,
      },
      anchor("child", "player", { x: 100, y: 80 }, "root"),
    ]);
    state.elapsedMs = 1_000;

    state = advanceTetherConflict(state, 0);

    expect(state.anchors.every((candidate) => candidate.powered)).toBe(true);
    expect(state.anchors[0].protectedUntilMs).toBe(
      1_000 + GAME_RULES.anchorReactivationShieldMs,
    );
  });

  it("does not let a respawned astronaut interact during the teleport tick", () => {
    let state = conflictState([
      anchor("root", "player", { x: 100, y: 100 }),
    ]);
    state.players.rival.astronaut.position = { x: 100, y: 100 };
    state = step(state, 1, ["player"]);

    expect(state.anchors[0].overloadProgress).toBe(0);
  });

  it("removes safety, delivery, and expansion from an offline branch", () => {
    const nodePosition = { x: 100, y: 100 };
    const state = conflictState([
      {
        ...anchor("root", "player", nodePosition),
        powered: false,
        disruptedUntilMs: 12_000,
      },
    ]);
    state.players.player.astronaut.position = { ...nodePosition };
    state.players.player.astronaut.tetherKits = 2;

    const resolved = {
      ...state,
      anchors: resolveAnchorPower(state.anchors, state.elapsedMs),
    };

    expect(getPoweredNodes(resolved, "player").map((node) => node.id))
      .not.toContain("root");
    expect(isInsideSafeZone(resolved, "player", nodePosition)).toBe(false);
    expect(isAtDeliveryNode(resolved, "player", nodePosition)).toBe(false);
    expect(canDeployAnchor(resolved, "player")).toBe(false);
  });

  it("treats missing parents, cross-team parents, and cycles as severed", () => {
    const anchors = [
      anchor("missing", "player", { x: 20, y: 20 }, "nope"),
      anchor("foreign", "rival", { x: 30, y: 20 }, "missing"),
      anchor("cycle-a", "player", { x: 40, y: 20 }, "cycle-b"),
      anchor("cycle-b", "player", { x: 50, y: 20 }, "cycle-a"),
    ];

    expect(resolveAnchorPower(anchors, 0).every((candidate) => !candidate.powered))
      .toBe(true);
  });
});

function conflictState(anchors: Anchor[]): GameState {
  const state = createInitialGameState("conflict-test");
  state.anchors = anchors;
  return state;
}

function step(
  state: GameState,
  deltaSeconds: number,
  activePlayers: readonly PlayerId[] = ["player", "rival"],
) {
  const elapsedMs = state.elapsedMs + deltaSeconds * 1_000;
  return advanceTetherConflict(
    { ...state, elapsedMs },
    deltaSeconds,
    activePlayers,
  );
}

function anchor(
  id: string,
  owner: PlayerId,
  position: Vec2,
  parentId = `${owner}-base`,
): Anchor {
  return {
    id,
    owner,
    position,
    parentId,
    powered: true,
    disruptedUntilMs: null,
    protectedUntilMs: null,
    overloadProgress: 0,
    repairProgress: 0,
  };
}
