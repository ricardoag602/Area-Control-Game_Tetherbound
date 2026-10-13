import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Anchor, GameState, PlayerId } from "../types";
import {
  calculateThreeGameObjectIdlePose,
  createThreeGameObjectInstance,
  createThreeGameObjectRuntime,
  disposeThreeGameObjectRuntime,
  getTetherNuggetOrientation,
  THREE_OBJECT_FOOTPRINTS,
  updateThreeGameObjectRuntime,
  type ThreeGameObjectAssets,
} from "./threeGameObjectModels";

describe("calculateThreeGameObjectIdlePose", () => {
  it("is deterministic and stays within the subtle transform limits", () => {
    const random = vi.spyOn(Math, "random");
    const base = calculateThreeGameObjectIdlePose("homeBase", "player", 1_200);
    const anchor = calculateThreeGameObjectIdlePose("anchor", "anchor-1", 1_200);
    const nugget = calculateThreeGameObjectIdlePose("salvage", "salvage-1", 1_200);

    expect(calculateThreeGameObjectIdlePose("salvage", "salvage-1", 1_200)).toEqual(nugget);
    expect(random).not.toHaveBeenCalled();
    expect(base.scale).toBeGreaterThanOrEqual(0.99);
    expect(base.scale).toBeLessThanOrEqual(1.01);
    expect(Math.abs(anchor.rotationZ)).toBeLessThanOrEqual(Math.PI / 120);
    expect(anchor.scale).toBeGreaterThanOrEqual(0.988);
    expect(anchor.scale).toBeLessThanOrEqual(1.012);
    expect(nugget.scale).toBeGreaterThanOrEqual(0.98);
    expect(nugget.scale).toBeLessThanOrEqual(1.02);
    random.mockRestore();
  });

  it("freezes decorative motion for reduced motion and inactive anchors", () => {
    expect(calculateThreeGameObjectIdlePose("salvage", "salvage-1", 9_000, true))
      .toEqual({ scale: 1, rotationZ: 0 });
    expect(calculateThreeGameObjectIdlePose("anchor", "anchor-1", 9_000, false, "disrupted"))
      .toEqual({ scale: 1, rotationZ: 0 });
    expect(calculateThreeGameObjectIdlePose("anchor", "anchor-1", 9_000, false, "severed"))
      .toEqual({ scale: 1, rotationZ: 0 });
  });
});

describe("getTetherNuggetOrientation", () => {
  it("derives a stable orientation from the deposit ID without runtime randomness", () => {
    const random = vi.spyOn(Math, "random");
    const first = getTetherNuggetOrientation("salvage-42");
    const second = getTetherNuggetOrientation("salvage-42");

    expect(second).toEqual(first);
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });

  it("varies yaw and keeps each lean within ten degrees", () => {
    const first = getTetherNuggetOrientation("salvage-1");
    const second = getTetherNuggetOrientation("salvage-2");

    expect(second).not.toEqual(first);
    for (const orientation of [first, second]) {
      expect(Math.abs(orientation.x)).toBeLessThanOrEqual(Math.PI / 18);
      expect(Math.abs(orientation.y)).toBeLessThanOrEqual(Math.PI / 18);
      expect(orientation.z).toBeGreaterThanOrEqual(0);
      expect(orientation.z).toBeLessThan(Math.PI * 2);
    }
  });
});

describe("createThreeGameObjectInstance", () => {
  it("normalizes the authored XY footprint and grounds the model on local Z", () => {
    const asset = boxAsset(2, 1, 0.5);
    const instance = createThreeGameObjectInstance(asset, 6, "test-object");
    const bounds = new THREE.Box3().setFromObject(instance.model);
    const size = bounds.getSize(new THREE.Vector3());

    expect(size.x).toBeCloseTo(6);
    expect(size.y).toBeCloseTo(3);
    expect(bounds.min.z).toBeCloseTo(0);
    expect(instance.model.rotation.x).toBe(0);
  });
});

describe("ThreeGameObjectRuntime", () => {
  it("matches sprite footprints and mirrors game Y into the Three.js world", () => {
    const asset = boxAsset(2, 1, 0.5);
    const assets = objectAssets(asset);
    const state = objectState();
    const runtime = createThreeGameObjectRuntime(assets, state, true);

    const base = runtime.homeBases.get("player");
    const anchor = runtime.anchors.get("anchor-1");
    const salvage = runtime.salvage.get("salvage-1");
    expect(modelFootprint(base?.model)).toBeCloseTo(THREE_OBJECT_FOOTPRINTS.homeBase);
    expect(modelFootprint(anchor?.model)).toBeCloseTo(THREE_OBJECT_FOOTPRINTS.anchor);
    expect(salvage?.model.scale.x).toBeCloseTo(THREE_OBJECT_FOOTPRINTS.salvage / 2);
    expect(base?.root.position.toArray()).toEqual([2, -3, 0]);
    expect(anchor?.root.position.toArray()).toEqual([12, -3, 0]);
    expect(salvage?.root.position.toArray()).toEqual([7, -9, 0]);

    disposeThreeGameObjectRuntime(runtime);
  });

  it("keeps each nugget's varied orientation stable, grounded, and tied to its ID", () => {
    const asset = boxAsset(2, 1, 0.5);
    const state = {
      ...objectState(),
      salvage: [
        { id: "salvage-1", position: { x: 7, y: 9 }, collected: false },
        { id: "salvage-2", position: { x: 9, y: 5 }, collected: false },
      ],
    };
    const runtime = createThreeGameObjectRuntime(objectAssets(asset), state);
    const first = runtime.salvage.get("salvage-1");
    const second = runtime.salvage.get("salvage-2");
    const firstQuaternion = first?.model.quaternion.toArray();

    expect(firstQuaternion).not.toEqual(second?.model.quaternion.toArray());
    expect(new THREE.Box3().setFromObject(first!.model).min.z).toBeCloseTo(0);
    expect(first?.root.position.toArray()).toEqual([7, -9, 0]);

    updateThreeGameObjectRuntime(runtime, {
      ...state,
      salvage: [...state.salvage].reverse(),
    });
    expect(first?.model.quaternion.toArray()).toEqual(firstQuaternion);

    updateThreeGameObjectRuntime(runtime, {
      ...state,
      salvage: state.salvage.map((deposit) => (
        deposit.id === "salvage-1" ? { ...deposit, collected: true } : deposit
      )),
    });
    updateThreeGameObjectRuntime(runtime, state);
    expect(runtime.salvage.get("salvage-1")?.model.quaternion.toArray()).toEqual(firstQuaternion);

    disposeThreeGameObjectRuntime(runtime);
  });

  it("gives nuggets a small, visible contact shadow", () => {
    const asset = boxAsset(2, 1, 0.5);
    const runtime = createThreeGameObjectRuntime(objectAssets(asset), objectState());
    const nugget = runtime.salvage.get("salvage-1")!;
    const shadow = nugget.root.getObjectByName("salvage-salvage-1-shadow") as THREE.Mesh;
    const geometry = shadow.geometry as THREE.CircleGeometry;
    const material = shadow.material as THREE.MeshBasicMaterial;

    expect(geometry.parameters.radius).toBeCloseTo(THREE_OBJECT_FOOTPRINTS.salvage * 0.34);
    expect(shadow.scale.y).toBeCloseTo(0.82);
    expect(material.opacity).toBeCloseTo(0.24);

    disposeThreeGameObjectRuntime(runtime);
  });

  it("animates only visual pivots and resets them for reduced motion", () => {
    const asset = boxAsset(2, 1, 0.5);
    const initial = objectState();
    const runtime = createThreeGameObjectRuntime(objectAssets(asset), initial, true);
    const base = runtime.homeBases.get("player")!;
    const anchor = runtime.anchors.get("anchor-1")!;
    const nugget = runtime.salvage.get("salvage-1")!;
    const nuggetModelQuaternion = nugget.model.quaternion.toArray();
    const shadow = nugget.root.getObjectByName("salvage-salvage-1-shadow")!;
    const shadowTransform = {
      position: shadow.position.toArray(),
      scale: shadow.scale.toArray(),
    };

    updateThreeGameObjectRuntime(runtime, { ...initial, elapsedMs: 1_200 });

    expect(base.idlePivot.scale.x).not.toBe(1);
    expect(anchor.idlePivot.rotation.z).not.toBe(0);
    expect(nugget.idlePivot.rotation.z).not.toBe(0);
    expect(nugget.model.quaternion.toArray()).toEqual(nuggetModelQuaternion);
    expect(nugget.root.position.toArray()).toEqual([7, -9, 0]);
    expect(shadow.position.toArray()).toEqual(shadowTransform.position);
    expect(shadow.scale.toArray()).toEqual(shadowTransform.scale);

    updateThreeGameObjectRuntime(runtime, { ...initial, elapsedMs: 2_400 }, true);
    for (const instance of [base, anchor, nugget]) {
      expect(instance.idlePivot.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
      expect(instance.idlePivot.scale.toArray()).toEqual([1, 1, 1]);
    }

    disposeThreeGameObjectRuntime(runtime);
  });

  it("keeps powered anchor textures crisp and reserves emissive color for shielding", () => {
    const asset = boxAsset(2, 1, 0.5);
    const initial = objectState();
    const runtime = createThreeGameObjectRuntime(objectAssets(asset), initial);
    const anchor = runtime.anchors.get("anchor-1")!;
    const material = anchor.materialRecords[0].material;

    expect(material.emissive.getHex()).toBe(0x000000);

    updateThreeGameObjectRuntime(runtime, {
      ...initial,
      anchors: initial.anchors.map((item) => ({
        ...item,
        protectedUntilMs: 10_000,
      })),
    });

    expect(material.emissive.getHex()).not.toBe(0x000000);

    updateThreeGameObjectRuntime(runtime, {
      ...initial,
      anchors: initial.anchors.map((item) => ({
        ...item,
        powered: false,
        disruptedUntilMs: null,
      })),
    });

    expect(material.emissiveIntensity).toBe(0);
    disposeThreeGameObjectRuntime(runtime);
  });

  it("removes collected material and anchors without disposing shared templates early", () => {
    const asset = boxAsset(2, 1, 0.5);
    const runtime = createThreeGameObjectRuntime(objectAssets(asset), objectState());
    updateThreeGameObjectRuntime(runtime, {
      ...objectState(),
      anchors: [],
      salvage: [{ id: "salvage-1", position: { x: 7, y: 9 }, collected: true }],
    });

    expect(runtime.anchors.size).toBe(0);
    expect(runtime.salvage.size).toBe(0);
    expect(runtime.homeBases.size).toBe(1);

    disposeThreeGameObjectRuntime(runtime);
  });
});

function boxAsset(width: number, depth: number, height: number): GLTF {
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(
    new THREE.BoxGeometry(width, depth, height),
    new THREE.MeshStandardMaterial({ color: 0xffffff }),
  ));
  return {
    scene,
    scenes: [scene],
    animations: [],
    cameras: [],
    asset: { version: "2.0" },
    parser: {} as GLTF["parser"],
    userData: {},
  };
}

function objectAssets(asset: GLTF): ThreeGameObjectAssets {
  return {
    salvage: asset,
    homeBases: new Map<PlayerId, GLTF>([["player", asset]]),
    anchors: new Map<PlayerId, GLTF>([["player", asset]]),
  };
}

function objectState(): Pick<
  GameState,
  "activePlayerIds" | "players" | "anchors" | "salvage" | "elapsedMs"
> {
  const anchor: Anchor = {
    id: "anchor-1",
    owner: "player",
    position: { x: 12, y: 3 },
    parentId: "player-base",
    powered: true,
    disruptedUntilMs: null,
    protectedUntilMs: null,
    overloadProgress: 0,
    repairProgress: 0,
  };
  return {
    activePlayerIds: ["player"],
    players: {
      player: { basePosition: { x: 2, y: 3 } },
    } as GameState["players"],
    anchors: [anchor],
    salvage: [{ id: "salvage-1", position: { x: 7, y: 9 }, collected: false }],
    elapsedMs: 0,
  };
}

function modelFootprint(model: THREE.Object3D | undefined) {
  if (!model) return 0;
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  return Math.max(size.x, size.y);
}
