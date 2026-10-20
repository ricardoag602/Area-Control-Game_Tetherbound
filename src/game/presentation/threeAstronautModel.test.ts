import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  calculateThreeAstronautPose,
  createThreeAstronautModel,
  disposeThreeAstronautModel,
  getThreeAstronautAnimationState,
  smoothThreeAstronautHeading,
  updateThreeAstronautModel,
} from "./threeAstronautModel";

function movement(overrides: Record<string, unknown> = {}) {
  return {
    mode: "walking" as const,
    velocity: { x: 15.6, y: 0 },
    headingRadians: -Math.PI / 2,
    facing: { x: 0, y: -1 },
    ...overrides,
  };
}

describe("calculateThreeAstronautPose", () => {
  it("accounts for the imported model's forward axis when facing up", () => {
    expect(calculateThreeAstronautPose(movement()).headingRotation).toBeCloseTo(Math.PI);
  });

  it("turns the overhead model toward a rightward game heading", () => {
    const pose = calculateThreeAstronautPose(movement({ headingRadians: 0 }));
    expect(pose.headingRotation).toBeCloseTo(Math.PI / 2);
  });

  it("falls back to the facing vector when continuous heading is malformed", () => {
    const pose = calculateThreeAstronautPose(movement({ headingRadians: Number.NaN }));
    expect(pose.headingRotation).toBeCloseTo(Math.PI);
  });
});

describe("getThreeAstronautAnimationState", () => {
  it("uses Running only for ordinary movement with actual linear speed", () => {
    expect(getThreeAstronautAnimationState(movement())).toBe("running");
    expect(getThreeAstronautAnimationState(movement({ velocity: { x: 0, y: 0 } }))).toBe("idle");
  });

  it("uses Idle_5 while stationary or charging", () => {
    expect(getThreeAstronautAnimationState(movement({ mode: "idle" }))).toBe("idle");
    expect(getThreeAstronautAnimationState(movement({ mode: "charging" }))).toBe("idle");
  });

  it("uses Quad_Jump_Up for every authoritative burst frame", () => {
    expect(getThreeAstronautAnimationState(movement({
      mode: "burst",
      velocity: { x: 0, y: 0 },
    }))).toBe("boosting");
  });

  it("does not animate malformed velocity as running", () => {
    expect(getThreeAstronautAnimationState(movement({
      velocity: { x: Number.NaN, y: 0 },
    }))).toBe("idle");
  });
});

describe("smoothThreeAstronautHeading", () => {
  it("takes the shortest arc across the angle boundary", () => {
    const current = Math.PI - 0.05;
    const target = -Math.PI + 0.05;
    const next = smoothThreeAstronautHeading(current, target, 1 / 60);

    expect(next).toBeGreaterThan(current);
    expect(next).toBeLessThan(current + 0.1);
  });

  it("has the same response independent of frame cadence", () => {
    const target = Math.PI / 2;
    const singleFrame = smoothThreeAstronautHeading(0, target, 0.1);
    let tenFrames = 0;
    for (let index = 0; index < 10; index += 1) {
      tenFrames = smoothThreeAstronautHeading(tenFrames, target, 0.01);
    }

    expect(tenFrames).toBeCloseTo(singleFrame, 10);
  });
});

describe("createThreeAstronautModel", () => {
  it("normalizes the rendered astronaut to the intended footprint", () => {
    const rig = createThreeAstronautModel("player", astronautAsset());
    const normalized = rig.model.children[0];

    expect(normalized.scale.x).toBeCloseTo(15.2);
    expect(normalized.scale.y).toBeCloseTo(15.2);
    expect(normalized.scale.z).toBeCloseTo(15.2);

    disposeThreeAstronautModel(rig);
  });

  it("uses a circular contact shadow", () => {
    const rig = createThreeAstronautModel("player", astronautAsset());
    const shadow = rig.root.getObjectByName("astronaut-player-shadow") as THREE.Mesh;
    const geometry = shadow.geometry as THREE.CircleGeometry;

    expect(shadow.scale.x).toBe(1);
    expect(shadow.scale.y).toBe(1);
    expect(geometry.parameters.radius).toBeCloseTo(15.2 * 0.3);

    disposeThreeAstronautModel(rig);
  });

  it("snaps to the first heading, then smooths subsequent turns", () => {
    const rig = createThreeAstronautModel("player", astronautAsset());
    const astronaut = {
      movement: movement({ headingRadians: 0 }),
    } as Parameters<typeof updateThreeAstronautModel>[1];

    updateThreeAstronautModel(rig, astronaut, { x: 0, y: 0 }, 0, false);
    expect(rig.heading.rotation.z).toBeCloseTo(Math.PI / 2);

    astronaut.movement.headingRadians = Math.PI;
    updateThreeAstronautModel(rig, astronaut, { x: 0, y: 0 }, 1 / 60, false);
    expect(rig.heading.rotation.z).toBeLessThan(Math.PI / 2);
    expect(rig.heading.rotation.z).toBeGreaterThan(-Math.PI / 2);

    disposeThreeAstronautModel(rig);
  });

  it("snaps heading changes when reduced motion is enabled", () => {
    const rig = createThreeAstronautModel("player", astronautAsset());
    const astronaut = {
      movement: movement({ headingRadians: 0 }),
    } as Parameters<typeof updateThreeAstronautModel>[1];

    updateThreeAstronautModel(rig, astronaut, { x: 0, y: 0 }, 0, false);
    astronaut.movement.headingRadians = Math.PI;
    updateThreeAstronautModel(rig, astronaut, { x: 0, y: 0 }, 1 / 60, true);
    expect(rig.heading.rotation.z).toBeCloseTo(-Math.PI / 2);

    disposeThreeAstronautModel(rig);
  });
});

function astronautAsset(): GLTF {
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(
    new THREE.BoxGeometry(1, 2, 1),
    new THREE.MeshStandardMaterial({ color: 0xffffff }),
  ));
  return {
    scene,
    scenes: [scene],
    animations: ["Idle_5", "Running", "Quad_Jump_Up"].map(
      (name) => new THREE.AnimationClip(name, 1, []),
    ),
    cameras: [],
    asset: { version: "2.0" },
    parser: {} as GLTF["parser"],
    userData: {},
  };
}
