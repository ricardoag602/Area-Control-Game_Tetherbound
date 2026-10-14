import { describe, expect, it } from "vitest";
import { GAME_RULES } from "../constants";
import { createInitialGameState } from "../state";
import type { Anchor, GameState, PlayerId } from "../types";
import {
  GUIDED_SETUP_STEPS,
  advanceGuidedSetup,
  createGuidedSetupProgress,
  getCurrentGuidedSetupStep,
  type GuidedSetupProgress,
} from "./guidedSetup";

const PLAYER_ID: PlayerId = "player";

describe("guided setup progress", () => {
  it("presents the six setup actions in their teaching order", () => {
    const progress = createProgress();

    expect(GUIDED_SETUP_STEPS).toEqual([
      "move",
      "boost",
      "deploy",
      "salvage",
      "bank",
      "break",
    ]);
    expect(progress.status).toBe("active");
    expect(getCurrentGuidedSetupStep(progress)).toBe("move");
  });

  it("accumulates confirmed position deltas until movement succeeds", () => {
    const state = createState();
    let progress = createGuidedSetupProgress(state, PLAYER_ID);

    state.players.player.astronaut.position.x += 2;
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);
    expect(progress.movementDistance).toBeCloseTo(2);
    expect(progress.completed.move).toBe(false);

    state.players.player.astronaut.position.y += 2;
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);
    state.players.player.astronaut.position.x += 2;
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);

    expect(progress.movementDistance).toBeCloseTo(6);
    expect(progress.completed.move).toBe(true);
    expect(getCurrentGuidedSetupStep(progress)).toBe("boost");
  });

  it("credits a burst only after authoritative movement state confirms it", () => {
    const state = createState();
    let progress = createGuidedSetupProgress(state, PLAYER_ID);

    state.players.player.astronaut.movement.mode = "charging";
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);
    expect(progress.completed.boost).toBe(false);

    state.players.player.astronaut.movement.mode = "burst";
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);
    expect(progress.completed.boost).toBe(true);
  });

  it("credits a completed burst even after its mode returns to idle", () => {
    const state = createState();
    let progress = createGuidedSetupProgress(state, PLAYER_ID);
    state.players.player.astronaut.movement.burstDistanceTotal = 12;

    progress = advanceGuidedSetup(progress, state, PLAYER_ID);

    expect(progress.completed.boost).toBe(true);
  });

  it("latches out-of-order actions while keeping the first incomplete step current", () => {
    const state = createState();
    let progress = createGuidedSetupProgress(state, PLAYER_ID);
    state.players.player.astronaut.movement.mode = "burst";
    state.hasDeployedAnchor.player = true;
    state.anchors.push(createAnchor("player", "early-anchor"));

    progress = advanceGuidedSetup(progress, state, PLAYER_ID);

    expect(progress.completed.boost).toBe(true);
    expect(progress.completed.deploy).toBe(true);
    expect(getCurrentGuidedSetupStep(progress)).toBe("move");
  });

  it("keeps prompting until three materials are collected", () => {
    const state = createState();
    let progress = createGuidedSetupProgress(state, PLAYER_ID);
    const initialResources = progress.resourceUnits;

    state.players.player.astronaut.carriedSalvage += 1;
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);
    expect(progress.materialsCollected).toBe(1);
    expect(progress.completed.salvage).toBe(false);
    expect(progress.completed.bank).toBe(false);

    state.players.player.astronaut.carriedSalvage += 1;
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);
    expect(progress.materialsCollected).toBe(2);
    expect(progress.completed.salvage).toBe(false);

    state.players.player.astronaut.carriedSalvage += 1;
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);
    expect(progress.materialsCollected).toBe(3);
    expect(progress.completed.salvage).toBe(true);

    state.players.player.astronaut.tetherKits -= 1;
    state.anchors.push(createAnchor("player", "spent-kit"));
    state.hasDeployedAnchor.player = true;
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);

    expect(progress.resourceUnits).toBe(initialResources + 3);
    expect(progress.materialsCollected).toBe(3);
    expect(progress.completed.salvage).toBe(true);
    expect(progress.completed.deploy).toBe(true);
  });

  it("keeps cumulative material progress after loss, banking, and spending", () => {
    const state = createState();
    let progress = createGuidedSetupProgress(state, PLAYER_ID);

    state.players.player.astronaut.carriedSalvage = 2;
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);
    expect(progress.materialsCollected).toBe(2);

    state.players.player.astronaut.carriedSalvage = 0;
    state.players.player.astronaut.respawns += 1;
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);
    expect(progress.materialsCollected).toBe(2);
    expect(progress.materialsAvailable).toBe(0);
    expect(progress.completed.salvage).toBe(false);

    state.players.player.astronaut.carriedSalvage = 1;
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);
    expect(progress.materialsCollected).toBe(3);
    expect(progress.completed.salvage).toBe(true);

    state.players.player.astronaut.carriedSalvage = 0;
    state.players.player.astronaut.bankedSalvage = 1;
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);
    state.players.player.astronaut.carriedSalvage = 2;
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);
    expect(progress.materialsCollected).toBe(5);

    state.players.player.astronaut.carriedSalvage = 0;
    state.players.player.astronaut.bankedSalvage = 0;
    state.players.player.astronaut.tetherKits += 1;
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);
    state.players.player.astronaut.tetherKits -= 1;
    state.anchors.push(createAnchor("player", "material-spent-anchor"));
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);

    expect(progress.materialsCollected).toBe(5);
    expect(progress.completed.salvage).toBe(true);
    expect(progress.completed.bank).toBe(false);
  });

  it("completes conversion only after collected salvage becomes a tether", () => {
    const state = createState();
    let progress = createGuidedSetupProgress(state, PLAYER_ID);

    state.players.player.astronaut.carriedSalvage = 3;
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);
    expect(progress.completed.salvage).toBe(true);
    expect(progress.completed.bank).toBe(false);

    state.players.player.astronaut.carriedSalvage = 0;
    state.players.player.astronaut.tetherKits += 1;
    state.anchorTetherFabrications.player += 1;
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);

    expect(progress.completed.bank).toBe(true);
  });

  it("does not mistake partially banked material for a converted tether", () => {
    const state = createState();
    let progress = createGuidedSetupProgress(state, PLAYER_ID);

    state.players.player.astronaut.carriedSalvage = 3;
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);
    state.players.player.astronaut.carriedSalvage = 0;
    state.players.player.astronaut.bankedSalvage = 2;
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);

    expect(progress.completed.salvage).toBe(true);
    expect(progress.completed.bank).toBe(false);
  });

  it("keeps anchor conversion pending after materials fabricate at home", () => {
    const state = createState();
    let progress = createGuidedSetupProgress(state, PLAYER_ID);

    state.players.player.astronaut.carriedSalvage = 3;
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);
    state.players.player.astronaut.carriedSalvage = 0;
    state.players.player.astronaut.tetherKits += 1;
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);

    expect(progress.materialsCollected).toBe(3);
    expect(progress.materialsAvailable).toBe(0);
    expect(progress.completed.salvage).toBe(true);
    expect(progress.completed.bank).toBe(false);

    state.players.player.astronaut.tetherKits -= 1;
    state.anchors.push(createAnchor("player", "post-home-anchor"));
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);
    expect(progress.completed.bank).toBe(false);
  });

  it("does not credit another player's anchor fabrication", () => {
    const state = createInitialGameState("guided-anchor-fabrication-multiplayer", 3);
    let progress = createGuidedSetupProgress(state, PLAYER_ID);
    state.anchorTetherFabrications.rival += 1;
    state.players.rival.astronaut.tetherKits += 1;

    progress = advanceGuidedSetup(progress, state, PLAYER_ID);

    expect(progress.completed.bank).toBe(false);
    expect(progress.anchorTetherFabrications).toBe(0);
  });

  it("recognizes collection and banking when both happen between snapshots", () => {
    const state = createState();
    let progress = createGuidedSetupProgress(state, PLAYER_ID);

    state.players.player.astronaut.tetherKits += 1;
    state.anchorTetherFabrications.player += 1;
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);

    expect(progress.completed.salvage).toBe(true);
    expect(progress.completed.bank).toBe(true);
  });

  it("recognizes collect, bank, and deploy batched into one snapshot", () => {
    const state = createState();
    let progress = createGuidedSetupProgress(state, PLAYER_ID);

    state.anchors.push(createAnchor("player", "batched-deployment"));
    state.hasDeployedAnchor.player = true;
    state.anchorTetherFabrications.player += 1;
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);

    expect(progress.materialsCollected).toBe(3);
    expect(progress.completed.salvage).toBe(true);
    expect(progress.completed.bank).toBe(true);
    expect(progress.completed.deploy).toBe(true);
  });

  it("credits an out-of-order enemy tether break from authoritative local engagement", () => {
    const state = createState();
    const enemyAnchor = createAnchor(
      "rival",
      "local-break-target",
      state.players.player.astronaut.position,
    );
    state.anchors.push(enemyAnchor);
    let progress = createGuidedSetupProgress(state, PLAYER_ID);

    state.tetherDisruptions.player += 1;
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);

    expect(progress.completed.break).toBe(true);
    expect(getCurrentGuidedSetupStep(progress)).toBe("move");

    state.players.player.astronaut.position.x += 20;
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);
    expect(progress.completed.break).toBe(true);
  });

  it("does not credit another player's remote tether break", () => {
    const state = createInitialGameState("guided-setup-multiplayer", 3);
    const remotePosition = { ...state.players.rival.astronaut.position };
    const enemyAnchor = createAnchor("player3", "remote-break", remotePosition);
    state.anchors.push(enemyAnchor);
    let progress = createGuidedSetupProgress(state, PLAYER_ID);

    state.tetherDisruptions.player3 += 1;
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);

    expect(progress.completed.break).toBe(false);
  });

  it("does not credit a third-party break while the local player is repairing", () => {
    const state = createInitialGameState("guided-setup-repair-priority", 3);
    const localPosition = { ...state.players.player.astronaut.position };
    state.anchors.push({
      ...createAnchor("player", "local-repair", localPosition),
      powered: false,
      disruptedUntilMs: state.elapsedMs + 20_000,
    });
    const thirdPartyTarget = createAnchor(
      "player3",
      "third-party-target",
      localPosition,
    );
    state.anchors.push(thirdPartyTarget);
    let progress = createGuidedSetupProgress(state, PLAYER_ID);

    state.tetherDisruptions.rival += 1;
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);

    expect(progress.completed.break).toBe(false);
  });

  it("attributes a break to a non-default local player slot", () => {
    const state = createState();
    const localPlayerId: PlayerId = "rival";
    const enemyAnchor = createAnchor(
      "player",
      "rival-local-target",
      state.players.rival.astronaut.position,
    );
    state.anchors.push(enemyAnchor);
    let progress = createGuidedSetupProgress(state, localPlayerId);

    state.tetherDisruptions.rival += 1;
    progress = advanceGuidedSetup(progress, state, localPlayerId);

    expect(progress.completed.break).toBe(true);
  });

  it("does not mistake a severed child for a directly broken tether", () => {
    const state = createState();
    const root = createAnchor("rival", "remote-root", { x: 30, y: 30 });
    const child = createAnchor(
      "rival",
      "nearby-severed-child",
      state.players.player.astronaut.position,
      root.id,
    );
    state.anchors.push(root, child);
    let progress = createGuidedSetupProgress(state, PLAYER_ID);

    root.powered = false;
    root.disruptedUntilMs = state.elapsedMs + 20_000;
    child.powered = false;
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);

    expect(progress.completed.break).toBe(false);
  });

  it("pre-credits an authoritative local break after a remount", () => {
    const state = createState();
    state.tetherDisruptions.player = 1;

    const progress = createGuidedSetupProgress(state, PLAYER_ID);

    expect(progress.completed.break).toBe(true);
  });

  it("does not let an opponent complete the local player's tasks", () => {
    const state = createState();
    let progress = createGuidedSetupProgress(state, PLAYER_ID);
    state.players.rival.astronaut.position.x += 30;
    state.players.rival.astronaut.movement.mode = "burst";
    state.players.rival.astronaut.carriedSalvage = 6;
    state.players.rival.astronaut.bankedSalvage = 2;
    state.hasDeployedAnchor.rival = true;
    state.anchors.push(createAnchor("rival", "rival-anchor"));

    progress = advanceGuidedSetup(progress, state, PLAYER_ID);

    expect(progress.completed).toEqual({
      move: false,
      boost: false,
      deploy: false,
      salvage: false,
      bank: false,
      break: false,
    });
    expect(progress.resourceUnits).toBe(2 * GAME_RULES.salvagePerTether);
    expect(progress.anchorTetherFabrications).toBe(0);
  });

  it("is idempotent for repeated snapshots and completed milestones", () => {
    const state = createState();
    let progress = createGuidedSetupProgress(state, PLAYER_ID);
    state.players.player.astronaut.position.x += 6;
    state.players.player.astronaut.carriedSalvage = 3;

    progress = advanceGuidedSetup(progress, state, PLAYER_ID);
    const repeated = advanceGuidedSetup(progress, state, PLAYER_ID);

    expect(repeated).toEqual(progress);
    expect(repeated.movementDistance).toBe(6);
    expect(repeated.materialsCollected).toBe(3);
    expect(repeated.completed.salvage).toBe(true);
  });

  it("enters a terminal completed state once every task is proven", () => {
    const state = createState();
    const enemyAnchor = createAnchor(
      "rival",
      "completion-target",
      state.players.player.astronaut.position,
    );
    state.anchors.push(enemyAnchor);
    let progress = createGuidedSetupProgress(state, PLAYER_ID);
    state.players.player.astronaut.position.x += 6;
    state.players.player.astronaut.movement.mode = "burst";
    state.players.player.astronaut.tetherKits += 1;
    state.hasDeployedAnchor.player = true;
    state.anchorTetherFabrications.player += 1;
    state.tetherDisruptions.player += 1;

    progress = advanceGuidedSetup(progress, state, PLAYER_ID);

    expect(progress.completed).toEqual({
      move: true,
      boost: true,
      deploy: true,
      salvage: true,
      bank: true,
      break: true,
    });
    expect(progress.status).toBe("completed");
    expect(getCurrentGuidedSetupStep(progress)).toBeNull();
    expect(advanceGuidedSetup(progress, state, PLAYER_ID)).toBe(progress);
  });

  it("pre-credits actions that an in-progress match snapshot proves", () => {
    const state = createState();
    state.players.player.astronaut.movement.mode = "burst";
    state.players.player.astronaut.carriedSalvage = 2;
    state.players.player.astronaut.bankedSalvage = 1;
    state.hasDeployedAnchor.player = true;
    state.anchors.push(createAnchor("player", "existing-anchor"));
    state.anchors.push({
      ...createAnchor(
        "rival",
        "existing-broken-enemy",
        state.players.player.astronaut.position,
      ),
      powered: false,
      disruptedUntilMs: state.elapsedMs + 20_000,
    });
    state.tetherDisruptions.player = 1;
    state.anchorTetherFabrications.player = 1;

    const progress = createGuidedSetupProgress(state, PLAYER_ID);

    expect(progress.completed).toEqual({
      move: false,
      boost: true,
      deploy: true,
      salvage: true,
      bank: true,
      break: true,
    });
  });

  it("stays active after setup and keeps advancing", () => {
    const state = createState();
    let progress = createGuidedSetupProgress(state, PLAYER_ID);
    state.matchPhase = "regulation";
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);

    expect(progress.status).toBe("active");
    expect(getCurrentGuidedSetupStep(progress)).toBe("move");

    state.players.player.astronaut.position.x += 20;
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);

    expect(progress.completed.move).toBe(true);
    expect(getCurrentGuidedSetupStep(progress)).toBe("boost");
  });

  it("remains visible in regulation until the final unfinished action completes", () => {
    const state = createState();
    let progress = createGuidedSetupProgress(state, PLAYER_ID);
    state.players.player.astronaut.position.x += 6;
    state.players.player.astronaut.movement.mode = "burst";
    state.hasDeployedAnchor.player = true;
    state.anchors.push(createAnchor("player", "converted-tether"));
    state.anchors.push(createAnchor("rival", "late-break-target"));
    state.anchorTetherFabrications.player += 1;

    progress = advanceGuidedSetup(progress, state, PLAYER_ID);
    expect(getCurrentGuidedSetupStep(progress)).toBe("break");

    state.matchPhase = "regulation";
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);
    expect(progress.status).toBe("active");
    expect(getCurrentGuidedSetupStep(progress)).toBe("break");

    state.tetherDisruptions.player += 1;
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);
    expect(progress.status).toBe("completed");
    expect(getCurrentGuidedSetupStep(progress)).toBeNull();
  });

  it("awards a tether break after setup has ended", () => {
    const state = createState();
    const enemyAnchor = createAnchor(
      "rival",
      "boundary-break",
      state.players.player.astronaut.position,
    );
    state.anchors.push(enemyAnchor);
    let progress = createGuidedSetupProgress(state, PLAYER_ID);

    state.matchPhase = "regulation";
    state.tetherDisruptions.player += 1;
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);

    expect(progress.status).toBe("active");
    expect(progress.completed.break).toBe(true);
  });

  it("stays dormant when disabled and starts when initialized after setup", () => {
    const setupState = createState();
    const disabled = createGuidedSetupProgress(setupState, PLAYER_ID, false);
    expect(disabled.status).toBe("disabled");
    expect(getCurrentGuidedSetupStep(disabled)).toBeNull();
    expect(advanceGuidedSetup(disabled, setupState, PLAYER_ID)).toBe(disabled);

    const regulationState = createState();
    regulationState.matchPhase = "regulation";
    const continued = createGuidedSetupProgress(regulationState, PLAYER_ID);
    expect(continued.status).toBe("active");
    expect(getCurrentGuidedSetupStep(continued)).toBe("move");
  });

  it("survives JSON serialization between authoritative snapshots", () => {
    const state = createState();
    const enemyAnchor = createAnchor(
      "rival",
      "serialized-break-target",
      state.players.player.astronaut.position,
    );
    state.anchors.push(enemyAnchor);
    let progress = createGuidedSetupProgress(state, PLAYER_ID);
    state.players.player.astronaut.position.x += 3;
    progress = advanceGuidedSetup(progress, state, PLAYER_ID);

    const restored = JSON.parse(JSON.stringify(progress)) as GuidedSetupProgress;
    state.players.player.astronaut.position.x += 3;
    state.tetherDisruptions.player += 1;
    const advanced = advanceGuidedSetup(restored, state, PLAYER_ID);

    expect(advanced.completed.move).toBe(true);
    expect(advanced.completed.break).toBe(true);
    expect(advanced.movementDistance).toBe(6);
    expect(advanced.previousPosition).toEqual(state.players.player.astronaut.position);
  });
});

function createState(): GameState {
  return createInitialGameState("guided-setup-tests");
}

function createProgress(): GuidedSetupProgress {
  return createGuidedSetupProgress(createState(), PLAYER_ID);
}

function createAnchor(
  owner: PlayerId,
  id: string,
  position = { x: 150, y: 150 },
  parentId = `${owner}-base`,
): Anchor {
  return {
    id,
    owner,
    position: { ...position },
    parentId,
    powered: true,
    disruptedUntilMs: null,
    protectedUntilMs: null,
    overloadProgress: 0,
    repairProgress: 0,
  };
}
