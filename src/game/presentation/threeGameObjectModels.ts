import * as THREE from "three";
import {
  GLTFLoader,
  type GLTF,
} from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  getAnchorPowerState,
  type AnchorPowerState,
} from "../simulation/tetherConflict";
import { TERRAIN_TEAM_COLORS } from "./terrainLighting";
import type { GameState, PlayerId, Vec2 } from "../types";

const MODEL_URLS = {
  salvage: "/assets/game-objects/Tether_Nugget.glb",
  homeBase: {
    player: "/assets/game-objects/Player_Core_Blue.glb",
    rival: "/assets/game-objects/Player_Core_Red.glb",
    player3: "/assets/game-objects/Player_Core_Green.glb",
    player4: "/assets/game-objects/Player_Core_Yellow.glb",
  },
  anchor: {
    player: "/assets/game-objects/Tether_Anchor_Blue.glb",
    rival: "/assets/game-objects/Tether_Anchor_Red.glb",
    player3: "/assets/game-objects/Tether_Anchor_Green.glb",
    player4: "/assets/game-objects/Tether_Anchor_Yellow.glb",
  },
} as const satisfies {
  readonly salvage: string;
  readonly homeBase: Readonly<Record<PlayerId, string>>;
  readonly anchor: Readonly<Record<PlayerId, string>>;
};

export const THREE_OBJECT_FOOTPRINTS = {
  homeBase: 19.5,
  anchor: 7.6,
  salvage: 4.2,
} as const;

const TETHER_NUGGET_MAX_TILT = Math.PI / 18;

interface ObjectShadowStyle {
  readonly radiusScale: number;
  readonly opacity: number;
  readonly offsetXScale: number;
  readonly offsetYScale: number;
  readonly scaleY: number;
}

const DEFAULT_OBJECT_SHADOW: ObjectShadowStyle = {
  radiusScale: 0.43,
  opacity: 0.15,
  offsetXScale: 0.045,
  offsetYScale: -0.04,
  scaleY: 0.72,
};

const TETHER_NUGGET_SHADOW: ObjectShadowStyle = {
  radiusScale: 0.34,
  opacity: 0.24,
  offsetXScale: 0.07,
  offsetYScale: -0.06,
  scaleY: 0.82,
};

export type ThreeGameObjectKind = keyof typeof THREE_OBJECT_FOOTPRINTS;

interface AssetSlot {
  readonly kind: ThreeGameObjectKind;
  readonly playerId?: PlayerId;
  readonly url: string;
}

export interface ThreeGameObjectAssets {
  readonly salvage: GLTF;
  readonly homeBases: ReadonlyMap<PlayerId, GLTF>;
  readonly anchors: ReadonlyMap<PlayerId, GLTF>;
}

interface MaterialRecord {
  readonly material: THREE.MeshStandardMaterial;
  readonly baseColor: THREE.Color;
  readonly baseEmissive: THREE.Color;
  readonly baseEmissiveIntensity: number;
  readonly baseOpacity: number;
  readonly baseTransparent: boolean;
  readonly baseDepthWrite: boolean;
}

export interface ThreeGameObjectInstance {
  readonly root: THREE.Group;
  readonly idlePivot: THREE.Group;
  readonly model: THREE.Group;
  readonly source: THREE.Object3D;
  readonly ownedGeometries: readonly THREE.BufferGeometry[];
  readonly ownedMaterials: readonly THREE.Material[];
  readonly materialRecords: readonly MaterialRecord[];
}

export interface TetherNuggetOrientation {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ThreeGameObjectIdlePose {
  readonly scale: number;
  readonly rotationZ: number;
}

interface TeamObjectInstance extends ThreeGameObjectInstance {
  readonly playerId: PlayerId;
  powerState?: AnchorPowerState;
}

export interface ThreeGameObjectRuntime {
  readonly root: THREE.Group;
  readonly assets: ThreeGameObjectAssets;
  readonly homeBases: Map<PlayerId, ThreeGameObjectInstance>;
  readonly anchors: Map<string, TeamObjectInstance>;
  readonly salvage: Map<string, ThreeGameObjectInstance>;
}

export async function loadThreeGameObjectAssets(
  playerIds: readonly PlayerId[],
): Promise<ThreeGameObjectAssets> {
  const loader = new GLTFLoader();
  const slots: AssetSlot[] = [
    { kind: "salvage", url: MODEL_URLS.salvage },
    ...playerIds.flatMap((playerId): AssetSlot[] => [
      { kind: "homeBase", playerId, url: MODEL_URLS.homeBase[playerId] },
      { kind: "anchor", playerId, url: MODEL_URLS.anchor[playerId] },
    ]),
  ];
  const results = await Promise.allSettled(
    slots.map(async (slot) => ({
      slot,
      asset: await loader.loadAsync(slot.url),
    })),
  );
  const failed = results.find((result) => result.status === "rejected");
  if (failed) {
    for (const result of results) {
      if (result.status === "fulfilled") disposeGlTf(result.value.asset);
    }
    throw failed.reason;
  }

  const homeBases = new Map<PlayerId, GLTF>();
  const anchors = new Map<PlayerId, GLTF>();
  let salvage: GLTF | undefined;
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const { slot, asset } = result.value;
    if (slot.kind === "salvage") salvage = asset;
    else if (slot.kind === "homeBase" && slot.playerId) homeBases.set(slot.playerId, asset);
    else if (slot.playerId) anchors.set(slot.playerId, asset);
  }
  if (!salvage) throw new Error("Dropped-material model did not load.");

  return { salvage, homeBases, anchors };
}

export function createThreeGameObjectRuntime(
  assets: ThreeGameObjectAssets,
  state: Pick<GameState, "activePlayerIds" | "players" | "anchors" | "salvage" | "elapsedMs">,
  reduceMotion = false,
): ThreeGameObjectRuntime {
  const root = new THREE.Group();
  root.name = "game-object-models";
  const runtime: ThreeGameObjectRuntime = {
    root,
    assets,
    homeBases: new Map(),
    anchors: new Map(),
    salvage: new Map(),
  };

  try {
    for (const playerId of state.activePlayerIds) {
      const asset = assets.homeBases.get(playerId);
      if (!asset) throw new Error(`Home-base model did not load for ${playerId}.`);
      const instance = createThreeGameObjectInstance(
        asset,
        THREE_OBJECT_FOOTPRINTS.homeBase,
        `home-base-${playerId}`,
      );
      runtime.homeBases.set(playerId, instance);
      root.add(instance.root);
    }
    updateThreeGameObjectRuntime(runtime, state, reduceMotion);
    return runtime;
  } catch (error) {
    disposeRuntimeOwnedResources(runtime);
    throw error;
  }
}

export function createThreeGameObjectInstance(
  asset: GLTF,
  targetFootprint: number,
  name: string,
  cloneMaterials = false,
  shadowStyle: ObjectShadowStyle = DEFAULT_OBJECT_SHADOW,
): ThreeGameObjectInstance {
  const source = asset.scene.clone(true);
  source.name = `${name}-source`;
  const ownedMaterials: THREE.Material[] = [];
  const ownedGeometries: THREE.BufferGeometry[] = [];
  const materialRecords: MaterialRecord[] = [];
  source.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (!cloneMaterials) return;
    const cloned = (Array.isArray(object.material)
      ? object.material.map((material) => material.clone())
      : object.material.clone());
    object.material = cloned;
    const materials = Array.isArray(cloned) ? cloned : [cloned];
    for (const material of materials) {
      ownedMaterials.push(material);
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      materialRecords.push({
        material,
        baseColor: material.color.clone(),
        baseEmissive: material.emissive.clone(),
        baseEmissiveIntensity: material.emissiveIntensity,
        baseOpacity: material.opacity,
        baseTransparent: material.transparent,
        baseDepthWrite: material.depthWrite,
      });
    }
  });
  source.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(source);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const footprint = Math.max(size.x, size.y, 0.001);
  source.position.set(-center.x, -center.y, -bounds.min.z);

  const model = new THREE.Group();
  model.name = `${name}-model`;
  model.scale.setScalar(targetFootprint / footprint);
  model.add(source);

  const root = new THREE.Group();
  root.name = name;
  const idlePivot = new THREE.Group();
  idlePivot.name = `${name}-idle`;
  idlePivot.add(model);
  const shadowGeometry = new THREE.CircleGeometry(
    targetFootprint * shadowStyle.radiusScale,
    24,
  );
  const shadowMaterial = new THREE.MeshBasicMaterial({
    color: 0x02070b,
    transparent: true,
    opacity: shadowStyle.opacity,
    depthWrite: false,
  });
  ownedGeometries.push(shadowGeometry);
  ownedMaterials.push(shadowMaterial);
  const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
  shadow.name = `${name}-shadow`;
  shadow.position.set(
    targetFootprint * shadowStyle.offsetXScale,
    targetFootprint * shadowStyle.offsetYScale,
    0.01,
  );
  shadow.scale.y = shadowStyle.scaleY;
  shadow.renderOrder = -1;
  root.add(shadow, idlePivot);

  return {
    root,
    idlePivot,
    model,
    source,
    ownedGeometries,
    ownedMaterials,
    materialRecords,
  };
}

export function updateThreeGameObjectRuntime(
  runtime: ThreeGameObjectRuntime,
  state: Pick<GameState, "activePlayerIds" | "players" | "anchors" | "salvage" | "elapsedMs">,
  reduceMotion = false,
  animationTimeMs = state.elapsedMs,
) {
  for (const playerId of state.activePlayerIds) {
    const base = runtime.homeBases.get(playerId);
    if (base) {
      placeAt(base.root, state.players[playerId].basePosition);
    }
  }

  const visibleSalvage = new Set<string>();
  for (const deposit of state.salvage) {
    if (deposit.collected) continue;
    visibleSalvage.add(deposit.id);
    let instance = runtime.salvage.get(deposit.id);
    if (!instance) {
      instance = createThreeGameObjectInstance(
        runtime.assets.salvage,
        THREE_OBJECT_FOOTPRINTS.salvage,
        `salvage-${deposit.id}`,
        false,
        TETHER_NUGGET_SHADOW,
      );
      orientTetherNugget(instance, deposit.id);
      runtime.salvage.set(deposit.id, instance);
      runtime.root.add(instance.root);
    }
    placeAt(instance.root, deposit.position);
  }
  for (const [id, instance] of runtime.salvage) {
    if (visibleSalvage.has(id)) continue;
    runtime.root.remove(instance.root);
    runtime.salvage.delete(id);
    disposeOwnedResources(instance);
  }

  const visibleAnchors = new Set<string>();
  for (const anchor of state.anchors) {
    visibleAnchors.add(anchor.id);
    let instance = runtime.anchors.get(anchor.id);
    if (!instance || instance.playerId !== anchor.owner) {
      if (instance) removeTeamInstance(runtime, anchor.id, instance);
      const asset = runtime.assets.anchors.get(anchor.owner);
      if (!asset) continue;
      instance = {
        ...createThreeGameObjectInstance(
          asset,
          THREE_OBJECT_FOOTPRINTS.anchor,
          `anchor-${anchor.id}`,
          true,
        ),
        playerId: anchor.owner,
      };
      runtime.anchors.set(anchor.id, instance);
      runtime.root.add(instance.root);
    }
    placeAt(instance.root, anchor.position);
    const powerState = getAnchorPowerState(anchor, state.elapsedMs);
    setAnchorPowerState(instance, powerState);
  }
  for (const [id, instance] of runtime.anchors) {
    if (visibleAnchors.has(id)) continue;
    removeTeamInstance(runtime, id, instance);
  }
  updateThreeGameObjectIdleEffects(runtime, animationTimeMs, reduceMotion);
}

export function updateThreeGameObjectIdleEffects(
  runtime: ThreeGameObjectRuntime,
  animationTimeMs: number,
  reduceMotion = false,
) {
  for (const [playerId, instance] of runtime.homeBases) {
    applyIdlePose(instance, "homeBase", playerId, animationTimeMs, reduceMotion);
  }
  for (const [id, instance] of runtime.salvage) {
    applyIdlePose(instance, "salvage", id, animationTimeMs, reduceMotion);
  }
  for (const [id, instance] of runtime.anchors) {
    applyIdlePose(
      instance,
      "anchor",
      id,
      animationTimeMs,
      reduceMotion,
      instance.powerState,
    );
  }
}

export function calculateThreeGameObjectIdlePose(
  kind: ThreeGameObjectKind,
  id: string,
  elapsedMs: number,
  reduceMotion = false,
  powerState: AnchorPowerState = "powered",
): ThreeGameObjectIdlePose {
  if (reduceMotion || (kind === "anchor" && powerState !== "powered" && powerState !== "shielded")) {
    return { scale: 1, rotationZ: 0 };
  }

  const seconds = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0) / 1_000;
  const phase = stableUnitInterval(`${id}:${kind}:idle-phase`) * Math.PI * 2;
  if (kind === "homeBase") {
    return {
      scale: 1 + Math.sin(seconds * Math.PI * 2 / 4.8 + phase) * 0.01,
      rotationZ: 0,
    };
  }
  if (kind === "anchor") {
    return {
      scale: 1 + Math.sin(seconds * Math.PI * 2 / 3.2 + phase) * 0.012,
      rotationZ: Math.sin(seconds * Math.PI * 2 / 3.2 + phase + Math.PI / 2)
        * Math.PI / 120,
    };
  }

  const direction = stableUnitInterval(`${id}:salvage:idle-direction`) < 0.5 ? -1 : 1;
  return {
    scale: 1 + Math.sin(seconds * Math.PI * 2 / 2.8 + phase) * 0.02,
    rotationZ: phase + direction * seconds * Math.PI * 2 / 22,
  };
}

function applyIdlePose(
  instance: ThreeGameObjectInstance,
  kind: ThreeGameObjectKind,
  id: string,
  elapsedMs: number,
  reduceMotion: boolean,
  powerState: AnchorPowerState = "powered",
) {
  const pose = calculateThreeGameObjectIdlePose(
    kind,
    id,
    elapsedMs,
    reduceMotion,
    powerState,
  );
  instance.idlePivot.position.set(0, 0, 0);
  instance.idlePivot.rotation.set(0, 0, pose.rotationZ);
  instance.idlePivot.scale.setScalar(pose.scale);
}

export function getTetherNuggetOrientation(id: string): TetherNuggetOrientation {
  return {
    x: (stableUnitInterval(`${id}:tilt-x`) * 2 - 1) * TETHER_NUGGET_MAX_TILT,
    y: (stableUnitInterval(`${id}:tilt-y`) * 2 - 1) * TETHER_NUGGET_MAX_TILT,
    z: stableUnitInterval(`${id}:yaw`) * Math.PI * 2,
  };
}

function orientTetherNugget(instance: ThreeGameObjectInstance, id: string) {
  const orientation = getTetherNuggetOrientation(id);
  instance.model.rotation.set(orientation.x, orientation.y, orientation.z);
  instance.model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(instance.model);
  const center = bounds.getCenter(new THREE.Vector3());
  instance.model.position.set(-center.x, -center.y, -bounds.min.z);
}

function stableUnitInterval(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0x1_0000_0000;
}

export function disposeThreeGameObjectRuntime(runtime: ThreeGameObjectRuntime) {
  disposeRuntimeOwnedResources(runtime);
  disposeThreeGameObjectAssets(runtime.assets);
}

function disposeRuntimeOwnedResources(runtime: ThreeGameObjectRuntime) {
  for (const instance of runtime.homeBases.values()) disposeOwnedResources(instance);
  for (const instance of runtime.anchors.values()) disposeOwnedResources(instance);
  for (const instance of runtime.salvage.values()) disposeOwnedResources(instance);
  runtime.root.clear();
}

export function disposeThreeGameObjectAssets(assets: ThreeGameObjectAssets) {
  const unique = new Set<GLTF>([
    assets.salvage,
    ...assets.homeBases.values(),
    ...assets.anchors.values(),
  ]);
  for (const asset of unique) disposeGlTf(asset);
}

function setAnchorPowerState(instance: TeamObjectInstance, state: AnchorPowerState) {
  if (instance.powerState === state) return;
  const teamColor = new THREE.Color(TERRAIN_TEAM_COLORS[instance.playerId]);
  const neutral = new THREE.Color(0x71787d);
  for (const record of instance.materialRecords) {
    const { material } = record;
    material.color.copy(record.baseColor);
    material.emissive.copy(record.baseEmissive);
    material.emissiveIntensity = record.baseEmissiveIntensity;
    material.opacity = record.baseOpacity;
    material.transparent = record.baseTransparent;
    material.depthWrite = record.baseDepthWrite;
    if (state === "shielded") {
      material.emissive.lerp(teamColor, 0.42);
      material.emissiveIntensity = Math.max(0.68, record.baseEmissiveIntensity);
    } else if (state === "disrupted") {
      material.color.lerp(neutral, 0.48);
      material.opacity = 0.72;
      material.transparent = true;
      material.depthWrite = false;
      material.emissiveIntensity *= 0.2;
    } else if (state === "severed") {
      material.color.lerp(neutral, 0.76);
      material.opacity = 0.44;
      material.transparent = true;
      material.depthWrite = false;
      material.emissiveIntensity = 0;
    }
    material.needsUpdate = true;
  }
  instance.powerState = state;
}

function removeTeamInstance(
  runtime: ThreeGameObjectRuntime,
  id: string,
  instance: TeamObjectInstance,
) {
  runtime.root.remove(instance.root);
  runtime.anchors.delete(id);
  disposeOwnedResources(instance);
}

function disposeOwnedResources(instance: ThreeGameObjectInstance) {
  for (const geometry of instance.ownedGeometries) geometry.dispose();
  for (const material of instance.ownedMaterials) material.dispose();
}

function placeAt(root: THREE.Object3D, position: Vec2) {
  root.position.set(position.x, -position.y, 0);
}

function disposeGlTf(asset: GLTF) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  asset.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of meshMaterials) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}
