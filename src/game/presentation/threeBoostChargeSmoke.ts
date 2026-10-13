import * as THREE from "three";
import { MOVEMENT_RULES } from "../movement/movement";
import type { GameState, MovementMode, PlayerId, Vec2 } from "../types";

export const BOOST_CHARGE_SMOKE_RULES = {
  maxParticlesPerPlayer: 40,
  maximumSpawnsPerFrame: 8,
  launchParticleCount: 9,
  launchCoreSizeScale: 1.3,
  flightParticleSpacing: 1.55,
  landingTrailSeconds: 0.12,
  minimumTrailMovement: 0.025,
  teleportResetDistance: 28,
  z: 0.035,
  charge: {
    minimumEmissionRate: 18,
    maximumEmissionRate: 30,
    spawnOffset: 4.6,
    lateralSpawnJitter: 1.65,
    minimumLifetimeSeconds: 0.95,
    maximumLifetimeSeconds: 1.3,
    minimumBackwardSpeed: 8,
    maximumBackwardSpeed: 12,
    maximumLateralSpeed: 0.7,
    minimumStartSize: 0.95,
    maximumStartSize: 1.45,
    minimumEndSize: 4.5,
    maximumEndSize: 6,
    minimumZigzagAmplitude: 0.8,
    maximumZigzagAmplitude: 1.6,
    minimumZigzagFrequency: 6.5,
    maximumZigzagFrequency: 10.5,
    minimumPeakOpacity: 0.62,
    maximumPeakOpacity: 0.8,
  },
  launch: {
    minimumEmissionRate: 0,
    maximumEmissionRate: 0,
    spawnOffset: 3.7,
    lateralSpawnJitter: 3.4,
    minimumLifetimeSeconds: 0.9,
    maximumLifetimeSeconds: 1.25,
    minimumBackwardSpeed: 8.5,
    maximumBackwardSpeed: 15,
    maximumLateralSpeed: 5.5,
    minimumStartSize: 2.4,
    maximumStartSize: 3.5,
    minimumEndSize: 6.3,
    maximumEndSize: 8.5,
    minimumZigzagAmplitude: 0.2,
    maximumZigzagAmplitude: 0.8,
    minimumZigzagFrequency: 5,
    maximumZigzagFrequency: 9,
    minimumPeakOpacity: 0.75,
    maximumPeakOpacity: 0.92,
  },
  flight: {
    minimumEmissionRate: 0,
    maximumEmissionRate: 0,
    spawnOffset: 4.8,
    lateralSpawnJitter: 1.4,
    minimumLifetimeSeconds: 0.75,
    maximumLifetimeSeconds: 1.05,
    minimumBackwardSpeed: 3.5,
    maximumBackwardSpeed: 7,
    maximumLateralSpeed: 1.1,
    minimumStartSize: 1.55,
    maximumStartSize: 2.2,
    minimumEndSize: 5.2,
    maximumEndSize: 7,
    minimumZigzagAmplitude: 0.65,
    maximumZigzagAmplitude: 1.3,
    minimumZigzagFrequency: 7,
    maximumZigzagFrequency: 11,
    minimumPeakOpacity: 0.62,
    maximumPeakOpacity: 0.82,
  },
} as const;

export type BoostSmokeParticleKind = "charge" | "launch" | "flight";

type SmokeParticleProfile = {
  [Key in keyof typeof BOOST_CHARGE_SMOKE_RULES.charge]: number;
};

export interface BoostChargeSmokeParticle {
  readonly playerId: PlayerId;
  readonly kind: BoostSmokeParticleKind;
  readonly origin: Vec2;
  readonly velocity: Vec2;
  readonly perpendicular: Vec2;
  readonly lifetimeSeconds: number;
  readonly startSize: number;
  readonly endSize: number;
  readonly zigzagAmplitude: number;
  readonly zigzagFrequency: number;
  readonly zigzagPhase: number;
  readonly peakOpacity: number;
  ageSeconds: number;
}

export interface BoostChargeSmokePose extends Vec2 {
  readonly size: number;
  readonly opacity: number;
}

interface SmokeEmitter {
  chargeSpawnBudget: number;
  spawnSerial: number;
  previousMode: MovementMode | null;
  burstDirection: Vec2 | null;
  flightDistanceRemainder: number;
  landingTrailSecondsRemaining: number;
  lastPosition: Vec2 | null;
}

export interface ThreeBoostChargeSmokeRuntime {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.ShaderMaterial;
  readonly positionAttribute: THREE.BufferAttribute;
  readonly opacityAttribute: THREE.BufferAttribute;
  readonly emitters: Map<PlayerId, SmokeEmitter>;
  readonly particles: BoostChargeSmokeParticle[];
}

type SmokeGameState = Pick<GameState, "activePlayerIds" | "players">;

const VERTICES_PER_PARTICLE = 6;
const QUAD_CORNERS = [
  -1, -1,
  1, -1,
  1, 1,
  -1, -1,
  1, 1,
  -1, 1,
] as const;

export function createThreeBoostChargeSmoke(
  playerIds: readonly PlayerId[],
): ThreeBoostChargeSmokeRuntime {
  const maximumParticles = Math.max(
    1,
    playerIds.length * BOOST_CHARGE_SMOKE_RULES.maxParticlesPerPlayer,
  );
  const vertexCount = maximumParticles * VERTICES_PER_PARTICLE;
  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(
    new Float32Array(vertexCount * 3),
    3,
  );
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  const opacityAttribute = new THREE.BufferAttribute(
    new Float32Array(vertexCount),
    1,
  );
  opacityAttribute.setUsage(THREE.DynamicDrawUsage);
  const uv = new Float32Array(vertexCount * 2);
  for (let particleIndex = 0; particleIndex < maximumParticles; particleIndex += 1) {
    const offset = particleIndex * VERTICES_PER_PARTICLE * 2;
    uv.set([
      0, 0,
      1, 0,
      1, 1,
      0, 0,
      1, 1,
      0, 1,
    ], offset);
  }
  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute("particleOpacity", opacityAttribute);
  geometry.setDrawRange(0, 0);

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.NormalBlending,
    vertexShader: `
      attribute float particleOpacity;
      varying vec2 smokeUv;
      varying float smokeOpacity;

      void main() {
        smokeUv = uv;
        smokeOpacity = particleOpacity;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 smokeUv;
      varying float smokeOpacity;

      void main() {
        vec2 centered = smokeUv - vec2(0.5);
        float distanceFromCenter = length(centered);
        float softPuff = 1.0 - smoothstep(0.14, 0.5, distanceFromCenter);
        softPuff = pow(softPuff, 0.82);
        float alpha = softPuff * smokeOpacity;
        if (alpha <= 0.002) discard;
        gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "boost-charge-smoke";
  mesh.frustumCulled = false;
  mesh.renderOrder = -0.5;

  return {
    mesh,
    geometry,
    material,
    positionAttribute,
    opacityAttribute,
    emitters: new Map(playerIds.map((playerId) => [playerId, {
      chargeSpawnBudget: 0,
      spawnSerial: 0,
      previousMode: null,
      burstDirection: null,
      flightDistanceRemainder: 0,
      landingTrailSecondsRemaining: 0,
      lastPosition: null,
    }])),
    particles: [],
  };
}

export function updateThreeBoostChargeSmoke(
  runtime: ThreeBoostChargeSmokeRuntime,
  state: SmokeGameState,
  renderPositions: Readonly<Record<PlayerId, Vec2>>,
  deltaSeconds: number,
  reduceMotion = false,
) {
  if (reduceMotion) {
    clearThreeBoostChargeSmoke(runtime);
    return;
  }

  const seconds = clamp(
    Number.isFinite(deltaSeconds) ? deltaSeconds : 0,
    0,
    0.1,
  );
  ageParticles(runtime, seconds);
  const activePlayers = new Set(state.activePlayerIds);

  for (const [playerId, emitter] of runtime.emitters) {
    const position = renderPositions[playerId];
    if (!activePlayers.has(playerId) || !position) {
      resetEmitter(emitter);
      removePlayerParticles(runtime, playerId);
      continue;
    }

    let previousPosition = emitter.lastPosition;
    if (
      previousPosition
      && Math.hypot(
        position.x - previousPosition.x,
        position.y - previousPosition.y,
      ) > BOOST_CHARGE_SMOKE_RULES.teleportResetDistance
    ) {
      removePlayerParticles(runtime, playerId);
      resetEmitter(emitter);
      previousPosition = null;
    }

    const movement = state.players[playerId].astronaut.movement;
    const didLaunch = emitter.previousMode === "charging"
      && movement.mode === "burst";

    if (didLaunch) {
      emitter.flightDistanceRemainder = 0;
      emitter.burstDirection = normalizedCopy(movement.direction);
      spawnLaunchCloud(
        runtime,
        emitter,
        playerId,
        previousPosition ?? position,
        movement.direction,
        movement.chargeSeconds,
      );
    }

    if (movement.mode === "charging") {
      emitter.burstDirection = null;
      emitter.flightDistanceRemainder = 0;
      emitter.landingTrailSecondsRemaining = 0;
      emitChargeSmoke(
        runtime,
        emitter,
        playerId,
        position,
        movement.direction,
        movement.chargeSeconds,
        seconds,
      );
    } else if (movement.mode === "burst") {
      emitter.chargeSpawnBudget = 0;
      emitter.landingTrailSecondsRemaining = 0;
      emitter.burstDirection = normalizedCopy(movement.direction);
      if (previousPosition) {
        emitFlightSegment(
          runtime,
          emitter,
          playerId,
          previousPosition,
          position,
          movement.direction,
        );
      }
    } else {
      emitter.chargeSpawnBudget = 0;
      if (emitter.previousMode === "burst") {
        emitter.landingTrailSecondsRemaining =
          BOOST_CHARGE_SMOKE_RULES.landingTrailSeconds;
      }
      if (
        emitter.landingTrailSecondsRemaining > 0
        && emitter.burstDirection
        && previousPosition
      ) {
        emitFlightSegment(
          runtime,
          emitter,
          playerId,
          previousPosition,
          position,
          emitter.burstDirection,
        );
        emitter.landingTrailSecondsRemaining = Math.max(
          0,
          emitter.landingTrailSecondsRemaining - seconds,
        );
      }
      if (emitter.landingTrailSecondsRemaining <= 0) {
        emitter.burstDirection = null;
        emitter.flightDistanceRemainder = 0;
      }
    }

    emitter.previousMode = movement.mode;
    emitter.lastPosition = { ...position };
  }

  updateSmokeGeometry(runtime);
}

export function clearThreeBoostChargeSmoke(runtime: ThreeBoostChargeSmokeRuntime) {
  runtime.particles.length = 0;
  for (const emitter of runtime.emitters.values()) resetEmitter(emitter);
  runtime.geometry.setDrawRange(0, 0);
}

export function disposeThreeBoostChargeSmoke(runtime: ThreeBoostChargeSmokeRuntime) {
  runtime.mesh.removeFromParent();
  runtime.geometry.dispose();
  runtime.material.dispose();
  runtime.particles.length = 0;
  runtime.emitters.clear();
}

function emitChargeSmoke(
  runtime: ThreeBoostChargeSmokeRuntime,
  emitter: SmokeEmitter,
  playerId: PlayerId,
  position: Vec2,
  direction: Vec2,
  chargeSeconds: number,
  deltaSeconds: number,
) {
  const progress = clamp(
    chargeSeconds / MOVEMENT_RULES.fullChargeSeconds,
    0,
    1,
  );
  const profile = BOOST_CHARGE_SMOKE_RULES.charge;
  const emissionRate = lerp(
    profile.minimumEmissionRate,
    profile.maximumEmissionRate,
    progress,
  );
  if (emitter.previousMode !== "charging") emitter.chargeSpawnBudget += 3;
  emitter.chargeSpawnBudget += deltaSeconds * emissionRate;
  const spawnCount = Math.min(
    BOOST_CHARGE_SMOKE_RULES.maximumSpawnsPerFrame,
    Math.floor(emitter.chargeSpawnBudget),
  );
  emitter.chargeSpawnBudget -= spawnCount;

  for (let index = 0; index < spawnCount; index += 1) {
    pushParticle(runtime, createBoostChargeSmokeParticle(
      playerId,
      emitter.spawnSerial,
      position,
      direction,
      { kind: "charge" },
    ));
    emitter.spawnSerial += 1;
  }
}

function spawnLaunchCloud(
  runtime: ThreeBoostChargeSmokeRuntime,
  emitter: SmokeEmitter,
  playerId: PlayerId,
  position: Vec2,
  direction: Vec2,
  chargeSeconds: number,
) {
  const chargeStrength = lerp(
    0.84,
    1,
    clamp(chargeSeconds / MOVEMENT_RULES.fullChargeSeconds, 0, 1),
  );
  for (
    let index = 0;
    index < BOOST_CHARGE_SMOKE_RULES.launchParticleCount;
    index += 1
  ) {
    const isCore = index === 0;
    const sizeScale = isCore
      ? BOOST_CHARGE_SMOKE_RULES.launchCoreSizeScale * chargeStrength
      : sampledRange(playerId, emitter.spawnSerial, 11, 0.86, 1.12)
        * chargeStrength;
    pushParticle(runtime, createBoostChargeSmokeParticle(
      playerId,
      emitter.spawnSerial,
      position,
      direction,
      {
        kind: "launch",
        centered: isCore,
        sizeScale,
      },
    ));
    emitter.spawnSerial += 1;
  }
}

function emitFlightSegment(
  runtime: ThreeBoostChargeSmokeRuntime,
  emitter: SmokeEmitter,
  playerId: PlayerId,
  from: Vec2,
  to: Vec2,
  direction: Vec2,
) {
  const segmentX = to.x - from.x;
  const segmentY = to.y - from.y;
  const segmentDistance = Math.hypot(segmentX, segmentY);
  if (
    !Number.isFinite(segmentDistance)
    || segmentDistance < BOOST_CHARGE_SMOKE_RULES.minimumTrailMovement
  ) {
    return;
  }

  const spacing = BOOST_CHARGE_SMOKE_RULES.flightParticleSpacing;
  const accumulatedDistance = emitter.flightDistanceRemainder + segmentDistance;
  const availableCount = Math.floor(accumulatedDistance / spacing);
  const spawnCount = Math.min(
    BOOST_CHARGE_SMOKE_RULES.maximumSpawnsPerFrame,
    availableCount,
  );
  const firstDistance = spacing - emitter.flightDistanceRemainder;
  const firstSpawnIndex = availableCount - spawnCount;

  for (let index = 0; index < spawnCount; index += 1) {
    const distanceAlongSegment = firstDistance
      + (firstSpawnIndex + index) * spacing;
    const progress = clamp(distanceAlongSegment / segmentDistance, 0, 1);
    const samplePosition = {
      x: from.x + segmentX * progress,
      y: from.y + segmentY * progress,
    };
    pushParticle(runtime, createBoostChargeSmokeParticle(
      playerId,
      emitter.spawnSerial,
      samplePosition,
      direction,
      { kind: "flight" },
    ));
    emitter.spawnSerial += 1;
  }

  emitter.flightDistanceRemainder = accumulatedDistance % spacing;
}

function pushParticle(
  runtime: ThreeBoostChargeSmokeRuntime,
  particle: BoostChargeSmokeParticle | null,
) {
  if (!particle) return;
  enforcePlayerParticleLimit(runtime, particle.playerId);
  runtime.particles.push(particle);
}

interface BoostSmokeParticleOptions {
  kind?: BoostSmokeParticleKind;
  centered?: boolean;
  sizeScale?: number;
}

export function createBoostChargeSmokeParticle(
  playerId: PlayerId,
  serial: number,
  position: Vec2,
  direction: Vec2,
  options: BoostSmokeParticleOptions = {},
): BoostChargeSmokeParticle | null {
  const kind = options.kind ?? "charge";
  const profile = getParticleProfile(kind);
  const centered = options.centered ?? false;
  const sizeScale = Math.max(0.1, options.sizeScale ?? 1);
  const normalizedDirection = normalize(direction);
  if (!normalizedDirection) return null;
  const backward = {
    x: -normalizedDirection.x,
    y: -normalizedDirection.y,
  };
  const perpendicular = {
    x: -normalizedDirection.y,
    y: normalizedDirection.x,
  };
  const lateralSpawnDirection = serial % 2 === 0 ? -1 : 1;
  const lateralSpawn = centered ? 0 : lateralSpawnDirection * sampledRange(
    playerId,
    serial,
    0,
    profile.lateralSpawnJitter * 0.35,
    profile.lateralSpawnJitter,
  );
  const spawnOffset = profile.spawnOffset * (centered ? 1 : sampledRange(
    playerId,
    serial,
    10,
    0.84,
    1.16,
  ));
  const backwardSpeed = sampledRange(
    playerId,
    serial,
    1,
    profile.minimumBackwardSpeed,
    profile.maximumBackwardSpeed,
  );
  const lateralSpeed = centered ? 0 : signedSample(playerId, serial, 2) *
    profile.maximumLateralSpeed;

  return {
    playerId,
    kind,
    origin: {
      x: position.x + backward.x * spawnOffset
        + perpendicular.x * lateralSpawn,
      y: position.y + backward.y * spawnOffset
        + perpendicular.y * lateralSpawn,
    },
    velocity: {
      x: backward.x * backwardSpeed + perpendicular.x * lateralSpeed,
      y: backward.y * backwardSpeed + perpendicular.y * lateralSpeed,
    },
    perpendicular,
    lifetimeSeconds: sampledRange(
      playerId,
      serial,
      3,
      profile.minimumLifetimeSeconds,
      profile.maximumLifetimeSeconds,
    ),
    startSize: sizeScale * sampledRange(
      playerId,
      serial,
      4,
      profile.minimumStartSize,
      profile.maximumStartSize,
    ),
    endSize: sizeScale * sampledRange(
      playerId,
      serial,
      5,
      profile.minimumEndSize,
      profile.maximumEndSize,
    ),
    zigzagAmplitude: centered ? 0 : sampledRange(
      playerId,
      serial,
      6,
      profile.minimumZigzagAmplitude,
      profile.maximumZigzagAmplitude,
    ),
    zigzagFrequency: sampledRange(
      playerId,
      serial,
      7,
      profile.minimumZigzagFrequency,
      profile.maximumZigzagFrequency,
    ),
    zigzagPhase: sampledRange(playerId, serial, 8, 0, Math.PI * 2),
    peakOpacity: sampledRange(
      playerId,
      serial,
      9,
      profile.minimumPeakOpacity,
      profile.maximumPeakOpacity,
    ),
    ageSeconds: 0,
  };
}

export function calculateBoostChargeSmokePose(
  particle: BoostChargeSmokeParticle,
  ageSeconds = particle.ageSeconds,
): BoostChargeSmokePose {
  const safeAge = clamp(
    Number.isFinite(ageSeconds) ? ageSeconds : 0,
    0,
    particle.lifetimeSeconds,
  );
  const progress = clamp(safeAge / particle.lifetimeSeconds, 0, 1);
  const sizeProgress = 1 - (1 - progress) ** 2;
  const zigzag = (
    Math.sin(safeAge * particle.zigzagFrequency + particle.zigzagPhase)
    - Math.sin(particle.zigzagPhase)
  ) * particle.zigzagAmplitude;
  const fadeInSeconds = particle.kind === "launch"
    ? 0.025
    : particle.kind === "flight" ? 0.04 : 0.055;
  const fadeIn = clamp(safeAge / fadeInSeconds, 0, 1);
  const fadeOut = (1 - progress) ** 1.25;

  return {
    x: particle.origin.x + particle.velocity.x * safeAge
      + particle.perpendicular.x * zigzag,
    y: particle.origin.y + particle.velocity.y * safeAge
      + particle.perpendicular.y * zigzag,
    size: lerp(particle.startSize, particle.endSize, sizeProgress),
    opacity: particle.peakOpacity * fadeIn * fadeOut,
  };
}

function ageParticles(runtime: ThreeBoostChargeSmokeRuntime, deltaSeconds: number) {
  let writeIndex = 0;
  for (const particle of runtime.particles) {
    particle.ageSeconds += deltaSeconds;
    if (particle.ageSeconds >= particle.lifetimeSeconds) continue;
    runtime.particles[writeIndex] = particle;
    writeIndex += 1;
  }
  runtime.particles.length = writeIndex;
}

function updateSmokeGeometry(runtime: ThreeBoostChargeSmokeRuntime) {
  const positions = runtime.positionAttribute.array as Float32Array;
  const opacities = runtime.opacityAttribute.array as Float32Array;
  for (let particleIndex = 0; particleIndex < runtime.particles.length; particleIndex += 1) {
    const particle = runtime.particles[particleIndex];
    const pose = calculateBoostChargeSmokePose(particle);
    const halfSize = pose.size / 2;
    const positionOffset = particleIndex * VERTICES_PER_PARTICLE * 3;
    const opacityOffset = particleIndex * VERTICES_PER_PARTICLE;
    for (let vertexIndex = 0; vertexIndex < VERTICES_PER_PARTICLE; vertexIndex += 1) {
      const cornerIndex = vertexIndex * 2;
      const target = positionOffset + vertexIndex * 3;
      positions[target] = pose.x + QUAD_CORNERS[cornerIndex] * halfSize;
      positions[target + 1] = -pose.y + QUAD_CORNERS[cornerIndex + 1] * halfSize;
      positions[target + 2] = BOOST_CHARGE_SMOKE_RULES.z;
      opacities[opacityOffset + vertexIndex] = pose.opacity;
    }
  }
  runtime.positionAttribute.needsUpdate = true;
  runtime.opacityAttribute.needsUpdate = true;
  runtime.geometry.setDrawRange(
    0,
    runtime.particles.length * VERTICES_PER_PARTICLE,
  );
}

function enforcePlayerParticleLimit(
  runtime: ThreeBoostChargeSmokeRuntime,
  playerId: PlayerId,
) {
  let count = 0;
  let oldestIndex = -1;
  let oldestProgress = -1;
  for (let index = 0; index < runtime.particles.length; index += 1) {
    const particle = runtime.particles[index];
    if (particle.playerId !== playerId) continue;
    count += 1;
    const progress = particle.ageSeconds / particle.lifetimeSeconds;
    if (progress > oldestProgress) {
      oldestProgress = progress;
      oldestIndex = index;
    }
  }
  if (
    count >= BOOST_CHARGE_SMOKE_RULES.maxParticlesPerPlayer
    && oldestIndex >= 0
  ) {
    runtime.particles.splice(oldestIndex, 1);
  }
}

function removePlayerParticles(
  runtime: ThreeBoostChargeSmokeRuntime,
  playerId: PlayerId,
) {
  let writeIndex = 0;
  for (const particle of runtime.particles) {
    if (particle.playerId === playerId) continue;
    runtime.particles[writeIndex] = particle;
    writeIndex += 1;
  }
  runtime.particles.length = writeIndex;
}

function resetEmitter(emitter: SmokeEmitter) {
  emitter.chargeSpawnBudget = 0;
  emitter.previousMode = null;
  emitter.burstDirection = null;
  emitter.flightDistanceRemainder = 0;
  emitter.landingTrailSecondsRemaining = 0;
  emitter.lastPosition = null;
}

function getParticleProfile(kind: BoostSmokeParticleKind): SmokeParticleProfile {
  return BOOST_CHARGE_SMOKE_RULES[kind];
}

function normalizedCopy(direction: Vec2) {
  const normalized = normalize(direction);
  return normalized ? { ...normalized } : null;
}

function normalize(direction: Vec2): Vec2 | null {
  const length = Math.hypot(direction.x, direction.y);
  if (!Number.isFinite(length) || length <= 0.0001) return null;
  return { x: direction.x / length, y: direction.y / length };
}

function sampledRange(
  playerId: PlayerId,
  serial: number,
  channel: number,
  minimum: number,
  maximum: number,
) {
  return lerp(minimum, maximum, deterministicUnit(playerId, serial, channel));
}

function signedSample(playerId: PlayerId, serial: number, channel: number) {
  return deterministicUnit(playerId, serial, channel) * 2 - 1;
}

function deterministicUnit(playerId: PlayerId, serial: number, channel: number) {
  let value = hashString(playerId);
  value ^= Math.imul(serial + 1, 0x9e3779b1);
  value ^= Math.imul(channel + 1, 0x85ebca6b);
  value = Math.imul(value ^ value >>> 16, 0x7feb352d);
  value = Math.imul(value ^ value >>> 15, 0x846ca68b);
  return ((value ^ value >>> 16) >>> 0) / 0x1_0000_0000;
}

function hashString(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash;
}

function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
