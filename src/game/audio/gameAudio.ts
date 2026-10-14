import { publicAssetUrl } from "../assetUrl";
import { GAME_RULES } from "../constants";
import { MOVEMENT_RULES } from "../movement/movement";
import {
  collectThreeInteractionEvents,
  createThreeInteractionSnapshot,
  getPlayerMaterialEquivalent,
  type ThreeInteractionEvent,
  type ThreeInteractionSnapshot,
} from "../presentation/interactionEvents";
import type { GameState, MovementMode, PlayerId, Vec2 } from "../types";
import { sampleWorld, type BiomeId } from "../world/map";
import {
  createGameMusicRuntime,
  updateGameMusic,
  type GameMusicRuntime,
} from "./gameMusic";

export const AUDIO_PREFERENCE_KEY = "tetherbound.audioEnabled";

export const GAME_AUDIO_RULES = {
  biomeBlendRadius: 12,
  biomeTransitionSeconds: 0.42,
  maximumFootstepsPerUpdate: 2,
  maximumContinuousSnapshotGapMs: 320,
  audibleWorldDistance: 145,
  masterGain: 0.72,
} as const;

export const AUDIO_BIOMES = [
  "neutral",
  "base_corridor",
  "water",
  "jungle",
  "desert",
  "taiga",
] as const satisfies readonly BiomeId[];

export type BiomeAudioBlend = Record<BiomeId, number>;

export const FOOTSTEP_ASSET_URLS = {
  forest: publicAssetUrl("audio/footsteps/walk_forest.mp3"),
  sand: publicAssetUrl("audio/footsteps/walk_sand.mp3"),
  snow: publicAssetUrl("audio/footsteps/walk_snow.mp3"),
  water: publicAssetUrl("audio/footsteps/walk_water.mp3"),
} as const;

export type FootstepSampleId = keyof typeof FOOTSTEP_ASSET_URLS;
type FootstepSurface = "regolith" | "water" | "jungle" | "desert" | "taiga";

interface FootstepSampleProfile {
  readonly sample: FootstepSampleId;
  readonly offsets: readonly number[];
  readonly duration: number;
  readonly gain: number;
  readonly highpassFrequency: number;
  readonly lowpassFrequency: number;
}

interface MotionBed {
  readonly chargeOscillator: OscillatorNode;
  readonly chargeOvertone: OscillatorNode;
  readonly chargeNoise: AudioBufferSourceNode;
  readonly chargeHighpass: BiquadFilterNode;
  readonly chargeFilter: BiquadFilterNode;
  readonly chargeGain: GainNode;
  readonly flightNoise: AudioBufferSourceNode;
  readonly flightFilter: BiquadFilterNode;
  readonly flightGain: GainNode;
}

interface NetworkHum {
  readonly fundamental: OscillatorNode;
  readonly overtone: OscillatorNode;
  readonly filter: BiquadFilterNode;
  readonly gain: GainNode;
}

export interface GameAudioRuntime {
  readonly context: AudioContext;
  readonly masterGain: GainNode;
  readonly footstepBus: GainNode;
  readonly movementBus: GainNode;
  readonly effectsBus: GainNode;
  readonly ambienceBus: GainNode;
  readonly music: GameMusicRuntime;
  readonly noiseBuffer: AudioBuffer;
  readonly footstepBuffers: Partial<Record<FootstepSampleId, AudioBuffer>>;
  readonly motionBed: MotionBed;
  readonly networkHum: NetworkHum;
  readonly activeSources: Set<AudioScheduledSourceNode>;
  readonly localPlayerId: PlayerId;
  interactionSnapshot: ThreeInteractionSnapshot;
  previousElapsedMs: number;
  previousMode: MovementMode;
  previousGaitDistance: number;
  previousRespawns: number;
  previousPosition: Vec2;
  stepSerial: number;
  effectSerial: number;
  ambientSerial: number;
  nextJungleActivityAt: number;
  disposed: boolean;
}

interface AudioContextWindow extends Window {
  webkitAudioContext?: typeof AudioContext;
}

interface NoiseBurstOptions {
  readonly duration: number;
  readonly frequency: number;
  readonly gain: number;
  readonly seed: string;
  readonly time?: number;
  readonly attack?: number;
  readonly q?: number;
  readonly playbackRate?: number;
  readonly filterType?: BiquadFilterType;
  readonly pan?: number;
  readonly bus?: AudioNode;
}

interface ToneBurstOptions {
  readonly startFrequency: number;
  readonly endFrequency: number;
  readonly duration: number;
  readonly gain: number;
  readonly time?: number;
  readonly attack?: number;
  readonly type?: OscillatorType;
  readonly pan?: number;
  readonly bus?: AudioNode;
}

const BIOME_SAMPLE_POINTS = [
  { x: 0, y: 0, weight: 4 },
  { x: 5, y: 0, weight: 1.8 },
  { x: -5, y: 0, weight: 1.8 },
  { x: 0, y: 5, weight: 1.8 },
  { x: 0, y: -5, weight: 1.8 },
  { x: 4, y: 4, weight: 1.2 },
  { x: -4, y: 4, weight: 1.2 },
  { x: 4, y: -4, weight: 1.2 },
  { x: -4, y: -4, weight: 1.2 },
  { x: GAME_AUDIO_RULES.biomeBlendRadius, y: 0, weight: 0.8 },
  { x: -GAME_AUDIO_RULES.biomeBlendRadius, y: 0, weight: 0.8 },
  { x: 0, y: GAME_AUDIO_RULES.biomeBlendRadius, weight: 0.8 },
  { x: 0, y: -GAME_AUDIO_RULES.biomeBlendRadius, weight: 0.8 },
] as const;

const FOOTSTEP_SAMPLE_PROFILES = {
  regolith: {
    sample: "sand",
    offsets: [3.2, 4.195, 5.095, 6.015, 6.94],
    duration: 0.18,
    gain: 2.5,
    highpassFrequency: 95,
    lowpassFrequency: 6_800,
  },
  desert: {
    sample: "sand",
    offsets: [3.2, 4.195, 5.095, 6.015, 6.94],
    duration: 0.18,
    gain: 3,
    highpassFrequency: 125,
    lowpassFrequency: 7_200,
  },
  jungle: {
    sample: "forest",
    offsets: [13.265, 14.34, 15.145, 15.565, 16],
    duration: 0.22,
    gain: 2.2,
    highpassFrequency: 75,
    lowpassFrequency: 8_500,
  },
  taiga: {
    sample: "snow",
    offsets: [0.42, 1.305, 3.7, 4.5, 10.455, 11.445, 12.56, 14.665, 15.73, 16.785, 17.895, 18.755, 19.805, 20.96],
    duration: 0.28,
    gain: 1.1,
    highpassFrequency: 85,
    lowpassFrequency: 8_200,
  },
  water: {
    sample: "water",
    offsets: [0.04, 0.775, 1.395, 2.07, 2.755, 3.415],
    duration: 0.3,
    gain: 0.28,
    highpassFrequency: 65,
    lowpassFrequency: 7_600,
  },
} as const satisfies Readonly<Record<FootstepSurface, FootstepSampleProfile>>;

const footstepAssetRequests = new Map<FootstepSampleId, Promise<ArrayBuffer>>();

const CHARGE_FILTER_FREQUENCIES = {
  neutral: 720,
  base_corridor: 580,
  water: 390,
  jungle: 1_050,
  desert: 1_900,
  taiga: 860,
} as const satisfies Readonly<Record<BiomeId, number>>;

const FLIGHT_FILTER_FREQUENCIES = {
  neutral: 1_100,
  base_corridor: 920,
  water: 650,
  jungle: 1_450,
  desert: 2_600,
  taiga: 1_250,
} as const satisfies Readonly<Record<BiomeId, number>>;

export function readAudioPreference(storage: Pick<Storage, "getItem"> | null = safeStorage()) {
  const value = storage?.getItem(AUDIO_PREFERENCE_KEY);
  return value === null || value === undefined ? true : value !== "false";
}

export function calculateBiomeAudioBlend(position: Vec2): BiomeAudioBlend {
  const blend = emptyBiomeBlend();
  let totalWeight = 0;
  for (const point of BIOME_SAMPLE_POINTS) {
    const sample = sampleWorld({
      x: position.x + point.x,
      y: position.y + point.y,
    });
    if (!sample) continue;
    blend[sample.biome] += point.weight;
    totalWeight += point.weight;
  }
  if (totalWeight <= 0) {
    blend.neutral = 1;
    return blend;
  }
  for (const biome of AUDIO_BIOMES) blend[biome] /= totalWeight;
  return blend;
}

export function getFootstepTriggerIndices(
  previousGaitDistance: number,
  currentGaitDistance: number,
  mode: MovementMode,
  speed: number,
) {
  if (
    (mode !== "walking" && mode !== "charging")
    || !Number.isFinite(speed)
    || speed < 0.35
    || !Number.isFinite(previousGaitDistance)
    || !Number.isFinite(currentGaitDistance)
    || currentGaitDistance < previousGaitDistance
  ) {
    return [];
  }
  const stride = MOVEMENT_RULES.stepCycleDistance / 2;
  const firstIndex = Math.floor(previousGaitDistance / stride) + 1;
  const finalIndex = Math.floor(currentGaitDistance / stride);
  if (finalIndex < firstIndex) return [];
  const count = Math.min(
    GAME_AUDIO_RULES.maximumFootstepsPerUpdate,
    finalIndex - firstIndex + 1,
  );
  const retainedFirst = finalIndex - count + 1;
  return Array.from({ length: count }, (_, index) => retainedFirst + index);
}

export function createGameAudioRuntime(
  state: GameState,
  localPlayerId: PlayerId,
  ContextClass = audioContextConstructor(),
): GameAudioRuntime | null {
  if (!ContextClass) return null;
  try {
    const context = new ContextClass({ latencyHint: "interactive" });
    const activeSources = new Set<AudioScheduledSourceNode>();
    const masterInput = context.createGain();
    const masterGain = context.createGain();
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 19;
    compressor.ratio.value = 4.5;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.22;
    masterGain.gain.value = GAME_AUDIO_RULES.masterGain;
    masterInput.connect(compressor).connect(masterGain).connect(context.destination);

    const footstepBus = context.createGain();
    footstepBus.gain.value = 0.82;
    footstepBus.connect(masterInput);
    const movementBus = createDistortedBus(context, masterInput, 2.15);
    const effectsBus = createDistortedBus(context, masterInput, 1.72);
    const ambienceBus = context.createGain();
    ambienceBus.gain.value = 0.78;
    ambienceBus.connect(masterInput);
    const music = createGameMusicRuntime(context, masterInput, activeSources);
    const noiseBuffer = createNoiseBuffer(context, 2.4, 0x4b1d5eed);
    const motionBed = createMotionBed(
      context,
      noiseBuffer,
      movementBus,
      activeSources,
    );
    const networkHum = createNetworkHum(context, ambienceBus, activeSources);
    const astronaut = state.players[localPlayerId].astronaut;

    const runtime: GameAudioRuntime = {
      context,
      masterGain,
      footstepBus,
      movementBus,
      effectsBus,
      ambienceBus,
      music,
      noiseBuffer,
      footstepBuffers: {},
      motionBed,
      networkHum,
      activeSources,
      localPlayerId,
      interactionSnapshot: createThreeInteractionSnapshot(state),
      previousElapsedMs: state.elapsedMs,
      previousMode: astronaut.movement.mode,
      previousGaitDistance: astronaut.movement.gaitDistance,
      previousRespawns: astronaut.respawns,
      previousPosition: { ...astronaut.position },
      stepSerial: 0,
      effectSerial: 0,
      ambientSerial: 0,
      nextJungleActivityAt: context.currentTime + 0.5,
      disposed: false,
    };
    void loadFootstepBuffers(runtime);
    return runtime;
  } catch (error) {
    console.warn("Unable to initialize game audio", error);
    return null;
  }
}

export function updateGameAudio(runtime: GameAudioRuntime, state: GameState) {
  if (runtime.disposed) return;
  const player = state.players[runtime.localPlayerId];
  if (!player) return;
  const astronaut = player.astronaut;
  const movement = astronaut.movement;
  const position = astronaut.position;
  const blend = calculateBiomeAudioBlend(position);
  const now = runtime.context.currentTime;
  const elapsedDeltaMs = state.elapsedMs - runtime.previousElapsedMs;
  const respawned = astronaut.respawns > runtime.previousRespawns;
  const resetOneShots = elapsedDeltaMs < 0
    || elapsedDeltaMs > GAME_AUDIO_RULES.maximumContinuousSnapshotGapMs
    || respawned;

  updateMotionBed(runtime, movement.mode, movement.chargeSeconds, blend, now);
  updateNetworkHum(runtime, state, position, now);
  updateGameMusic(runtime.music, runtime.context, state);

  const previousInteractionSnapshot = runtime.interactionSnapshot;
  const interaction = collectThreeInteractionEvents(
    resetOneShots ? null : previousInteractionSnapshot,
    state,
  );
  runtime.interactionSnapshot = interaction.snapshot;

  if (!resetOneShots && runtime.context.state === "running") {
    const gaitDelta = movement.gaitDistance - runtime.previousGaitDistance;
    const speed = elapsedDeltaMs > 0
      ? gaitDelta / (elapsedDeltaMs / 1_000)
      : 0;
    const groundedMovement = isGroundedMode(runtime.previousMode)
      || isGroundedMode(movement.mode);
    const contactMode: MovementMode = groundedMovement
      ? (movement.mode === "charging" ? "charging" : "walking")
      : movement.mode;
    const steps = getFootstepTriggerIndices(
      runtime.previousGaitDistance,
      movement.gaitDistance,
      contactMode,
      speed,
    );
    for (let index = 0; index < steps.length; index += 1) {
      const delay = index * 0.026;
      const threshold = steps[index] * MOVEMENT_RULES.stepCycleDistance / 2;
      const travelProgress = gaitDelta > 0
        ? clamp(
          (threshold - runtime.previousGaitDistance) / gaitDelta,
          0,
          1,
        )
        : 1;
      const contactPosition = interpolatePosition(
        runtime.previousPosition,
        position,
        travelProgress,
      );
      playFootstep(
        runtime,
        calculateBiomeAudioBlend(contactPosition),
        clamp(speed / MOVEMENT_RULES.walkMaximumSpeed, 0.3, 1),
        delay,
      );
    }

    if (runtime.previousMode !== "charging" && movement.mode === "charging") {
      playChargeEngage(runtime, blend);
    }
    if (runtime.previousMode === "charging" && movement.mode === "burst") {
      playBoostLaunch(runtime, blend, movement.chargeSeconds);
      pulseHaptic(24);
    } else if (
      runtime.previousMode === "burst"
      && movement.mode !== "burst"
      && !respawned
    ) {
      playBoostLanding(runtime, blend);
      pulseHaptic(13);
    }

    const localMaterialGain = getPlayerMaterialEquivalent(
      interaction.snapshot,
      runtime.localPlayerId,
    ) - getPlayerMaterialEquivalent(
      previousInteractionSnapshot,
      runtime.localPlayerId,
    );
    for (const event of interaction.events) {
      playInteractionEvent(runtime, event, position);
    }
    if (
      localMaterialGain > 0
      && interaction.events.some((event) => event.kind === "salvage_picked_up")
    ) pulseHaptic(7);
    playRecoveredAnchorCues(
      runtime,
      previousInteractionSnapshot,
      interaction.snapshot,
      position,
    );
    updateJungleActivity(runtime, blend, now);
  }

  if (respawned) {
    setParam(runtime.motionBed.chargeGain.gain, 0, now, 0.025);
    setParam(runtime.motionBed.flightGain.gain, 0, now, 0.025);
  }
  runtime.previousElapsedMs = state.elapsedMs;
  runtime.previousMode = movement.mode;
  runtime.previousGaitDistance = movement.gaitDistance;
  runtime.previousRespawns = astronaut.respawns;
  runtime.previousPosition = { ...position };
}

export function resetGameAudioBaseline(
  runtime: GameAudioRuntime | null,
  state: GameState,
) {
  if (!runtime || runtime.disposed) return;
  const player = state.players[runtime.localPlayerId];
  if (!player) return;
  const astronaut = player.astronaut;
  runtime.interactionSnapshot = createThreeInteractionSnapshot(state);
  runtime.previousElapsedMs = state.elapsedMs;
  runtime.previousMode = astronaut.movement.mode;
  runtime.previousGaitDistance = astronaut.movement.gaitDistance;
  runtime.previousRespawns = astronaut.respawns;
  runtime.previousPosition = { ...astronaut.position };
  runtime.nextJungleActivityAt = runtime.context.currentTime + 0.35;
  const now = runtime.context.currentTime;
  setParam(runtime.motionBed.chargeGain.gain, 0, now, 0.025);
  setParam(runtime.motionBed.flightGain.gain, 0, now, 0.025);
}

export async function resumeGameAudio(runtime: GameAudioRuntime | null) {
  if (!runtime || runtime.disposed || runtime.context.state === "running") return;
  try {
    await runtime.context.resume();
  } catch {
    // Browsers can reject until a later trusted input; the layer retries then.
  }
}

export function suspendGameAudio(runtime: GameAudioRuntime | null) {
  if (!runtime || runtime.disposed || runtime.context.state !== "running") return;
  void runtime.context.suspend().catch(() => undefined);
}

export function disposeGameAudio(runtime: GameAudioRuntime | null) {
  if (!runtime || runtime.disposed) return;
  runtime.disposed = true;
  for (const source of runtime.activeSources) {
    try {
      source.stop();
    } catch {
      // A one-shot that already ended is safe to ignore.
    }
  }
  runtime.activeSources.clear();
  runtime.masterGain.disconnect();
  void runtime.context.close().catch(() => undefined);
}

function updateMotionBed(
  runtime: GameAudioRuntime,
  mode: MovementMode,
  chargeSeconds: number,
  blend: BiomeAudioBlend,
  now: number,
) {
  const chargeProgress = clamp(
    chargeSeconds / MOVEMENT_RULES.fullChargeSeconds,
    0,
    1,
  );
  const charging = mode === "charging";
  const bursting = mode === "burst";
  setParam(
    runtime.motionBed.chargeGain.gain,
    charging ? 0.045 + chargeProgress * 0.115 : 0,
    now,
    charging ? 0.055 : bursting ? 0.018 : 0.08,
  );
  setParam(
    runtime.motionBed.chargeOscillator.frequency,
    52 + chargeProgress * 116,
    now,
    0.055,
  );
  setParam(
    runtime.motionBed.chargeOvertone.frequency,
    105 + chargeProgress * 232,
    now,
    0.055,
  );
  setParam(
    runtime.motionBed.chargeFilter.frequency,
    weightedBiomeValue(blend, CHARGE_FILTER_FREQUENCIES),
    now,
    GAME_AUDIO_RULES.biomeTransitionSeconds,
  );
  setParam(
    runtime.motionBed.flightGain.gain,
    bursting ? 0.16 : 0,
    now,
    bursting ? 0.025 : 0.055,
  );
  setParam(
    runtime.motionBed.flightFilter.frequency,
    weightedBiomeValue(blend, FLIGHT_FILTER_FREQUENCIES),
    now,
    GAME_AUDIO_RULES.biomeTransitionSeconds,
  );
}

function updateNetworkHum(
  runtime: GameAudioRuntime,
  state: GameState,
  position: Vec2,
  now: number,
) {
  const player = state.players[runtime.localPlayerId];
  const poweredAnchors = state.anchors.filter((anchor) => (
    anchor.owner === runtime.localPlayerId && anchor.powered
  ));
  const nearestDistance = Math.min(
    distance(position, player.basePosition),
    ...poweredAnchors.map((anchor) => distance(position, anchor.position)),
  );
  const proximity = 1 - clamp(nearestDistance / GAME_RULES.safeZoneRadius, 0, 1);
  const networkStrength = clamp(poweredAnchors.length / 5, 0, 1);
  const networkOnline = !state.hasDeployedAnchor[runtime.localPlayerId]
    || poweredAnchors.length > 0;
  const collapsePressure = clamp(
    state.baseCollapseProgressMs[runtime.localPlayerId]
      / GAME_RULES.baseCollapseHoldMs,
    0,
    1,
  );
  const stability = networkOnline
    ? 1
    : 0.28 - collapsePressure * 0.12;
  setParam(
    runtime.networkHum.gain.gain,
    proximity * (0.013 + networkStrength * 0.014) * stability,
    now,
    0.32,
  );
  setParam(
    runtime.networkHum.filter.frequency,
    networkOnline
      ? 260 + networkStrength * 190
      : 168 - collapsePressure * 36,
    now,
    0.4,
  );
}

function playFootstep(
  runtime: GameAudioRuntime,
  blend: BiomeAudioBlend,
  intensity: number,
  delaySeconds: number,
) {
  const serial = runtime.stepSerial;
  runtime.stepSerial += 1;
  const time = runtime.context.currentTime + 0.006 + delaySeconds;
  const footPan = serial % 2 === 0 ? -0.075 : 0.075;
  const layers = footstepLayers(blend);
  for (const layer of layers) {
    playFootstepSample(
      runtime,
      layer.surface,
      layer.weight,
      intensity,
      serial,
      time,
      footPan,
    );
  }
}

function footstepLayers(blend: BiomeAudioBlend) {
  const candidates: Array<{ surface: FootstepSurface; weight: number }> = [
    { surface: "regolith", weight: blend.neutral + blend.base_corridor },
    { surface: "water", weight: blend.water },
    { surface: "jungle", weight: blend.jungle },
    { surface: "desert", weight: blend.desert },
    { surface: "taiga", weight: blend.taiga },
  ];
  candidates.sort((left, right) => right.weight - left.weight);
  const layers: Array<{
    surface: FootstepSurface;
    weight: number;
    dominantWeight: number;
  }> = [];
  for (const candidate of candidates) {
    if (candidate.weight <= 0.02) continue;
    const sample = FOOTSTEP_SAMPLE_PROFILES[candidate.surface].sample;
    const existing = layers.find((layer) => (
      FOOTSTEP_SAMPLE_PROFILES[layer.surface].sample === sample
    ));
    if (existing) {
      existing.weight += candidate.weight;
      if (candidate.weight > existing.dominantWeight) {
        existing.surface = candidate.surface;
        existing.dominantWeight = candidate.weight;
      }
      continue;
    }
    if (layers.length >= 2) continue;
    layers.push({
      surface: candidate.surface,
      weight: candidate.weight,
      dominantWeight: candidate.weight,
    });
  }
  const retainedWeight = layers.reduce((total, layer) => total + layer.weight, 0);
  return layers.map(({ surface, weight }) => ({
    surface,
    weight: retainedWeight > 0 ? weight / retainedWeight : 0,
  }));
}

function playFootstepSample(
  runtime: GameAudioRuntime,
  surface: FootstepSurface,
  weight: number,
  intensity: number,
  serial: number,
  time: number,
  pan: number,
) {
  const profile = FOOTSTEP_SAMPLE_PROFILES[surface];
  const buffer = runtime.footstepBuffers[profile.sample];
  if (!buffer) return;
  const offsetIndex = Math.min(
    profile.offsets.length - 1,
    Math.floor(
      stableUnitInterval(`footstep:${profile.sample}:${serial}`)
        * profile.offsets.length,
    ),
  );
  const offset = Math.min(
    profile.offsets[offsetIndex],
    Math.max(0, buffer.duration - 0.1),
  );
  const bufferDuration = Math.min(
    profile.duration,
    Math.max(0, buffer.duration - offset - 0.012),
  );
  if (bufferDuration < 0.08) return;

  const playbackRate = sampledRange(
    `footstep-rate:${profile.sample}`,
    serial,
    0.975,
    1.025,
  );
  const outputDuration = bufferDuration / playbackRate;
  const peakGain = profile.gain
    * clamp(intensity, 0.3, 1.15)
    * Math.sqrt(clamp(weight, 0, 1));
  const source = runtime.context.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = playbackRate;
  const highpass = runtime.context.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = profile.highpassFrequency;
  highpass.Q.value = 0.35;
  const lowpass = runtime.context.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = profile.lowpassFrequency;
  lowpass.Q.value = 0.25;
  const envelope = runtime.context.createGain();
  envelope.gain.setValueAtTime(0.0001, time);
  envelope.gain.linearRampToValueAtTime(peakGain, time + 0.008);
  envelope.gain.setValueAtTime(
    peakGain,
    time + Math.max(0.01, outputDuration - 0.065),
  );
  envelope.gain.exponentialRampToValueAtTime(0.0001, time + outputDuration);
  const panner = runtime.context.createStereoPanner();
  panner.pan.value = pan;
  source
    .connect(highpass)
    .connect(lowpass)
    .connect(envelope)
    .connect(panner)
    .connect(runtime.footstepBus);
  trackSource(runtime.activeSources, source);
  source.start(time, offset, bufferDuration);
  source.stop(time + outputDuration + 0.02);
}

function playChargeEngage(runtime: GameAudioRuntime, blend: BiomeAudioBlend) {
  const color = weightedBiomeValue(blend, CHARGE_FILTER_FREQUENCIES);
  toneBurst(runtime, {
    startFrequency: 88,
    endFrequency: 142,
    duration: 0.13,
    gain: 0.06,
    type: "triangle",
    bus: runtime.movementBus,
  });
  noiseBurst(runtime, {
    duration: 0.11,
    frequency: color,
    q: 1.1,
    gain: 0.04,
    seed: `charge-engage:${runtime.effectSerial++}`,
    filterType: "bandpass",
    bus: runtime.movementBus,
  });
}

function playBoostLaunch(
  runtime: GameAudioRuntime,
  blend: BiomeAudioBlend,
  chargeSeconds: number,
) {
  const strength = 0.72 + clamp(
    chargeSeconds / MOVEMENT_RULES.fullChargeSeconds,
    0,
    1,
  ) * 0.28;
  const serial = runtime.effectSerial++;
  noiseBurst(runtime, {
    duration: 0.31,
    frequency: 220,
    q: 0.58,
    gain: 0.28 * strength,
    seed: `boost-launch-body:${serial}`,
    filterType: "lowpass",
    bus: runtime.effectsBus,
  });
  noiseBurst(runtime, {
    duration: 0.22,
    frequency: weightedBiomeValue(blend, FLIGHT_FILTER_FREQUENCIES),
    q: 0.72,
    gain: 0.16 * strength,
    seed: `boost-launch-air:${serial}`,
    filterType: "bandpass",
    bus: runtime.effectsBus,
  });
}

function playBoostLanding(runtime: GameAudioRuntime, blend: BiomeAudioBlend) {
  const serial = runtime.effectSerial++;
  noiseBurst(runtime, {
    duration: 0.18,
    frequency: 480,
    q: 0.7,
    gain: 0.17,
    seed: `boost-land:${serial}`,
    filterType: "lowpass",
    bus: runtime.effectsBus,
  });
  playFootstep(runtime, blend, 1.15, 0.015);
}

function playInteractionEvent(
  runtime: GameAudioRuntime,
  event: ThreeInteractionEvent,
  listenerPosition: Vec2,
) {
  const spatial = spatialMix(event.position, listenerPosition);
  if (spatial.gain <= 0.01) return;
  const serial = runtime.effectSerial++;
  if (event.kind === "anchor_deployed") {
    toneBurst(runtime, {
      startFrequency: 310,
      endFrequency: 78,
      duration: 0.19,
      gain: 0.14 * spatial.gain,
      type: "square",
      pan: spatial.pan,
      bus: runtime.effectsBus,
    });
    noiseBurst(runtime, {
      duration: 0.16,
      frequency: 2_200,
      gain: 0.09 * spatial.gain,
      seed: `anchor-deploy:${serial}`,
      filterType: "highpass",
      pan: spatial.pan,
      bus: runtime.effectsBus,
    });
    for (let index = 0; index < 3; index += 1) {
      toneBurst(runtime, {
        time: runtime.context.currentTime + index * 0.048,
        startFrequency: 480 + index * 155,
        endFrequency: 760 + index * 180,
        duration: 0.085,
        gain: 0.035 * spatial.gain,
        type: "sine",
        pan: spatial.pan,
        bus: runtime.effectsBus,
      });
    }
    if (event.playerId === runtime.localPlayerId) pulseHaptic(12);
    return;
  }
  if (event.kind === "anchor_broken") {
    noiseBurst(runtime, {
      duration: 0.38,
      frequency: 290,
      q: 0.65,
      gain: 0.28 * spatial.gain,
      seed: `anchor-break-body:${serial}`,
      filterType: "lowpass",
      pan: spatial.pan,
      bus: runtime.effectsBus,
    });
    noiseBurst(runtime, {
      duration: 0.25,
      frequency: 2_800,
      gain: 0.12 * spatial.gain,
      seed: `anchor-break-static:${serial}`,
      filterType: "highpass",
      pan: spatial.pan,
      bus: runtime.effectsBus,
    });
    toneBurst(runtime, {
      startFrequency: 145,
      endFrequency: 31,
      duration: 0.42,
      gain: 0.17 * spatial.gain,
      type: "sawtooth",
      pan: spatial.pan,
      bus: runtime.effectsBus,
    });
    if (event.playerId === runtime.localPlayerId) pulseHaptic([25, 24, 34]);
    return;
  }
  if (event.kind === "salvage_picked_up") {
    toneBurst(runtime, {
      startFrequency: 640,
      endFrequency: 940,
      duration: 0.095,
      gain: 0.08 * spatial.gain,
      type: "triangle",
      pan: spatial.pan,
      bus: runtime.effectsBus,
    });
    noiseBurst(runtime, {
      duration: 0.075,
      frequency: 1_650,
      q: 1.3,
      gain: 0.055 * spatial.gain,
      seed: `salvage-pickup:${serial}`,
      filterType: "bandpass",
      pan: spatial.pan,
      bus: runtime.effectsBus,
    });
    return;
  }

  const localDeposit = event.playerId === runtime.localPlayerId;
  const noteCount = Math.min(3, Math.max(1, event.amount));
  for (let index = 0; index < noteCount; index += 1) {
    toneBurst(runtime, {
      time: runtime.context.currentTime + index * 0.07,
      startFrequency: 410 + index * 210,
      endFrequency: 520 + index * 250,
      duration: 0.16,
      gain: 0.075 * spatial.gain,
      type: "triangle",
      pan: spatial.pan,
      bus: runtime.effectsBus,
    });
  }
  noiseBurst(runtime, {
    duration: 0.16,
    frequency: 520,
    q: 0.72,
    gain: 0.11 * spatial.gain,
    seed: `salvage-deposit:${serial}`,
    filterType: "lowpass",
    pan: spatial.pan,
    bus: runtime.effectsBus,
  });
  if (event.fabricatedKits > 0) {
    const fabricationStrength = clamp(event.fabricatedKits, 1, 3);
    toneBurst(runtime, {
      time: runtime.context.currentTime + 0.11,
      startFrequency: 185,
      endFrequency: 370 + fabricationStrength * 55,
      duration: 0.3,
      gain: 0.11 * spatial.gain,
      type: "sawtooth",
      pan: spatial.pan,
      bus: runtime.effectsBus,
    });
    noiseBurst(runtime, {
      time: runtime.context.currentTime + 0.095,
      duration: 0.24,
      frequency: 1_150,
      q: 1.1,
      gain: 0.075 * spatial.gain,
      seed: `tether-fabricated:${serial}`,
      filterType: "bandpass",
      pan: spatial.pan,
      bus: runtime.effectsBus,
    });
  }
  if (localDeposit) pulseHaptic([12, 24, 20]);
}

function playRecoveredAnchorCues(
  runtime: GameAudioRuntime,
  previous: ThreeInteractionSnapshot,
  current: ThreeInteractionSnapshot,
  listenerPosition: Vec2,
) {
  for (const anchor of current.anchors.values()) {
    const earlier = previous.anchors.get(anchor.id);
    if (
      !earlier?.directlyDisrupted
      || anchor.directlyDisrupted
      || !anchor.powered
    ) continue;
    const spatial = spatialMix(anchor.position, listenerPosition);
    if (spatial.gain <= 0.01) continue;
    toneBurst(runtime, {
      startFrequency: 260,
      endFrequency: 620,
      duration: 0.24,
      gain: 0.08 * spatial.gain,
      type: "sine",
      pan: spatial.pan,
      bus: runtime.effectsBus,
    });
    toneBurst(runtime, {
      time: runtime.context.currentTime + 0.1,
      startFrequency: 520,
      endFrequency: 810,
      duration: 0.2,
      gain: 0.05 * spatial.gain,
      type: "triangle",
      pan: spatial.pan,
      bus: runtime.effectsBus,
    });
  }
}

function updateJungleActivity(
  runtime: GameAudioRuntime,
  blend: BiomeAudioBlend,
  now: number,
) {
  if (blend.jungle < 0.08 || now < runtime.nextJungleActivityAt) return;
  const serial = runtime.ambientSerial++;
  const pan = sampledRange(`jungle-pan:${serial}`, 0, -0.75, 0.75);
  const baseFrequency = sampledRange(`jungle-tone:${serial}`, 0, 720, 1_520);
  const activityGain = 0.025 * blend.jungle;
  toneBurst(runtime, {
    time: now + 0.02,
    startFrequency: baseFrequency,
    endFrequency: baseFrequency * 0.58,
    duration: 0.12,
    gain: activityGain,
    type: "sine",
    pan,
    bus: runtime.ambienceBus,
  });
  if (serial % 2 === 0) {
    toneBurst(runtime, {
      time: now + 0.13,
      startFrequency: baseFrequency * 0.82,
      endFrequency: baseFrequency * 1.12,
      duration: 0.07,
      gain: activityGain * 0.62,
      type: "triangle",
      pan: -pan * 0.65,
      bus: runtime.ambienceBus,
    });
  }
  runtime.nextJungleActivityAt = now + sampledRange(
    `jungle-delay:${serial}`,
    0,
    0.58,
    1.18,
  );
}

async function loadFootstepBuffers(runtime: GameAudioRuntime) {
  await Promise.all((Object.keys(FOOTSTEP_ASSET_URLS) as FootstepSampleId[]).map(
    async (sampleId) => {
      try {
        const encoded = await requestFootstepAsset(sampleId);
        const decoded = await runtime.context.decodeAudioData(encoded.slice(0));
        if (!runtime.disposed) runtime.footstepBuffers[sampleId] = decoded;
      } catch (error) {
        if (!runtime.disposed) {
          console.warn(`Unable to load ${sampleId} footsteps`, error);
        }
      }
    },
  ));
}

function requestFootstepAsset(sampleId: FootstepSampleId) {
  const existing = footstepAssetRequests.get(sampleId);
  if (existing) return existing;
  const request = fetch(FOOTSTEP_ASSET_URLS[sampleId]).then((response) => {
    if (!response.ok) {
      throw new Error(`Footstep asset returned ${response.status}`);
    }
    return response.arrayBuffer();
  });
  footstepAssetRequests.set(sampleId, request);
  return request;
}

function createMotionBed(
  context: AudioContext,
  noiseBuffer: AudioBuffer,
  destination: AudioNode,
  sources: Set<AudioScheduledSourceNode>,
): MotionBed {
  const chargeGain = context.createGain();
  chargeGain.gain.value = 0;
  chargeGain.connect(destination);
  const chargeFilter = context.createBiquadFilter();
  chargeFilter.type = "bandpass";
  chargeFilter.frequency.value = 720;
  chargeFilter.Q.value = 0.82;
  chargeFilter.connect(chargeGain);
  const chargeHighpass = context.createBiquadFilter();
  chargeHighpass.type = "highpass";
  chargeHighpass.frequency.value = 105;
  chargeHighpass.Q.value = 0.45;
  chargeHighpass.connect(chargeFilter);
  const chargePhaserA = context.createBiquadFilter();
  chargePhaserA.type = "allpass";
  chargePhaserA.frequency.value = 540;
  chargePhaserA.Q.value = 0.72;
  const chargePhaserB = context.createBiquadFilter();
  chargePhaserB.type = "allpass";
  chargePhaserB.frequency.value = 1_180;
  chargePhaserB.Q.value = 0.64;
  chargeHighpass.connect(chargePhaserA).connect(chargePhaserB);

  const chorusLeftDelay = context.createDelay(0.05);
  chorusLeftDelay.delayTime.value = 0.009;
  const chorusRightDelay = context.createDelay(0.05);
  chorusRightDelay.delayTime.value = 0.014;
  const chorusLeftPan = context.createStereoPanner();
  chorusLeftPan.pan.value = -0.34;
  const chorusRightPan = context.createStereoPanner();
  chorusRightPan.pan.value = 0.34;
  const chorusWetGain = context.createGain();
  chorusWetGain.gain.value = 0.22;
  chargePhaserB.connect(chorusLeftDelay).connect(chorusLeftPan).connect(
    chorusWetGain,
  );
  chargePhaserB.connect(chorusRightDelay).connect(chorusRightPan).connect(
    chorusWetGain,
  );
  chorusWetGain.connect(chargeFilter);

  const chargeModulationLfo = context.createOscillator();
  chargeModulationLfo.type = "sine";
  chargeModulationLfo.frequency.value = 0.42;
  const chorusLeftDepth = context.createGain();
  chorusLeftDepth.gain.value = 0.0018;
  chargeModulationLfo.connect(chorusLeftDepth).connect(
    chorusLeftDelay.delayTime,
  );
  const chorusRightDepth = context.createGain();
  chorusRightDepth.gain.value = -0.0022;
  chargeModulationLfo.connect(chorusRightDepth).connect(
    chorusRightDelay.delayTime,
  );
  const phaserDepthA = context.createGain();
  phaserDepthA.gain.value = 230;
  chargeModulationLfo.connect(phaserDepthA).connect(chargePhaserA.frequency);
  const phaserDepthB = context.createGain();
  phaserDepthB.gain.value = -310;
  chargeModulationLfo.connect(phaserDepthB).connect(chargePhaserB.frequency);
  const chargeOscillator = context.createOscillator();
  chargeOscillator.type = "sawtooth";
  chargeOscillator.frequency.value = 52;
  const chargeOscillatorGain = context.createGain();
  chargeOscillatorGain.gain.value = 0.38;
  chargeOscillator.connect(chargeOscillatorGain).connect(chargeHighpass);
  const chargeOvertone = context.createOscillator();
  chargeOvertone.type = "triangle";
  chargeOvertone.frequency.value = 105;
  const chargeOvertoneGain = context.createGain();
  chargeOvertoneGain.gain.value = 0.18;
  chargeOvertone.connect(chargeOvertoneGain).connect(chargeHighpass);
  const chargeNoise = context.createBufferSource();
  chargeNoise.buffer = noiseBuffer;
  chargeNoise.loop = true;
  chargeNoise.playbackRate.value = 0.7;
  const chargeNoiseGain = context.createGain();
  chargeNoiseGain.gain.value = 0.28;
  chargeNoise.connect(chargeNoiseGain).connect(chargeFilter);

  const flightGain = context.createGain();
  flightGain.gain.value = 0;
  flightGain.connect(destination);
  const flightFilter = context.createBiquadFilter();
  flightFilter.type = "bandpass";
  flightFilter.frequency.value = 1_100;
  flightFilter.Q.value = 0.6;
  flightFilter.connect(flightGain);
  const flightNoise = context.createBufferSource();
  flightNoise.buffer = noiseBuffer;
  flightNoise.loop = true;
  flightNoise.playbackRate.value = 1.32;
  flightNoise.connect(flightFilter);

  for (const source of [
    chargeOscillator,
    chargeOvertone,
    chargeNoise,
    flightNoise,
    chargeModulationLfo,
  ]) {
    trackSource(sources, source);
    source.start();
  }
  return {
    chargeOscillator,
    chargeOvertone,
    chargeNoise,
    chargeHighpass,
    chargeFilter,
    chargeGain,
    flightNoise,
    flightFilter,
    flightGain,
  };
}

function createNetworkHum(
  context: AudioContext,
  destination: AudioNode,
  sources: Set<AudioScheduledSourceNode>,
): NetworkHum {
  const gain = context.createGain();
  gain.gain.value = 0;
  gain.connect(destination);
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 280;
  filter.Q.value = 0.6;
  filter.connect(gain);
  const fundamental = context.createOscillator();
  fundamental.type = "sine";
  fundamental.frequency.value = 48;
  const fundamentalGain = context.createGain();
  fundamentalGain.gain.value = 0.7;
  fundamental.connect(fundamentalGain).connect(filter);
  const overtone = context.createOscillator();
  overtone.type = "triangle";
  overtone.frequency.value = 96.5;
  const overtoneGain = context.createGain();
  overtoneGain.gain.value = 0.22;
  overtone.connect(overtoneGain).connect(filter);
  for (const source of [fundamental, overtone]) {
    trackSource(sources, source);
    source.start();
  }
  return { fundamental, overtone, filter, gain };
}

function noiseBurst(runtime: GameAudioRuntime, options: NoiseBurstOptions) {
  const context = runtime.context;
  const time = Math.max(context.currentTime, options.time ?? context.currentTime);
  const duration = Math.max(0.025, options.duration);
  const source = context.createBufferSource();
  source.buffer = runtime.noiseBuffer;
  source.playbackRate.value = options.playbackRate ?? 1;
  const filter = context.createBiquadFilter();
  filter.type = options.filterType ?? "bandpass";
  filter.frequency.value = Math.max(20, options.frequency);
  filter.Q.value = options.q ?? 0.7;
  const envelope = context.createGain();
  scheduleEnvelope(
    envelope.gain,
    time,
    duration,
    options.gain,
    options.attack ?? Math.min(0.012, duration * 0.16),
  );
  const panner = context.createStereoPanner();
  panner.pan.value = clamp(options.pan ?? 0, -1, 1);
  source.connect(filter).connect(envelope).connect(panner).connect(
    options.bus ?? runtime.effectsBus,
  );
  const maximumOffset = Math.max(0, runtime.noiseBuffer.duration - duration - 0.05);
  const offset = stableUnitInterval(options.seed) * maximumOffset;
  trackSource(runtime.activeSources, source);
  source.start(time, offset);
  source.stop(time + duration + 0.025);
}

function toneBurst(runtime: GameAudioRuntime, options: ToneBurstOptions) {
  const context = runtime.context;
  const time = Math.max(context.currentTime, options.time ?? context.currentTime);
  const duration = Math.max(0.025, options.duration);
  const oscillator = context.createOscillator();
  oscillator.type = options.type ?? "sine";
  oscillator.frequency.setValueAtTime(Math.max(20, options.startFrequency), time);
  oscillator.frequency.exponentialRampToValueAtTime(
    Math.max(20, options.endFrequency),
    time + duration,
  );
  const envelope = context.createGain();
  scheduleEnvelope(
    envelope.gain,
    time,
    duration,
    options.gain,
    options.attack ?? Math.min(0.009, duration * 0.15),
  );
  const panner = context.createStereoPanner();
  panner.pan.value = clamp(options.pan ?? 0, -1, 1);
  oscillator.connect(envelope).connect(panner).connect(
    options.bus ?? runtime.effectsBus,
  );
  trackSource(runtime.activeSources, oscillator);
  oscillator.start(time);
  oscillator.stop(time + duration + 0.025);
}

function scheduleEnvelope(
  parameter: AudioParam,
  time: number,
  duration: number,
  peak: number,
  attack: number,
) {
  parameter.setValueAtTime(0.0001, time);
  parameter.exponentialRampToValueAtTime(
    Math.max(0.0001, peak),
    time + Math.max(0.002, attack),
  );
  parameter.exponentialRampToValueAtTime(0.0001, time + duration);
}

function createDistortedBus(
  context: AudioContext,
  destination: AudioNode,
  amount: number,
) {
  const input = context.createGain();
  const shaper = context.createWaveShaper();
  shaper.curve = createDistortionCurve(amount);
  shaper.oversample = "2x";
  input.connect(shaper).connect(destination);
  return input;
}

function createDistortionCurve(amount: number) {
  const samples = 1_024;
  const curve = new Float32Array(samples);
  const normalization = Math.tanh(amount);
  for (let index = 0; index < samples; index += 1) {
    const input = index / (samples - 1) * 2 - 1;
    curve[index] = Math.tanh(input * amount) / normalization;
  }
  return curve;
}

function createNoiseBuffer(context: AudioContext, seconds: number, seed: number) {
  const frameCount = Math.max(1, Math.floor(context.sampleRate * seconds));
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const data = buffer.getChannelData(0);
  let state = seed >>> 0;
  let previous = 0;
  for (let index = 0; index < frameCount; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const white = (state >>> 0) / 0x1_0000_0000 * 2 - 1;
    previous = previous * 0.16 + white * 0.84;
    data[index] = previous;
  }
  return buffer;
}

function setParam(
  parameter: AudioParam,
  value: number,
  now: number,
  timeConstant: number,
) {
  parameter.cancelScheduledValues(now);
  parameter.setTargetAtTime(value, now, Math.max(0.001, timeConstant));
}

function trackSource(
  sources: Set<AudioScheduledSourceNode>,
  source: AudioScheduledSourceNode,
) {
  sources.add(source);
  source.addEventListener("ended", () => sources.delete(source), { once: true });
}

function weightedBiomeValue(
  blend: BiomeAudioBlend,
  values: Readonly<Record<BiomeId, number>>,
) {
  return AUDIO_BIOMES.reduce(
    (total, biome) => total + blend[biome] * values[biome],
    0,
  );
}

function emptyBiomeBlend(): BiomeAudioBlend {
  return {
    neutral: 0,
    base_corridor: 0,
    water: 0,
    jungle: 0,
    desert: 0,
    taiga: 0,
  };
}

function spatialMix(source: Vec2, listener: Vec2) {
  const separation = distance(source, listener);
  if (separation >= GAME_AUDIO_RULES.audibleWorldDistance) {
    return { gain: 0, pan: 0 };
  }
  const normalized = separation / 44;
  return {
    gain: 1 / (1 + normalized * normalized),
    pan: clamp((source.x - listener.x) / 54, -0.82, 0.82),
  };
}

function pulseHaptic(pattern: number | number[]) {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Unsupported vibration policies are intentionally silent.
  }
}

function audioContextConstructor() {
  if (typeof window === "undefined") return null;
  const audioWindow = window as AudioContextWindow;
  return window.AudioContext ?? audioWindow.webkitAudioContext ?? null;
}

function safeStorage() {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage;
  } catch {
    return null;
  }
}

function distance(left: Vec2, right: Vec2) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function interpolatePosition(start: Vec2, end: Vec2, progress: number): Vec2 {
  return {
    x: start.x + (end.x - start.x) * progress,
    y: start.y + (end.y - start.y) * progress,
  };
}

function isGroundedMode(mode: MovementMode) {
  return mode === "walking" || mode === "charging";
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
  return minimum + (maximum - minimum) * stableUnitInterval(`${seed}:${serial}`);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
