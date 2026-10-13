import * as THREE from "three";
import type { GameState, PlayerId, Vec2 } from "../types";
import {
  collectThreeInteractionEvents,
  createThreeInteractionSnapshot,
  type InteractionState,
  type ThreeInteractionEvent,
  type ThreeInteractionSnapshot,
} from "./interactionEvents";
import { TERRAIN_TEAM_COLORS } from "./terrainLighting";

export {
  collectThreeInteractionEvents,
  createThreeInteractionSnapshot,
} from "./interactionEvents";
export type {
  ThreeInteractionEvent,
  ThreeInteractionEventResult,
  ThreeInteractionSnapshot,
} from "./interactionEvents";

export const THREE_INTERACTION_EFFECT_RULES = {
  maxParticles: 192,
  maximumDeltaSeconds: 0.1,
  groundZ: 0.075,
  overlayZ: 4.25,
  verticesPerParticle: 6,
} as const;

type InteractionParticleShape = "soft" | "ring" | "diamond";

export interface ThreeInteractionParticle {
  readonly id: string;
  readonly shape: InteractionParticleShape;
  readonly origin: Vec2;
  readonly target: Vec2 | null;
  readonly velocity: Vec2;
  readonly lifetimeSeconds: number;
  readonly delaySeconds: number;
  readonly startWidth: number;
  readonly startHeight: number;
  readonly endWidth: number;
  readonly endHeight: number;
  readonly peakOpacity: number;
  readonly color: number;
  readonly rotation: number;
  readonly angularVelocity: number;
  readonly z: number;
  ageSeconds: number;
}

export interface ThreeInteractionParticlePose extends Vec2 {
  readonly width: number;
  readonly height: number;
  readonly opacity: number;
  readonly rotation: number;
  readonly z: number;
}

export interface ThreeInteractionEffectsRuntime {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.ShaderMaterial;
  readonly positionAttribute: THREE.BufferAttribute;
  readonly colorAttribute: THREE.BufferAttribute;
  readonly opacityAttribute: THREE.BufferAttribute;
  readonly shapeAttribute: THREE.BufferAttribute;
  readonly particles: ThreeInteractionParticle[];
  snapshot: ThreeInteractionSnapshot;
  observedState: InteractionState;
  observedElapsedMs: number;
  observedAnchors: GameState["anchors"];
  observedSalvage: GameState["salvage"];
  observedPlayers: GameState["players"];
  spawnSerial: number;
}

const QUAD_CORNERS = [
  -0.5, -0.5,
  0.5, 0.5,
  0.5, -0.5,
  -0.5, -0.5,
  -0.5, 0.5,
  0.5, 0.5,
] as const;

const SHAPE_CODES = {
  soft: 0,
  ring: 1,
  diamond: 2,
} as const satisfies Readonly<Record<InteractionParticleShape, number>>;

const PICKUP_GOLD = 0xffd86a;
const RUPTURE_WARM = 0xffa85c;
const ENERGY_WHITE = 0xf5fcff;
const COLOR_COMPONENT_CACHE = new Map<number, Readonly<{
  r: number;
  g: number;
  b: number;
}>>();

export function createThreeInteractionEffects(
  initialState: InteractionState,
): ThreeInteractionEffectsRuntime {
  const vertexCount = THREE_INTERACTION_EFFECT_RULES.maxParticles
    * THREE_INTERACTION_EFFECT_RULES.verticesPerParticle;
  const geometry = new THREE.BufferGeometry();
  const positionAttribute = dynamicAttribute(vertexCount * 3, 3);
  const colorAttribute = dynamicAttribute(vertexCount * 3, 3);
  const opacityAttribute = dynamicAttribute(vertexCount, 1);
  const shapeAttribute = dynamicAttribute(vertexCount, 1);
  const uv = new Float32Array(vertexCount * 2);
  for (
    let particleIndex = 0;
    particleIndex < THREE_INTERACTION_EFFECT_RULES.maxParticles;
    particleIndex += 1
  ) {
    uv.set([
      0, 0,
      1, 1,
      1, 0,
      0, 0,
      0, 1,
      1, 1,
    ], particleIndex * THREE_INTERACTION_EFFECT_RULES.verticesPerParticle * 2);
  }
  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute("effectColor", colorAttribute);
  geometry.setAttribute("effectOpacity", opacityAttribute);
  geometry.setAttribute("effectShape", shapeAttribute);
  geometry.setDrawRange(0, 0);

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute vec3 effectColor;
      attribute float effectOpacity;
      attribute float effectShape;
      varying vec2 effectUv;
      varying vec3 vEffectColor;
      varying float vEffectOpacity;
      varying float vEffectShape;

      void main() {
        effectUv = uv;
        vEffectColor = effectColor;
        vEffectOpacity = effectOpacity;
        vEffectShape = effectShape;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 effectUv;
      varying vec3 vEffectColor;
      varying float vEffectOpacity;
      varying float vEffectShape;

      void main() {
        vec2 centered = effectUv - vec2(0.5);
        float radius = length(centered);
        float softDisc = 1.0 - smoothstep(0.16, 0.5, radius);
        softDisc = pow(max(0.0, softDisc), 0.72);
        float outerRing = 1.0 - smoothstep(0.43, 0.5, radius);
        float innerRing = smoothstep(0.29, 0.39, radius);
        float ring = outerRing * innerRing;
        float diamondDistance = abs(centered.x) + abs(centered.y);
        float diamond = 1.0 - smoothstep(0.38, 0.5, diamondDistance);
        float alphaShape = vEffectShape < 0.5
          ? softDisc
          : (vEffectShape < 1.5 ? ring : diamond);
        float alpha = alphaShape * vEffectOpacity;
        if (alpha <= 0.002) discard;
        gl_FragColor = vec4(vEffectColor, alpha);
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "interaction-effects";
  mesh.frustumCulled = false;
  mesh.renderOrder = -0.25;

  return {
    mesh,
    geometry,
    material,
    positionAttribute,
    colorAttribute,
    opacityAttribute,
    shapeAttribute,
    particles: [],
    snapshot: createThreeInteractionSnapshot(initialState),
    observedState: initialState,
    observedElapsedMs: initialState.elapsedMs,
    observedAnchors: initialState.anchors,
    observedSalvage: initialState.salvage,
    observedPlayers: initialState.players,
    spawnSerial: 0,
  };
}

export function updateThreeInteractionEffects(
  runtime: ThreeInteractionEffectsRuntime,
  state: InteractionState,
  deltaSeconds: number,
  reduceMotion = false,
) {
  const events = hasNewInteractionState(runtime, state)
    ? observeInteractionState(runtime, state)
    : [];
  if (reduceMotion) {
    clearThreeInteractionEffects(runtime);
    return;
  }

  const seconds = clamp(
    Number.isFinite(deltaSeconds) ? deltaSeconds : 0,
    0,
    THREE_INTERACTION_EFFECT_RULES.maximumDeltaSeconds,
  );
  for (const particle of runtime.particles) particle.ageSeconds += seconds;
  removeExpiredParticles(runtime);
  for (const event of events) spawnEventParticles(runtime, event);
  if (runtime.particles.length === 0) {
    if (runtime.geometry.drawRange.count !== 0) {
      runtime.geometry.setDrawRange(0, 0);
    }
    return;
  }
  updateInteractionGeometry(runtime);
}

export function clearThreeInteractionEffects(
  runtime: ThreeInteractionEffectsRuntime,
  currentState?: InteractionState,
) {
  runtime.particles.length = 0;
  runtime.geometry.setDrawRange(0, 0);
  if (currentState) {
    runtime.snapshot = createThreeInteractionSnapshot(currentState);
    markInteractionStateObserved(runtime, currentState);
  }
}

export function disposeThreeInteractionEffects(runtime: ThreeInteractionEffectsRuntime) {
  runtime.mesh.removeFromParent();
  runtime.geometry.dispose();
  runtime.material.dispose();
  runtime.particles.length = 0;
}

export function calculateThreeInteractionParticlePose(
  particle: ThreeInteractionParticle,
  ageSeconds = particle.ageSeconds,
): ThreeInteractionParticlePose {
  const localAge = finiteOr(ageSeconds, 0) - particle.delaySeconds;
  if (localAge < 0 || localAge >= particle.lifetimeSeconds) {
    return {
      ...particle.origin,
      width: particle.startWidth,
      height: particle.startHeight,
      opacity: 0,
      rotation: particle.rotation,
      z: particle.z,
    };
  }

  const progress = clamp(localAge / particle.lifetimeSeconds, 0, 1);
  const travelProgress = smoothstep(progress);
  let x: number;
  let y: number;
  if (particle.target) {
    x = lerp(particle.origin.x, particle.target.x, travelProgress);
    y = lerp(particle.origin.y, particle.target.y, travelProgress);
  } else {
    const dampedAge = localAge * (1 - progress * 0.22);
    x = particle.origin.x + particle.velocity.x * dampedAge;
    y = particle.origin.y + particle.velocity.y * dampedAge;
  }
  const fadeIn = clamp(progress / 0.08, 0, 1);
  const fadeOut = 1 - smoothstep(clamp((progress - 0.52) / 0.48, 0, 1));

  return {
    x,
    y,
    width: lerp(particle.startWidth, particle.endWidth, travelProgress),
    height: lerp(particle.startHeight, particle.endHeight, travelProgress),
    opacity: particle.peakOpacity * fadeIn * fadeOut,
    rotation: particle.rotation + particle.angularVelocity * localAge,
    z: particle.z,
  };
}

function spawnEventParticles(
  runtime: ThreeInteractionEffectsRuntime,
  event: ThreeInteractionEvent,
) {
  if (event.kind === "anchor_deployed") {
    spawnAnchorDeployment(runtime, event);
  } else if (event.kind === "anchor_broken") {
    spawnAnchorRupture(runtime, event);
  } else if (event.kind === "salvage_picked_up") {
    spawnSalvagePickup(runtime, event);
  } else {
    spawnSalvageDeposit(runtime, event);
  }
}

function hasNewInteractionState(
  runtime: ThreeInteractionEffectsRuntime,
  state: InteractionState,
) {
  return (
    runtime.observedState !== state
    || runtime.observedElapsedMs !== state.elapsedMs
    || runtime.observedAnchors !== state.anchors
    || runtime.observedSalvage !== state.salvage
    || runtime.observedPlayers !== state.players
  );
}

function observeInteractionState(
  runtime: ThreeInteractionEffectsRuntime,
  state: InteractionState,
) {
  const result = collectThreeInteractionEvents(runtime.snapshot, state);
  runtime.snapshot = result.snapshot;
  markInteractionStateObserved(runtime, state);
  return result.events;
}

function markInteractionStateObserved(
  runtime: ThreeInteractionEffectsRuntime,
  state: InteractionState,
) {
  runtime.observedState = state;
  runtime.observedElapsedMs = state.elapsedMs;
  runtime.observedAnchors = state.anchors;
  runtime.observedSalvage = state.salvage;
  runtime.observedPlayers = state.players;
}

function spawnAnchorDeployment(
  runtime: ThreeInteractionEffectsRuntime,
  event: Extract<ThreeInteractionEvent, { kind: "anchor_deployed" }>,
) {
  const teamColor = TERRAIN_TEAM_COLORS[event.playerId];
  addParticle(runtime, {
    id: `${event.kind}:${event.id}:ring`,
    shape: "ring",
    origin: event.position,
    lifetimeSeconds: 0.72,
    startWidth: 3.5,
    startHeight: 3.5,
    endWidth: 20,
    endHeight: 20,
    peakOpacity: 0.82,
    color: teamColor,
    z: THREE_INTERACTION_EFFECT_RULES.groundZ,
  });
  addParticle(runtime, {
    id: `${event.kind}:${event.id}:flash-team`,
    shape: "soft",
    origin: event.position,
    lifetimeSeconds: 0.42,
    startWidth: 3,
    startHeight: 3,
    endWidth: 12,
    endHeight: 12,
    peakOpacity: 0.74,
    color: teamColor,
    z: THREE_INTERACTION_EFFECT_RULES.overlayZ,
  });
  addParticle(runtime, {
    id: `${event.kind}:${event.id}:flash-white`,
    shape: "soft",
    origin: event.position,
    delaySeconds: 0.035,
    lifetimeSeconds: 0.28,
    startWidth: 1.2,
    startHeight: 1.2,
    endWidth: 6.5,
    endHeight: 6.5,
    peakOpacity: 0.94,
    color: ENERGY_WHITE,
    z: THREE_INTERACTION_EFFECT_RULES.overlayZ + 0.02,
  });

  const cableDistance = distance(event.parentPosition, event.position);
  const cableAngle = Math.atan2(
    event.position.y - event.parentPosition.y,
    event.position.x - event.parentPosition.x,
  );
  const waveLifetime = clamp(cableDistance / 74, 0.34, 0.82);
  for (let index = 0; index < 5; index += 1) {
    addParticle(runtime, {
      id: `${event.kind}:${event.id}:wave:${index}`,
      shape: index % 2 === 0 ? "soft" : "diamond",
      origin: event.parentPosition,
      target: event.position,
      delaySeconds: index * 0.055,
      lifetimeSeconds: waveLifetime,
      startWidth: index % 2 === 0 ? 4 : 2.5,
      startHeight: index % 2 === 0 ? 1.6 : 1.05,
      endWidth: index % 2 === 0 ? 2.2 : 1.1,
      endHeight: index % 2 === 0 ? 0.9 : 0.55,
      peakOpacity: index % 2 === 0 ? 0.66 : 0.94,
      color: index % 2 === 0 ? teamColor : ENERGY_WHITE,
      rotation: cableAngle,
      z: THREE_INTERACTION_EFFECT_RULES.groundZ + 0.035,
    });
  }

  spawnRadialDiamonds(
    runtime,
    `${event.kind}:${event.id}:spark`,
    event.position,
    teamColor,
    7,
    6,
    11,
    0.42,
    THREE_INTERACTION_EFFECT_RULES.overlayZ + 0.04,
  );
}

function spawnAnchorRupture(
  runtime: ThreeInteractionEffectsRuntime,
  event: Extract<ThreeInteractionEvent, { kind: "anchor_broken" }>,
) {
  const teamColor = TERRAIN_TEAM_COLORS[event.playerId];
  addParticle(runtime, {
    id: `${event.kind}:${event.id}:rupture`,
    shape: "soft",
    origin: event.position,
    lifetimeSeconds: 0.34,
    startWidth: 3.5,
    startHeight: 3.5,
    endWidth: 15,
    endHeight: 15,
    peakOpacity: 0.92,
    color: ENERGY_WHITE,
    z: THREE_INTERACTION_EFFECT_RULES.overlayZ,
  });
  addParticle(runtime, {
    id: `${event.kind}:${event.id}:ring`,
    shape: "ring",
    origin: event.position,
    lifetimeSeconds: 0.58,
    startWidth: 4,
    startHeight: 4,
    endWidth: 21,
    endHeight: 21,
    peakOpacity: 0.88,
    color: RUPTURE_WARM,
    z: THREE_INTERACTION_EFFECT_RULES.groundZ + 0.02,
  });
  spawnRadialDiamonds(
    runtime,
    `${event.kind}:${event.id}:debris-team`,
    event.position,
    teamColor,
    8,
    10,
    18,
    0.72,
    THREE_INTERACTION_EFFECT_RULES.overlayZ + 0.05,
  );
  spawnRadialDiamonds(
    runtime,
    `${event.kind}:${event.id}:debris-warm`,
    event.position,
    RUPTURE_WARM,
    6,
    8,
    15,
    0.64,
    THREE_INTERACTION_EFFECT_RULES.overlayZ + 0.07,
  );
}

function spawnSalvagePickup(
  runtime: ThreeInteractionEffectsRuntime,
  event: Extract<ThreeInteractionEvent, { kind: "salvage_picked_up" }>,
) {
  addParticle(runtime, {
    id: `${event.kind}:${event.id}:ring`,
    shape: "ring",
    origin: event.position,
    lifetimeSeconds: 0.42,
    startWidth: 1.8,
    startHeight: 1.8,
    endWidth: 8.5,
    endHeight: 8.5,
    peakOpacity: 0.78,
    color: PICKUP_GOLD,
    z: THREE_INTERACTION_EFFECT_RULES.groundZ + 0.03,
  });
  addParticle(runtime, {
    id: `${event.kind}:${event.id}:flash`,
    shape: "soft",
    origin: event.position,
    lifetimeSeconds: 0.28,
    startWidth: 1.3,
    startHeight: 1.3,
    endWidth: 5.6,
    endHeight: 5.6,
    peakOpacity: 0.9,
    color: ENERGY_WHITE,
    z: THREE_INTERACTION_EFFECT_RULES.overlayZ,
  });
  spawnRadialDiamonds(
    runtime,
    `${event.kind}:${event.id}:spark`,
    event.position,
    PICKUP_GOLD,
    5,
    5,
    9,
    0.46,
    THREE_INTERACTION_EFFECT_RULES.overlayZ + 0.03,
  );
}

function spawnSalvageDeposit(
  runtime: ThreeInteractionEffectsRuntime,
  event: Extract<ThreeInteractionEvent, { kind: "salvage_deposited" }>,
) {
  const teamColor = TERRAIN_TEAM_COLORS[event.playerId];
  const intensity = clamp(0.9 + event.amount * 0.08, 0.9, 1.25);
  addParticle(runtime, {
    id: `${event.kind}:${event.playerId}:${event.nodeId}:ring`,
    shape: "ring",
    origin: event.position,
    lifetimeSeconds: 0.55,
    startWidth: 3,
    startHeight: 3,
    endWidth: 12 * intensity,
    endHeight: 12 * intensity,
    peakOpacity: 0.84,
    color: teamColor,
    z: THREE_INTERACTION_EFFECT_RULES.groundZ + 0.025,
  });
  addParticle(runtime, {
    id: `${event.kind}:${event.playerId}:${event.nodeId}:flash`,
    shape: "soft",
    origin: event.position,
    delaySeconds: 0.09,
    lifetimeSeconds: 0.34,
    startWidth: 1.5,
    startHeight: 1.5,
    endWidth: 7.5 * intensity,
    endHeight: 7.5 * intensity,
    peakOpacity: 0.86,
    color: ENERGY_WHITE,
    z: THREE_INTERACTION_EFFECT_RULES.overlayZ,
  });
  for (let index = 0; index < 8; index += 1) {
    const angle = index / 8 * Math.PI * 2
      + sampledRange(`${event.playerId}:${event.nodeId}`, index, -0.16, 0.16);
    const radius = sampledRange(
      `${event.playerId}:${event.nodeId}:radius`,
      index,
      4.5,
      7.5,
    ) * intensity;
    addParticle(runtime, {
      id: `${event.kind}:${event.playerId}:${event.nodeId}:inward:${index}`,
      shape: "diamond",
      origin: {
        x: event.position.x + Math.cos(angle) * radius,
        y: event.position.y + Math.sin(angle) * radius,
      },
      target: event.position,
      delaySeconds: index * 0.025,
      lifetimeSeconds: 0.42,
      startWidth: 1.25,
      startHeight: 0.7,
      endWidth: 0.5,
      endHeight: 0.35,
      peakOpacity: 0.92,
      color: index % 3 === 0 ? ENERGY_WHITE : teamColor,
      rotation: angle,
      angularVelocity: index % 2 === 0 ? 3.2 : -3.2,
      z: THREE_INTERACTION_EFFECT_RULES.overlayZ + 0.04,
    });
  }
}

function spawnRadialDiamonds(
  runtime: ThreeInteractionEffectsRuntime,
  idPrefix: string,
  origin: Vec2,
  color: number,
  count: number,
  minimumSpeed: number,
  maximumSpeed: number,
  lifetimeSeconds: number,
  z: number,
) {
  for (let index = 0; index < count; index += 1) {
    const angle = index / count * Math.PI * 2
      + sampledRange(idPrefix, index, -0.22, 0.22);
    const speed = sampledRange(`${idPrefix}:speed`, index, minimumSpeed, maximumSpeed);
    const size = sampledRange(`${idPrefix}:size`, index, 0.72, 1.24);
    addParticle(runtime, {
      id: `${idPrefix}:${index}`,
      shape: "diamond",
      origin,
      velocity: {
        x: Math.cos(angle) * speed,
        y: Math.sin(angle) * speed,
      },
      delaySeconds: sampledRange(`${idPrefix}:delay`, index, 0, 0.06),
      lifetimeSeconds: lifetimeSeconds * sampledRange(
        `${idPrefix}:life`,
        index,
        0.84,
        1.12,
      ),
      startWidth: size * 1.6,
      startHeight: size * 0.76,
      endWidth: size * 0.42,
      endHeight: size * 0.3,
      peakOpacity: 0.88,
      color,
      rotation: angle,
      angularVelocity: sampledRange(`${idPrefix}:spin`, index, -8, 8),
      z,
    });
  }
}

type ParticleOptions = Partial<Omit<ThreeInteractionParticle, "id" | "shape" | "origin" | "ageSeconds">>
  & Pick<ThreeInteractionParticle, "id" | "shape" | "origin">;

function addParticle(
  runtime: ThreeInteractionEffectsRuntime,
  options: ParticleOptions,
) {
  const particle: ThreeInteractionParticle = {
    id: `${options.id}:${runtime.spawnSerial}`,
    shape: options.shape,
    origin: copyPosition(options.origin),
    target: options.target ? copyPosition(options.target) : null,
    velocity: options.velocity ? copyPosition(options.velocity) : { x: 0, y: 0 },
    lifetimeSeconds: Math.max(0.01, finiteOr(options.lifetimeSeconds, 0.4)),
    delaySeconds: Math.max(0, finiteOr(options.delaySeconds, 0)),
    startWidth: Math.max(0, finiteOr(options.startWidth, 1)),
    startHeight: Math.max(0, finiteOr(options.startHeight, 1)),
    endWidth: Math.max(0, finiteOr(options.endWidth, 1)),
    endHeight: Math.max(0, finiteOr(options.endHeight, 1)),
    peakOpacity: clamp(finiteOr(options.peakOpacity, 1), 0, 1),
    color: options.color ?? ENERGY_WHITE,
    rotation: finiteOr(options.rotation, 0),
    angularVelocity: finiteOr(options.angularVelocity, 0),
    z: finiteOr(options.z, THREE_INTERACTION_EFFECT_RULES.groundZ),
    ageSeconds: 0,
  };
  runtime.spawnSerial += 1;
  runtime.particles.push(particle);
  const overflow = runtime.particles.length - THREE_INTERACTION_EFFECT_RULES.maxParticles;
  if (overflow > 0) runtime.particles.splice(0, overflow);
}

function removeExpiredParticles(runtime: ThreeInteractionEffectsRuntime) {
  let writeIndex = 0;
  for (const particle of runtime.particles) {
    if (particle.ageSeconds >= particle.delaySeconds + particle.lifetimeSeconds) continue;
    runtime.particles[writeIndex] = particle;
    writeIndex += 1;
  }
  runtime.particles.length = writeIndex;
}

function updateInteractionGeometry(runtime: ThreeInteractionEffectsRuntime) {
  const positions = runtime.positionAttribute.array as Float32Array;
  const colors = runtime.colorAttribute.array as Float32Array;
  const opacities = runtime.opacityAttribute.array as Float32Array;
  const shapes = runtime.shapeAttribute.array as Float32Array;
  for (let particleIndex = 0; particleIndex < runtime.particles.length; particleIndex += 1) {
    const particle = runtime.particles[particleIndex];
    const pose = calculateThreeInteractionParticlePose(particle);
    const cosine = Math.cos(pose.rotation);
    const sine = Math.sin(pose.rotation);
    const shapeCode = SHAPE_CODES[particle.shape];
    const { r, g, b } = colorComponents(particle.color);
    for (
      let vertexIndex = 0;
      vertexIndex < THREE_INTERACTION_EFFECT_RULES.verticesPerParticle;
      vertexIndex += 1
    ) {
      const cornerOffset = vertexIndex * 2;
      const localX = QUAD_CORNERS[cornerOffset] * pose.width;
      const localY = QUAD_CORNERS[cornerOffset + 1] * pose.height;
      const gameOffsetX = localX * cosine - localY * sine;
      const gameOffsetY = localX * sine + localY * cosine;
      const vertexOffset = (
        particleIndex * THREE_INTERACTION_EFFECT_RULES.verticesPerParticle
        + vertexIndex
      );
      const positionOffset = vertexOffset * 3;
      positions[positionOffset] = pose.x + gameOffsetX;
      positions[positionOffset + 1] = -(pose.y + gameOffsetY);
      positions[positionOffset + 2] = pose.z;
      colors[positionOffset] = r;
      colors[positionOffset + 1] = g;
      colors[positionOffset + 2] = b;
      opacities[vertexOffset] = pose.opacity;
      shapes[vertexOffset] = shapeCode;
    }
  }
  runtime.positionAttribute.needsUpdate = true;
  runtime.colorAttribute.needsUpdate = true;
  runtime.opacityAttribute.needsUpdate = true;
  runtime.shapeAttribute.needsUpdate = true;
  runtime.geometry.setDrawRange(
    0,
    runtime.particles.length * THREE_INTERACTION_EFFECT_RULES.verticesPerParticle,
  );
}

function dynamicAttribute(length: number, itemSize: number) {
  const attribute = new THREE.BufferAttribute(new Float32Array(length), itemSize);
  attribute.setUsage(THREE.DynamicDrawUsage);
  return attribute;
}

function colorComponents(color: number) {
  const cached = COLOR_COMPONENT_CACHE.get(color);
  if (cached) return cached;
  const threeColor = new THREE.Color(color);
  const components = Object.freeze({
    r: threeColor.r,
    g: threeColor.g,
    b: threeColor.b,
  });
  COLOR_COMPONENT_CACHE.set(color, components);
  return components;
}

function copyPosition(position: Vec2): Vec2 {
  return {
    x: finiteOr(position.x, 0),
    y: finiteOr(position.y, 0),
  };
}

function distance(left: Vec2, right: Vec2) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function stableUnitInterval(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0x1_0000_0000;
}

function sampledRange(
  seed: string,
  serial: number,
  minimum: number,
  maximum: number,
) {
  return lerp(minimum, maximum, stableUnitInterval(`${seed}:${serial}`));
}

function finiteOr(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function smoothstep(progress: number) {
  const clamped = clamp(progress, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
