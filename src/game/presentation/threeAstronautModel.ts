import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { publicAssetUrl } from "../assetUrl";
import type { AstronautState, MovementState, PlayerId, Vec2 } from "../types";
import {
  loadThreeModelAsset,
  preloadThreeModelAsset,
} from "./threeModelAssetCache";

const MODEL_URLS = {
  player: publicAssetUrl("astronauts/Astronaut_Blue.glb"),
  rival: publicAssetUrl("astronauts/Astronaut_Red.glb"),
  player3: publicAssetUrl("astronauts/Astronaut_Green.glb"),
  player4: publicAssetUrl("astronauts/Astronaut_Yellow.glb"),
} as const satisfies Readonly<Record<PlayerId, string>>;

const REQUIRED_CLIPS = {
  idle: "Idle_5",
  running: "Running",
  boosting: "Quad_Jump_Up",
} as const;

const TARGET_FOOTPRINT_SIZE = 15.2;
const SHADOW_RADIUS = TARGET_FOOTPRINT_SIZE * 0.3;
const TRANSITION_SECONDS = 0.14;
const MOVING_SPEED_EPSILON = 0.01;

export type ThreeAstronautAnimationState = keyof typeof REQUIRED_CLIPS;

export interface ThreeAstronautRig {
  readonly root: THREE.Group;
  readonly heading: THREE.Group;
  readonly model: THREE.Group;
  readonly source: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer;
  readonly actions: Readonly<Record<ThreeAstronautAnimationState, THREE.AnimationAction>>;
  activeAnimation: ThreeAstronautAnimationState;
  activeAction: THREE.AnimationAction;
}

export interface ThreeAstronautPose {
  readonly headingRotation: number;
  readonly animation: ThreeAstronautAnimationState;
}

export function preloadThreeAstronautAsset(playerId: PlayerId) {
  preloadThreeModelAsset(MODEL_URLS[playerId]);
}

export async function loadThreeAstronautAsset(playerId: PlayerId) {
  return loadThreeModelAsset(MODEL_URLS[playerId]);
}

/**
 * Uses the rig, materials, and animation clips embedded in the player's GLB.
 * The only presentation transform rotates the Y-up asset onto the world plane,
 * giving the orthographic game camera a strict view down onto the model's top.
 */
export function createThreeAstronautModel(
  playerId: PlayerId,
  asset: GLTF,
): ThreeAstronautRig {
  const source = asset.scene;
  source.name = `rigged-astronaut-source-${playerId}`;
  source.updateMatrixWorld(true);
  source.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.frustumCulled = false;
  });

  const bounds = new THREE.Box3().setFromObject(source);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const footprintSize = Math.max(size.x, size.z, 0.001);

  // Center X/Z around the gameplay position and place the soles at model Y=0.
  source.position.set(-center.x, -bounds.min.y, -center.z);

  const normalized = new THREE.Group();
  normalized.scale.setScalar(TARGET_FOOTPRINT_SIZE / footprintSize);
  normalized.add(source);

  const model = new THREE.Group();
  model.name = `rigged-astronaut-model-${playerId}`;
  // glTF is Y-up. This maps its vertical Y axis to world Z without any camera tilt.
  model.rotation.x = Math.PI / 2;
  model.add(normalized);

  const root = new THREE.Group();
  root.name = `astronaut-${playerId}`;
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(SHADOW_RADIUS, 24),
    new THREE.MeshBasicMaterial({
      color: 0x02070b,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    }),
  );
  shadow.name = `astronaut-${playerId}-shadow`;
  shadow.position.set(TARGET_FOOTPRINT_SIZE * 0.045, -TARGET_FOOTPRINT_SIZE * 0.04, 0.02);
  shadow.renderOrder = -1;
  root.add(shadow);

  const heading = new THREE.Group();
  heading.add(model);
  root.add(heading);

  const mixer = new THREE.AnimationMixer(source);
  const actions = createRequiredActions(asset.animations, mixer);
  actions.boosting.setLoop(THREE.LoopOnce, 1);
  actions.boosting.clampWhenFinished = true;
  actions.idle.play();
  // Apply the first authored Idle_5 pose immediately. This also gives players
  // who prefer reduced motion a proper frozen idle pose instead of the bind pose.
  mixer.update(0);

  return {
    root,
    heading,
    model,
    source,
    mixer,
    actions,
    activeAnimation: "idle",
    activeAction: actions.idle,
  };
}

export function calculateThreeAstronautPose(
  movement: Pick<MovementState, "mode" | "velocity" | "headingRadians" | "facing">,
): ThreeAstronautPose {
  const heading = Number.isFinite(movement.headingRadians)
    ? movement.headingRadians
    : Math.atan2(movement.facing.y, movement.facing.x);
  return {
    // The model's original +Z is its front. After the overhead transform that
    // points toward world -Y, so this offset aligns it with the game heading.
    headingRotation: -heading + Math.PI / 2,
    animation: getThreeAstronautAnimationState(movement),
  };
}

export function getThreeAstronautAnimationState(
  movement: Pick<MovementState, "mode" | "velocity">,
): ThreeAstronautAnimationState {
  if (movement.mode === "burst") return "boosting";
  const speed = Math.hypot(movement.velocity.x, movement.velocity.y);
  if (
    movement.mode === "walking" &&
    Number.isFinite(speed) &&
    speed > MOVING_SPEED_EPSILON
  ) {
    return "running";
  }
  return "idle";
}

export function updateThreeAstronautModel(
  rig: ThreeAstronautRig,
  astronaut: AstronautState,
  position: Vec2,
  deltaSeconds: number,
  reduceMotion = false,
) {
  const pose = calculateThreeAstronautPose(astronaut.movement);
  const animation = reduceMotion ? "idle" : pose.animation;

  rig.root.position.set(position.x, -position.y, 0);
  rig.heading.rotation.z = pose.headingRotation;
  if (animation !== rig.activeAnimation) transitionTo(rig, animation);
  if (!reduceMotion) rig.mixer.update(clamp(deltaSeconds, 0, 0.1));
}

export function disposeThreeAstronautModel(rig: ThreeAstronautRig) {
  rig.mixer.stopAllAction();
  rig.mixer.uncacheRoot(rig.source);
  disposeThreeObject(rig.root);
}

export function disposeThreeAstronautAsset(asset: GLTF) {
  disposeThreeObject(asset.scene);
}

function createRequiredActions(
  clips: THREE.AnimationClip[],
  mixer: THREE.AnimationMixer,
): Record<ThreeAstronautAnimationState, THREE.AnimationAction> {
  const result = {} as Record<ThreeAstronautAnimationState, THREE.AnimationAction>;
  for (const [state, clipName] of Object.entries(REQUIRED_CLIPS) as Array<
    [ThreeAstronautAnimationState, string]
  >) {
    const clip = THREE.AnimationClip.findByName(clips, clipName);
    if (!clip) throw new Error(`Astronaut model is missing animation clip "${clipName}".`);
    result[state] = mixer.clipAction(clip);
  }
  return result;
}

function transitionTo(
  rig: ThreeAstronautRig,
  animation: ThreeAstronautAnimationState,
) {
  const nextAction = rig.actions[animation];
  nextAction.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
  rig.activeAction.crossFadeTo(nextAction, TRANSITION_SECONDS, false);
  rig.activeAnimation = animation;
  rig.activeAction = nextAction;
}

function disposeThreeObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const skeletons = new Set<THREE.Skeleton>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
    geometries.add(object.geometry);
    const meshMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material];
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
  for (const skeleton of skeletons) skeleton.dispose();
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
