import { describe, expect, it, vi } from "vitest";
import { baseId, createInitialGameState } from "../state";
import type { Anchor, GameState, PlayerId, Vec2 } from "../types";
import {
  calculateThreeInteractionParticlePose,
  clearThreeInteractionEffects,
  collectThreeInteractionEvents,
  createThreeInteractionEffects,
  createThreeInteractionSnapshot,
  disposeThreeInteractionEffects,
  updateThreeInteractionEffects,
} from "./threeInteractionEffects";

describe("collectThreeInteractionEvents", () => {
  it("does not invent events for the initial or a repeated state", () => {
    const state = interactionState("interaction-initial");
    const initialSnapshot = createThreeInteractionSnapshot(state);

    const first = collectThreeInteractionEvents(initialSnapshot, state);
    const repeated = collectThreeInteractionEvents(first.snapshot, cloneState(state));

    expect(first.events).toEqual([]);
    expect(repeated.events).toEqual([]);
  });

  it("resolves deployment pulses from a base and then an anchor parent", () => {
    const initial = interactionState("interaction-deploy");
    const firstAnchor = anchor(
      "anchor-1",
      "player",
      { x: 130, y: 255 },
      baseId("player"),
    );
    const afterBaseLink = cloneState(initial);
    afterBaseLink.elapsedMs = 100;
    afterBaseLink.anchors = [firstAnchor];
    afterBaseLink.players.player.astronaut.tetherKits -= 1;

    const baseDeployment = collectThreeInteractionEvents(
      createThreeInteractionSnapshot(initial),
      afterBaseLink,
    );

    expect(baseDeployment.events).toEqual([
      expect.objectContaining({
        kind: "anchor_deployed",
        id: "anchor-1",
        playerId: "player",
        position: firstAnchor.position,
        parentPosition: initial.players.player.basePosition,
      }),
    ]);

    const secondAnchor = anchor(
      "anchor-2",
      "player",
      { x: 145, y: 235 },
      firstAnchor.id,
    );
    const afterAnchorLink = cloneState(afterBaseLink);
    afterAnchorLink.elapsedMs = 200;
    afterAnchorLink.anchors.push(secondAnchor);
    afterAnchorLink.players.player.astronaut.tetherKits -= 1;

    const anchorDeployment = collectThreeInteractionEvents(
      baseDeployment.snapshot,
      afterAnchorLink,
    );

    expect(anchorDeployment.events).toEqual([
      expect.objectContaining({
        kind: "anchor_deployed",
        id: "anchor-2",
        playerId: "player",
        position: secondAnchor.position,
        parentPosition: firstAnchor.position,
      }),
    ]);
  });

  it("bursts only for a directly disrupted anchor, not its severed child", () => {
    const initial = interactionState("interaction-break");
    const parent = anchor(
      "anchor-parent",
      "player",
      { x: 130, y: 250 },
      baseId("player"),
    );
    const child = anchor(
      "anchor-child",
      "player",
      { x: 145, y: 230 },
      parent.id,
    );
    initial.anchors = [parent, child];

    const disrupted = cloneState(initial);
    disrupted.elapsedMs = 1_000;
    disrupted.anchors = disrupted.anchors.map((item) => ({
      ...item,
      powered: false,
      disruptedUntilMs: item.id === parent.id ? 21_000 : null,
    }));

    const result = collectThreeInteractionEvents(
      createThreeInteractionSnapshot(initial),
      disrupted,
    );

    expect(result.events).toEqual([
      expect.objectContaining({
        kind: "anchor_broken",
        id: parent.id,
        playerId: parent.owner,
        position: parent.position,
      }),
    ]);
    expect(result.events).not.toContainEqual(
      expect.objectContaining({ kind: "anchor_broken", id: child.id }),
    );
  });

  it("emits a neutral pickup once when a nugget becomes collected", () => {
    const initial = interactionState("interaction-pickup");
    const deposit = {
      id: "salvage-special",
      position: { x: 144, y: 173 },
      collected: false,
    };
    initial.salvage = [deposit];
    const collected = cloneState(initial);
    collected.elapsedMs = 100;
    collected.salvage[0].collected = true;

    const pickup = collectThreeInteractionEvents(
      createThreeInteractionSnapshot(initial),
      collected,
    );
    const repeated = collectThreeInteractionEvents(pickup.snapshot, collected);

    expect(pickup.events).toEqual([
      expect.objectContaining({
        kind: "salvage_picked_up",
        id: deposit.id,
        position: deposit.position,
      }),
    ]);
    expect(repeated.events).toEqual([]);
  });

  it("detects an immediate collect-and-deliver tick at its delivery node", () => {
    const initial = interactionState("interaction-deposit");
    const player = initial.players.player;
    player.astronaut.position = { ...player.basePosition };
    player.astronaut.carriedSalvage = 2;
    player.astronaut.bankedSalvage = 0;
    player.astronaut.tetherKits = 2;
    initial.salvage = [{
      id: "salvage-delivered",
      position: { ...player.basePosition },
      collected: false,
    }];

    const delivered = cloneState(initial);
    delivered.elapsedMs = 100;
    delivered.salvage[0].collected = true;
    delivered.players.player.astronaut.carriedSalvage = 0;
    delivered.players.player.astronaut.bankedSalvage = 0;
    delivered.players.player.astronaut.tetherKits = 3;

    const result = collectThreeInteractionEvents(
      createThreeInteractionSnapshot(initial),
      delivered,
    );

    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: "salvage_picked_up",
        id: "salvage-delivered",
      }),
    );
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: "salvage_deposited",
        playerId: "player",
        position: player.basePosition,
        amount: 3,
        fabricatedKits: 1,
      }),
    );
  });

  it("positions a remote delivery burst at the powered anchor receiving it", () => {
    const initial = interactionState("interaction-anchor-deposit");
    const deliveryAnchor = anchor(
      "anchor-delivery",
      "player",
      { x: 92, y: 184 },
      baseId("player"),
    );
    initial.anchors = [deliveryAnchor];
    initial.players.player.astronaut.position = { ...deliveryAnchor.position };
    initial.players.player.astronaut.carriedSalvage = 3;
    initial.players.player.astronaut.bankedSalvage = 0;
    initial.players.player.astronaut.tetherKits = 2;

    const delivered = cloneState(initial);
    delivered.elapsedMs = 100;
    delivered.players.player.astronaut.carriedSalvage = 0;
    delivered.players.player.astronaut.tetherKits = 3;

    const result = collectThreeInteractionEvents(
      createThreeInteractionSnapshot(initial),
      delivered,
    );

    expect(result.events).toEqual([
      expect.objectContaining({
        kind: "salvage_deposited",
        playerId: "player",
        position: deliveryAnchor.position,
        amount: 3,
        fabricatedKits: 1,
        nodeId: deliveryAnchor.id,
      }),
    ]);
  });

  it("reports deposits that bank salvage without fabricating a tether kit", () => {
    const initial = interactionState("interaction-bank-only");
    const player = initial.players.player;
    player.astronaut.position = { ...player.basePosition };
    player.astronaut.carriedSalvage = 1;
    player.astronaut.bankedSalvage = 0;

    const delivered = cloneState(initial);
    delivered.elapsedMs = 100;
    delivered.players.player.astronaut.carriedSalvage = 0;
    delivered.players.player.astronaut.bankedSalvage = 1;

    const result = collectThreeInteractionEvents(
      createThreeInteractionSnapshot(initial),
      delivered,
    );

    expect(result.events).toEqual([
      expect.objectContaining({
        kind: "salvage_deposited",
        playerId: "player",
        amount: 1,
        fabricatedKits: 0,
        nodeId: baseId("player"),
      }),
    ]);
  });

  it("compensates a same-update deployment while reporting the deposited material and fabricated kit", () => {
    const initial = interactionState("interaction-deploy-and-deposit");
    const player = initial.players.player;
    const deploymentPosition = {
      x: player.basePosition.x,
      y: player.basePosition.y - 30,
    };
    player.astronaut.position = deploymentPosition;
    player.astronaut.carriedSalvage = 3;
    player.astronaut.tetherKits = 2;

    const delivered = cloneState(initial);
    delivered.elapsedMs = 100;
    delivered.anchors = [anchor(
      "anchor-deploy-and-deposit",
      "player",
      deploymentPosition,
      baseId("player"),
    )];
    delivered.players.player.astronaut.position = { ...player.basePosition };
    delivered.players.player.astronaut.carriedSalvage = 0;
    // Deployment consumes one kit while the three deposited materials create
    // one, so the externally visible kit count is unchanged.
    delivered.players.player.astronaut.tetherKits = 2;

    const result = collectThreeInteractionEvents(
      createThreeInteractionSnapshot(initial),
      delivered,
    );

    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: "anchor_deployed",
        id: "anchor-deploy-and-deposit",
      }),
    );
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: "salvage_deposited",
        playerId: "player",
        amount: 3,
        fabricatedKits: 1,
        nodeId: baseId("player"),
      }),
    );
  });

  it("locates a remote deposit crossed between snapshots after the astronaut leaves its radius", () => {
    const initial = interactionState("interaction-crossed-anchor-deposit");
    const deliveryAnchor = anchor(
      "anchor-crossed-delivery",
      "player",
      { x: 100, y: 100 },
      baseId("player"),
    );
    initial.anchors = [deliveryAnchor];
    initial.players.player.astronaut.position = { x: 90, y: 100 };
    initial.players.player.astronaut.carriedSalvage = 3;
    initial.players.player.astronaut.tetherKits = 2;

    const delivered = cloneState(initial);
    delivered.elapsedMs = 250;
    delivered.players.player.astronaut.position = { x: 110, y: 100 };
    delivered.players.player.astronaut.carriedSalvage = 0;
    delivered.players.player.astronaut.tetherKits = 3;

    const result = collectThreeInteractionEvents(
      createThreeInteractionSnapshot(initial),
      delivered,
    );

    expect(result.events).toEqual([
      expect.objectContaining({
        kind: "salvage_deposited",
        playerId: "player",
        position: deliveryAnchor.position,
        amount: 3,
        fabricatedKits: 1,
        nodeId: deliveryAnchor.id,
      }),
    ]);
  });

  it("does not confuse respawn loss or tether deployment with a deposit", () => {
    const initial = interactionState("interaction-not-deposit");
    initial.players.player.astronaut.carriedSalvage = 2;

    const respawned = cloneState(initial);
    respawned.elapsedMs = 100;
    respawned.players.player.astronaut.carriedSalvage = 0;
    respawned.players.player.astronaut.respawns += 1;
    const respawnEvents = collectThreeInteractionEvents(
      createThreeInteractionSnapshot(initial),
      respawned,
    );
    expect(kinds(respawnEvents.events)).not.toContain("salvage_deposited");

    const beforeDeployment = interactionState("interaction-deploy-not-deposit");
    const deployed = cloneState(beforeDeployment);
    deployed.elapsedMs = 100;
    deployed.players.player.astronaut.tetherKits -= 1;
    deployed.anchors = [anchor(
      "anchor-deploy-only",
      "player",
      { x: 138, y: 244 },
      baseId("player"),
    )];
    const deploymentEvents = collectThreeInteractionEvents(
      createThreeInteractionSnapshot(beforeDeployment),
      deployed,
    );

    expect(kinds(deploymentEvents.events)).toContain("anchor_deployed");
    expect(kinds(deploymentEvents.events)).not.toContain("salvage_deposited");
  });

  it("resets its baseline on an elapsed-clock rewind without replaying events", () => {
    const later = interactionState("interaction-rewind");
    later.elapsedMs = 5_000;
    const rewound = cloneState(later);
    rewound.elapsedMs = 50;
    rewound.players.player.astronaut.tetherKits -= 1;
    rewound.anchors = [anchor(
      "anchor-from-rewound-state",
      "player",
      { x: 138, y: 240 },
      baseId("player"),
    )];

    const reset = collectThreeInteractionEvents(
      createThreeInteractionSnapshot(later),
      rewound,
    );
    const afterReset = cloneState(rewound);
    afterReset.elapsedMs = 100;
    const repeated = collectThreeInteractionEvents(reset.snapshot, afterReset);

    expect(reset.events).toEqual([]);
    expect(repeated.events).toEqual([]);
  });

  it("exposes direct recovery through successive snapshots without replaying a rupture", () => {
    const disrupted = interactionState("interaction-recovery");
    disrupted.elapsedMs = 1_000;
    disrupted.anchors = [{
      ...anchor(
        "anchor-recovered",
        "player",
        { x: 124, y: 238 },
        baseId("player"),
      ),
      powered: false,
      disruptedUntilMs: 21_000,
    }];
    const previous = createThreeInteractionSnapshot(disrupted);

    const recovered = cloneState(disrupted);
    recovered.elapsedMs = 2_000;
    recovered.anchors[0].powered = true;
    recovered.anchors[0].disruptedUntilMs = null;
    recovered.anchors[0].protectedUntilMs = 4_500;
    const result = collectThreeInteractionEvents(previous, recovered);

    expect(previous.anchors.get("anchor-recovered")?.directlyDisrupted).toBe(true);
    expect(result.snapshot.anchors.get("anchor-recovered")).toMatchObject({
      powered: true,
      directlyDisrupted: false,
    });
    expect(result.events).toEqual([]);
  });
});

describe("ThreeInteractionEffects runtime", () => {
  it("writes front-facing triangles after converting game Y into Three space", () => {
    const initial = interactionState("interaction-front-face");
    const runtime = createThreeInteractionEffects(initial);
    const deployed = cloneState(initial);
    deployed.elapsedMs = 100;
    deployed.players.player.astronaut.tetherKits -= 1;
    deployed.anchors = [anchor(
      "anchor-front-face",
      "player",
      { x: 136, y: 244 },
      baseId("player"),
    )];

    updateThreeInteractionEffects(runtime, deployed, 0.016, false);
    const positions = runtime.positionAttribute.array as Float32Array;
    const edgeOneX = positions[3] - positions[0];
    const edgeOneY = positions[4] - positions[1];
    const edgeTwoX = positions[6] - positions[0];
    const edgeTwoY = positions[7] - positions[1];
    const normalZ = edgeOneX * edgeTwoY - edgeOneY * edgeTwoX;

    expect(normalZ).toBeGreaterThan(0);
    disposeThreeInteractionEffects(runtime);
  });

  it("draws event particles, clears them, and advances its baseline in reduced motion", () => {
    const initial = interactionState("interaction-runtime");
    const runtime = createThreeInteractionEffects(initial);
    const deployed = cloneState(initial);
    deployed.elapsedMs = 100;
    deployed.players.player.astronaut.tetherKits -= 1;
    deployed.anchors = [anchor(
      "anchor-runtime",
      "player",
      { x: 136, y: 244 },
      baseId("player"),
    )];

    updateThreeInteractionEffects(runtime, deployed, 0.016, false);
    expect(runtime.particles.length).toBeGreaterThan(0);
    expect(runtime.geometry.drawRange.count).toBe(runtime.particles.length * 6);

    clearThreeInteractionEffects(runtime);
    expect(runtime.particles).toHaveLength(0);
    expect(runtime.geometry.drawRange.count).toBe(0);

    const secondDeployment = cloneState(deployed);
    secondDeployment.elapsedMs = 200;
    secondDeployment.players.player.astronaut.tetherKits -= 1;
    secondDeployment.anchors.push(anchor(
      "anchor-runtime-reduced",
      "player",
      { x: 148, y: 226 },
      "anchor-runtime",
    ));
    updateThreeInteractionEffects(runtime, secondDeployment, 0.016, true);
    expect(runtime.particles).toHaveLength(0);
    expect(runtime.geometry.drawRange.count).toBe(0);

    updateThreeInteractionEffects(runtime, secondDeployment, 0.016, false);
    expect(runtime.particles).toHaveLength(0);

    const geometryDispose = vi.spyOn(runtime.geometry, "dispose");
    const materialDispose = vi.spyOn(runtime.material, "dispose");
    disposeThreeInteractionEffects(runtime);
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
  });

  it("calculates deterministic motion and expires finished particles", () => {
    const initial = interactionState("interaction-particle-pose");
    const runtime = createThreeInteractionEffects(initial);
    const deployed = cloneState(initial);
    deployed.elapsedMs = 100;
    deployed.players.player.astronaut.tetherKits -= 1;
    deployed.anchors = [anchor(
      "anchor-pose",
      "player",
      { x: 139, y: 239 },
      baseId("player"),
    )];
    updateThreeInteractionEffects(runtime, deployed, 0.016, false);

    const travelingParticle = runtime.particles.find(({ target }) => target !== null)!;
    const activeAge = travelingParticle.delaySeconds
      + travelingParticle.lifetimeSeconds * 0.4;
    const firstPose = calculateThreeInteractionParticlePose(
      travelingParticle,
      activeAge,
    );
    const repeatedPose = calculateThreeInteractionParticlePose(
      travelingParticle,
      activeAge,
    );
    const finishedPose = calculateThreeInteractionParticlePose(
      travelingParticle,
      travelingParticle.delaySeconds + travelingParticle.lifetimeSeconds,
    );

    expect(repeatedPose).toEqual(firstPose);
    expect(firstPose.opacity).toBeGreaterThan(0);
    expect(firstPose.x).not.toBe(travelingParticle.origin.x);
    expect(firstPose.x).not.toBe(travelingParticle.target!.x);
    expect(finishedPose.opacity).toBe(0);

    for (let frame = 0; frame < 20; frame += 1) {
      updateThreeInteractionEffects(runtime, deployed, 0.1, false);
    }
    expect(runtime.particles).toHaveLength(0);
    expect(runtime.geometry.drawRange.count).toBe(0);

    disposeThreeInteractionEffects(runtime);
  });
});

function interactionState(seed: string): GameState {
  const state = createInitialGameState(seed, 2);
  state.salvage = [];
  return state;
}

function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

function anchor(
  id: string,
  owner: PlayerId,
  position: Vec2,
  parentId: string,
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

function kinds(events: readonly { kind: string }[]) {
  return events.map(({ kind }) => kind);
}
