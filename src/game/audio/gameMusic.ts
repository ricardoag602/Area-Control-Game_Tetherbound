import { GAME_RULES } from "../constants";
import type { GameState } from "../types";

export const GAME_MUSIC_RULES = {
  bpm: 172,
  stepsPerBeat: 4,
  loopSteps: 128,
  scheduleAheadSeconds: 0.6,
  outputGain: 0.48 * 1.3 * 1.3,
} as const;

const STEP_SECONDS = 60 / GAME_MUSIC_RULES.bpm / GAME_MUSIC_RULES.stepsPerBeat;
const ENVELOPE_FLOOR = 0.0001;

export type MusicScene = "menu" | "gameplay" | "finished";

export type GameMusicPresentation =
  | { scene: "menu" }
  | {
    scene: "gameplay";
    matchPhase: GameState["matchPhase"];
    remainingMs: number;
  }
  | { scene: "finished" };

export interface GameMusicArrangement {
  readonly energy: number;
  readonly harmonicGain: number;
  readonly bassGain: number;
  readonly arpeggioGain: number;
  readonly percussionGain: number;
  readonly brightnessHz: number;
  readonly highShelfGainDb: number;
  readonly reverbGain: number;
}

// Eight bars in D Dorian. Each suspended, ninth-rich voicing lasts two bars.
// The progression is shared by the ambient menu and full gameplay arrangement.
const PAD_VOICINGS = [
  [50, 57, 60, 64], // Dm(add9)
  [48, 55, 59, 64], // Cmaj7(add9)
  [43, 50, 57, 59], // G(add9)
  [45, 52, 55, 59], // Am7
] as const;

const ARPEGGIO_DEGREES = [0, 2, 1, 3, 0, 2, 1, 3] as const;
const BASS_STEPS = new Set([0, 10, 16, 22]);
const KICK_STEPS = new Set([0, 3, 10, 14]);
const SNARE_STEPS = new Set([4, 12]);
const HAT_STEPS = new Set([0, 2, 4, 6, 8, 10, 12, 14]);
const GHOST_STEPS = new Set([7, 11, 15]);

/** A wide, luminous D-major add9/D6 voicing used only for the final cadence. */
export const RESOLUTION_VOICING = [50, 57, 62, 64, 66, 69] as const;

export interface GameMusicRuntime {
  readonly input: GainNode;
  readonly harmonicInput: GainNode;
  readonly bassInput: GainNode;
  readonly arpeggioInput: GainNode;
  readonly percussionInput: GainNode;
  readonly reverbInput: GainNode;
  readonly resolutionInput: GainNode;
  readonly harmonicGain: GainNode;
  readonly bassGain: GainNode;
  readonly arpeggioGain: GainNode;
  readonly percussionGain: GainNode;
  readonly percussionSend: GainNode;
  readonly resolutionGain: GainNode;
  readonly harmonicFilter: BiquadFilterNode;
  readonly bassFilter: BiquadFilterNode;
  readonly highShelf: BiquadFilterNode;
  readonly reverbReturn: GainNode;
  readonly output: GainNode;
  readonly noiseBuffer: AudioBuffer;
  readonly activeSources: Set<AudioScheduledSourceNode>;
  readonly nodes: AudioNode[];
  nextStep: number;
  nextStepTime: number;
  scene: MusicScene;
  resolutionScheduled: boolean;
  disposed: boolean;
}

export function getMusicIntensity(
  state: Pick<GameState, "matchPhase" | "remainingMs">,
) {
  if (state.matchPhase === "finished") return 0;
  if (state.matchPhase === "setup") return 0.42;

  if (state.matchPhase === "overtime") {
    const overtimeProgress = clamp01(
      1 - state.remainingMs / GAME_RULES.overtimeDurationMs,
    );
    return 0.9 + smoothstep(overtimeProgress) * 0.1;
  }

  const regulationProgress = clamp01(
    1 - state.remainingMs / GAME_RULES.matchDurationMs,
  );
  const finalMinuteProgress = clamp01(
    1 - state.remainingMs / GAME_RULES.scoreSurgeDurationMs,
  );
  return Math.min(
    0.98,
    0.52
      + smoothstep(regulationProgress) * 0.33
      + smoothstep(finalMinuteProgress) * 0.13,
  );
}

export function getMusicArrangement(
  presentation: GameMusicPresentation,
): GameMusicArrangement {
  const scene = effectiveScene(presentation);
  if (scene === "finished") {
    return {
      energy: 0,
      harmonicGain: 0,
      bassGain: 0,
      arpeggioGain: 0,
      percussionGain: 0,
      brightnessHz: 1_000,
      highShelfGainDb: 0,
      reverbGain: 0.48,
    };
  }

  if (scene === "menu") {
    return {
      energy: 0.42,
      harmonicGain: 0.84,
      bassGain: 0.36,
      arpeggioGain: 0.5,
      percussionGain: 0,
      brightnessHz: 1_650,
      highShelfGainDb: 0,
      reverbGain: 0.36,
    };
  }

  const gameplay = presentation as Extract<GameMusicPresentation, { scene: "gameplay" }>;
  const energy = getMusicIntensity(gameplay);
  return {
    energy,
    harmonicGain: 0.82 + energy * 0.18,
    bassGain: 0.6 + energy * 0.4,
    arpeggioGain: 0.58 + energy * 0.42,
    percussionGain: 0.48 + energy * 0.42,
    brightnessHz: 1_900 + energy * 3_900,
    highShelfGainDb: 0.9 + energy * 0.3,
    reverbGain: 0.3 + energy * 0.18,
  };
}

export function getMusicNotesForStep(step: number) {
  const normalizedStep = positiveModulo(step, GAME_MUSIC_RULES.loopSteps);
  const phrase = Math.floor(normalizedStep / 32);
  const voicing = PAD_VOICINGS[phrase];
  const withinPhrase = normalizedStep % 32;
  const withinBar = normalizedStep % 16;
  const arpeggioDegree = ARPEGGIO_DEGREES[
    Math.floor(normalizedStep / 2) % ARPEGGIO_DEGREES.length
  ];
  const bassOffset = withinPhrase >= 16 ? 7 : 0;

  return {
    normalizedStep,
    pad: withinPhrase % 16 === 0 ? voicing : null,
    bass: BASS_STEPS.has(withinPhrase) ? voicing[0] - 12 + bassOffset : null,
    arpeggio: normalizedStep % 2 === 0 ? voicing[arpeggioDegree] + 12 : null,
    kick: KICK_STEPS.has(withinBar),
    snare: SNARE_STEPS.has(withinBar),
    hat: HAT_STEPS.has(withinBar),
    ghost: GHOST_STEPS.has(withinBar),
  } as const;
}

export function shouldScheduleResolution(
  previousScene: MusicScene | null,
  nextScene: MusicScene,
) {
  return previousScene !== "finished" && nextScene === "finished";
}

export function createGameMusicRuntime(
  context: AudioContext,
  destination: AudioNode,
  activeSources: Set<AudioScheduledSourceNode>,
): GameMusicRuntime {
  const input = context.createGain();
  input.gain.value = 1;
  const harmonicInput = context.createGain();
  const bassInput = context.createGain();
  const arpeggioInput = context.createGain();
  const percussionInput = context.createGain();
  const resolutionInput = context.createGain();
  const reverbInput = context.createGain();

  const harmonicFilter = context.createBiquadFilter();
  harmonicFilter.type = "lowpass";
  harmonicFilter.frequency.value = 1_650;
  harmonicFilter.Q.value = 0.7;
  const bassFilter = context.createBiquadFilter();
  bassFilter.type = "lowpass";
  bassFilter.frequency.value = 820;
  bassFilter.Q.value = 1.8;
  const highShelf = context.createBiquadFilter();
  highShelf.type = "highshelf";
  highShelf.frequency.value = 4_600;
  highShelf.gain.value = 0;

  const harmonicGain = context.createGain();
  harmonicGain.gain.value = 0;
  const bassGain = context.createGain();
  bassGain.gain.value = 0;
  const arpeggioGain = context.createGain();
  arpeggioGain.gain.value = 0;
  const percussionGain = context.createGain();
  percussionGain.gain.value = 0;
  const resolutionGain = context.createGain();
  resolutionGain.gain.value = 0;

  const harmonicSend = context.createGain();
  harmonicSend.gain.value = 0.28;
  const arpeggioSend = context.createGain();
  arpeggioSend.gain.value = 0.42;
  const percussionSend = context.createGain();
  percussionSend.gain.value = 0.72;
  const resolutionSend = context.createGain();
  resolutionSend.gain.value = 0.82;

  const convolver = context.createConvolver();
  convolver.buffer = createImpulseBuffer(context, 4.8, 3.2, 0x53a9d2f1);
  const reverbTone = context.createBiquadFilter();
  reverbTone.type = "lowpass";
  reverbTone.frequency.value = 6_200;
  const reverbReturn = context.createGain();
  reverbReturn.gain.value = 0.36;

  const delay = context.createDelay(0.9);
  delay.delayTime.value = STEP_SECONDS * 3;
  const delayFeedback = context.createGain();
  delayFeedback.gain.value = 0.24;
  const delayReturn = context.createGain();
  delayReturn.gain.value = 0.13;

  const output = context.createGain();
  output.gain.value = 0;

  input.connect(highShelf).connect(output);
  harmonicInput.connect(harmonicFilter).connect(harmonicGain).connect(input);
  bassInput.connect(bassFilter).connect(bassGain).connect(input);
  arpeggioInput.connect(arpeggioGain).connect(input);
  percussionInput.connect(percussionGain).connect(input);
  resolutionInput.connect(resolutionGain).connect(input);

  harmonicFilter.connect(harmonicSend).connect(reverbInput);
  arpeggioInput.connect(arpeggioSend).connect(reverbInput);
  percussionInput.connect(percussionSend).connect(reverbInput);
  resolutionInput.connect(resolutionSend).connect(reverbInput);
  reverbInput.connect(convolver).connect(reverbTone).connect(reverbReturn).connect(input);
  arpeggioInput.connect(delay);
  delay.connect(delayFeedback).connect(delay);
  delay.connect(delayReturn).connect(input);
  output.connect(destination);

  return {
    input,
    harmonicInput,
    bassInput,
    arpeggioInput,
    percussionInput,
    reverbInput,
    resolutionInput,
    harmonicGain,
    bassGain,
    arpeggioGain,
    percussionGain,
    percussionSend,
    resolutionGain,
    harmonicFilter,
    bassFilter,
    highShelf,
    reverbReturn,
    output,
    noiseBuffer: createNoiseBuffer(context, 1.4, 0x2f6e3a91),
    activeSources,
    nodes: [
      input,
      harmonicInput,
      bassInput,
      arpeggioInput,
      percussionInput,
      resolutionInput,
      reverbInput,
      harmonicFilter,
      bassFilter,
      highShelf,
      harmonicGain,
      bassGain,
      arpeggioGain,
      percussionGain,
      resolutionGain,
      harmonicSend,
      arpeggioSend,
      percussionSend,
      resolutionSend,
      convolver,
      reverbTone,
      reverbReturn,
      delay,
      delayFeedback,
      delayReturn,
      output,
    ],
    nextStep: 0,
    nextStepTime: context.currentTime + 0.055,
    scene: "menu",
    resolutionScheduled: false,
    disposed: false,
  };
}

export function updateGameMusic(
  runtime: GameMusicRuntime,
  context: AudioContext,
  presentation: GameMusicPresentation,
) {
  if (runtime.disposed) return;
  const nextScene = effectiveScene(presentation);
  const now = context.currentTime;

  if (shouldScheduleResolution(runtime.scene, nextScene)) {
    runtime.scene = "finished";
    runtime.resolutionScheduled = true;
    fadeLoopStems(runtime, now);
    scheduleResolution(runtime, context, now + 0.025);
    return;
  }

  if (nextScene === "finished") return;

  if (runtime.scene === "finished") {
    runtime.nextStep = 0;
    runtime.nextStepTime = now + 0.055;
    runtime.resolutionScheduled = false;
    setTarget(runtime.resolutionGain.gain, ENVELOPE_FLOOR, now, 0.18);
  }
  runtime.scene = nextScene;

  const arrangement = getMusicArrangement(presentation);
  applyArrangement(runtime, arrangement, now);
  if (context.state !== "running") return;

  // A suspended context does not advance its clock. The guard additionally
  // prevents a long debugger pause from causing an audible catch-up burst.
  if (runtime.nextStepTime < now - STEP_SECONDS) {
    runtime.nextStepTime = now + 0.04;
  }
  while (runtime.nextStepTime < now + GAME_MUSIC_RULES.scheduleAheadSeconds) {
    scheduleMusicStep(
      runtime,
      context,
      runtime.nextStep,
      runtime.nextStepTime,
      arrangement,
    );
    runtime.nextStep += 1;
    runtime.nextStepTime += STEP_SECONDS;
  }
}

export function disposeGameMusicRuntime(runtime: GameMusicRuntime | null) {
  if (!runtime || runtime.disposed) return;
  runtime.disposed = true;
  for (const source of [...runtime.activeSources]) {
    try {
      source.stop();
    } catch {
      // A source that has already stopped is safe to ignore during teardown.
    }
  }
  runtime.activeSources.clear();
  for (const node of [...runtime.nodes].reverse()) {
    try {
      node.disconnect();
    } catch {
      // Some browsers throw when a node has no remaining connections.
    }
  }
}

function effectiveScene(presentation: GameMusicPresentation): MusicScene {
  if (
    presentation.scene === "gameplay"
    && presentation.matchPhase === "finished"
  ) {
    return "finished";
  }
  return presentation.scene;
}

function applyArrangement(
  runtime: GameMusicRuntime,
  arrangement: GameMusicArrangement,
  now: number,
) {
  setTarget(runtime.output.gain, GAME_MUSIC_RULES.outputGain, now, 0.7);
  setTarget(runtime.harmonicGain.gain, arrangement.harmonicGain, now, 0.7);
  setTarget(runtime.bassGain.gain, arrangement.bassGain, now, 0.5);
  setTarget(runtime.arpeggioGain.gain, arrangement.arpeggioGain, now, 0.52);
  setTarget(runtime.percussionGain.gain, arrangement.percussionGain, now, 0.55);
  setTarget(
    runtime.percussionSend.gain,
    arrangement.percussionGain > 0
      ? 0.58 + arrangement.energy * 0.2
      : ENVELOPE_FLOOR,
    now,
    0.32,
  );
  setTarget(runtime.resolutionGain.gain, ENVELOPE_FLOOR, now, 0.18);
  setTarget(runtime.harmonicFilter.frequency, arrangement.brightnessHz, now, 0.8);
  setTarget(runtime.highShelf.gain, arrangement.highShelfGainDb, now, 0.7);
  setTarget(
    runtime.bassFilter.frequency,
    620 + arrangement.energy * 1_250,
    now,
    0.7,
  );
  setTarget(runtime.reverbReturn.gain, arrangement.reverbGain, now, 0.9);
}

function fadeLoopStems(runtime: GameMusicRuntime, now: number) {
  setTarget(runtime.percussionGain.gain, ENVELOPE_FLOOR, now, 0.055);
  setTarget(runtime.percussionSend.gain, ENVELOPE_FLOOR, now, 0.045);
  setTarget(runtime.bassGain.gain, ENVELOPE_FLOOR, now, 0.18);
  setTarget(runtime.arpeggioGain.gain, ENVELOPE_FLOOR, now, 0.22);
  setTarget(runtime.harmonicGain.gain, ENVELOPE_FLOOR, now, 0.42);
  setTarget(runtime.highShelf.gain, 0, now, 0.32);
  setTarget(runtime.resolutionGain.gain, 1, now, 0.025);
  setTarget(runtime.reverbReturn.gain, 0.52, now, 0.45);
  setTarget(runtime.output.gain, GAME_MUSIC_RULES.outputGain, now, 0.08);
  runtime.output.gain.setTargetAtTime(ENVELOPE_FLOOR, now + 7.2, 1.15);
}

function scheduleMusicStep(
  runtime: GameMusicRuntime,
  context: AudioContext,
  step: number,
  time: number,
  arrangement: GameMusicArrangement,
) {
  const notes = getMusicNotesForStep(step);
  if (notes.pad) {
    notes.pad.forEach((note, index) => {
      scheduleVoice(runtime, context, runtime.harmonicInput, {
        note,
        time,
        duration: STEP_SECONDS * 15.7,
        gain: 0.0125,
        attack: 0.52,
        release: 1.15,
        type: "sawtooth",
        pan: -0.62 + index * 0.31,
        detune: index % 2 === 0 ? -7 : 7,
        filterHz: 1_100 + arrangement.energy * 1_350,
      });
    });
    scheduleVoice(runtime, context, runtime.harmonicInput, {
      note: notes.pad[3] + 12,
      time: time + STEP_SECONDS * 0.5,
      duration: STEP_SECONDS * 14.4,
      gain: 0.007,
      attack: 0.9,
      release: 1.3,
      type: "sine",
      pan: 0.32,
    });
  }

  if (notes.bass !== null) {
    scheduleVoice(runtime, context, runtime.bassInput, {
      note: notes.bass,
      time,
      duration: STEP_SECONDS * 5.5,
      gain: 0.052 + arrangement.energy * 0.008,
      attack: 0.018,
      release: 0.24,
      type: "sine",
      pan: 0,
    });
    scheduleVoice(runtime, context, runtime.bassInput, {
      note: notes.bass + 12,
      time,
      duration: STEP_SECONDS * 4.4,
      gain: 0.018 + arrangement.energy * 0.012,
      attack: 0.012,
      release: 0.2,
      type: "sawtooth",
      pan: 0,
      detune: -4,
      filterHz: 520 + arrangement.energy * 1_100,
    });
  }

  if (notes.arpeggio !== null) {
    scheduleVoice(runtime, context, runtime.arpeggioInput, {
      note: notes.arpeggio,
      time,
      duration: STEP_SECONDS * 2.7,
      gain: 0.014 + arrangement.energy * 0.009,
      attack: 0.009,
      release: 0.2,
      type: "triangle",
      pan: notes.normalizedStep % 4 === 0 ? -0.38 : 0.38,
      filterHz: 2_800 + arrangement.energy * 2_900,
    });
    if (arrangement.energy >= 0.78 && notes.normalizedStep % 8 === 6) {
      scheduleVoice(runtime, context, runtime.arpeggioInput, {
        note: notes.arpeggio + 12,
        time: time + STEP_SECONDS,
        duration: STEP_SECONDS * 1.8,
        gain: 0.008,
        attack: 0.008,
        release: 0.13,
        type: "sine",
        pan: -0.2,
      });
    }
  }

  if (arrangement.percussionGain <= 0) return;
  if (notes.kick) scheduleKick(runtime, context, time, arrangement.energy);
  if (notes.snare) scheduleSnare(runtime, context, time, arrangement.energy, false);
  if (notes.hat && (arrangement.energy >= 0.62 || notes.normalizedStep % 4 === 0)) {
    scheduleHat(runtime, context, time, arrangement.energy);
  }
  if (notes.ghost && arrangement.energy >= 0.7) {
    scheduleSnare(runtime, context, time, arrangement.energy, true);
  }
}

function scheduleVoice(
  runtime: GameMusicRuntime,
  context: AudioContext,
  destination: AudioNode,
  options: {
    note: number;
    time: number;
    duration: number;
    gain: number;
    attack: number;
    release: number;
    type: OscillatorType;
    pan: number;
    detune?: number;
    filterHz?: number;
  },
) {
  const oscillator = context.createOscillator();
  oscillator.type = options.type;
  oscillator.frequency.value = midiFrequency(options.note);
  oscillator.detune.value = options.detune ?? 0;
  const envelope = context.createGain();
  const end = options.time + options.duration;
  envelope.gain.setValueAtTime(ENVELOPE_FLOOR, options.time);
  envelope.gain.exponentialRampToValueAtTime(
    Math.max(ENVELOPE_FLOOR, options.gain),
    options.time + options.attack,
  );
  envelope.gain.setValueAtTime(
    Math.max(ENVELOPE_FLOOR, options.gain),
    Math.max(options.time + options.attack, end - options.release),
  );
  envelope.gain.exponentialRampToValueAtTime(ENVELOPE_FLOOR, end);
  const panner = context.createStereoPanner();
  panner.pan.value = options.pan;

  oscillator.connect(envelope);
  if (options.filterHz) {
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = options.filterHz;
    filter.Q.value = 0.8;
    envelope.connect(filter).connect(panner);
  } else {
    envelope.connect(panner);
  }
  panner.connect(destination);
  trackSource(runtime.activeSources, oscillator);
  oscillator.start(options.time);
  oscillator.stop(end + 0.04);
}

function scheduleKick(
  runtime: GameMusicRuntime,
  context: AudioContext,
  time: number,
  energy: number,
) {
  const oscillator = context.createOscillator();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(112, time);
  oscillator.frequency.exponentialRampToValueAtTime(43, time + 0.16);
  const envelope = context.createGain();
  envelope.gain.setValueAtTime(ENVELOPE_FLOOR, time);
  envelope.gain.exponentialRampToValueAtTime(0.11 + energy * 0.025, time + 0.006);
  envelope.gain.exponentialRampToValueAtTime(ENVELOPE_FLOOR, time + 0.24);
  oscillator.connect(envelope).connect(runtime.percussionInput);
  trackSource(runtime.activeSources, oscillator);
  oscillator.start(time);
  oscillator.stop(time + 0.27);
}

function scheduleSnare(
  runtime: GameMusicRuntime,
  context: AudioContext,
  time: number,
  energy: number,
  ghost: boolean,
) {
  scheduleNoiseHit(runtime, context, {
    time,
    duration: ghost ? 0.105 : 0.24,
    gain: ghost ? 0.018 + energy * 0.01 : 0.055 + energy * 0.025,
    filterType: "bandpass",
    frequency: ghost ? 2_600 : 2_050,
    q: 0.72,
    pan: ghost ? -0.24 : 0,
  });

  if (ghost) return;
  const body = context.createOscillator();
  body.type = "triangle";
  body.frequency.setValueAtTime(188, time);
  body.frequency.exponentialRampToValueAtTime(112, time + 0.12);
  const envelope = context.createGain();
  envelope.gain.setValueAtTime(ENVELOPE_FLOOR, time);
  envelope.gain.exponentialRampToValueAtTime(0.035, time + 0.006);
  envelope.gain.exponentialRampToValueAtTime(ENVELOPE_FLOOR, time + 0.18);
  body.connect(envelope).connect(runtime.percussionInput);
  trackSource(runtime.activeSources, body);
  body.start(time);
  body.stop(time + 0.21);
}

function scheduleHat(
  runtime: GameMusicRuntime,
  context: AudioContext,
  time: number,
  energy: number,
) {
  scheduleNoiseHit(runtime, context, {
    time,
    duration: 0.045 + energy * 0.025,
    gain: 0.012 + energy * 0.01,
    filterType: "highpass",
    frequency: 6_200 + energy * 1_800,
    q: 0.4,
    pan: positiveModulo(Math.round(time / STEP_SECONDS), 2) === 0 ? -0.38 : 0.38,
  });
}

function scheduleNoiseHit(
  runtime: GameMusicRuntime,
  context: AudioContext,
  options: {
    time: number;
    duration: number;
    gain: number;
    filterType: BiquadFilterType;
    frequency: number;
    q: number;
    pan: number;
  },
) {
  const source = context.createBufferSource();
  source.buffer = runtime.noiseBuffer;
  const filter = context.createBiquadFilter();
  filter.type = options.filterType;
  filter.frequency.value = options.frequency;
  filter.Q.value = options.q;
  const envelope = context.createGain();
  envelope.gain.setValueAtTime(Math.max(ENVELOPE_FLOOR, options.gain), options.time);
  envelope.gain.exponentialRampToValueAtTime(
    ENVELOPE_FLOOR,
    options.time + options.duration,
  );
  const panner = context.createStereoPanner();
  panner.pan.value = options.pan;
  source.connect(filter).connect(envelope).connect(panner).connect(runtime.percussionInput);
  trackSource(runtime.activeSources, source);
  source.start(options.time);
  source.stop(options.time + options.duration + 0.025);
}

function scheduleResolution(
  runtime: GameMusicRuntime,
  context: AudioContext,
  time: number,
) {
  scheduleVoice(runtime, context, runtime.resolutionInput, {
    note: 38,
    time,
    duration: 6.8,
    gain: 0.075,
    attack: 0.035,
    release: 2.6,
    type: "sine",
    pan: 0,
  });

  RESOLUTION_VOICING.forEach((note, index) => {
    scheduleVoice(runtime, context, runtime.resolutionInput, {
      note,
      time: time + index * 0.018,
      duration: 6.4 + index * 0.12,
      gain: index < 2 ? 0.018 : 0.013,
      attack: 0.24 + index * 0.035,
      release: 2.4,
      type: index % 2 === 0 ? "sawtooth" : "sine",
      pan: -0.65 + index * 0.26,
      detune: index % 2 === 0 ? -5 : 5,
      filterHz: 3_800 + index * 360,
    });
  });

  for (const [index, note] of [76, 78, 81, 86].entries()) {
    scheduleVoice(runtime, context, runtime.resolutionInput, {
      note,
      time: time + 0.12 + index * 0.18,
      duration: 2.8,
      gain: 0.009,
      attack: 0.012,
      release: 1.8,
      type: "sine",
      pan: index % 2 === 0 ? -0.32 : 0.32,
    });
  }
}

function setTarget(
  parameter: AudioParam,
  value: number,
  time: number,
  timeConstant: number,
) {
  parameter.cancelScheduledValues(time);
  parameter.setTargetAtTime(value, time, timeConstant);
}

function createNoiseBuffer(
  context: BaseAudioContext,
  durationSeconds: number,
  seed: number,
) {
  const buffer = context.createBuffer(
    1,
    Math.ceil(context.sampleRate * durationSeconds),
    context.sampleRate,
  );
  const channel = buffer.getChannelData(0);
  let random = seed >>> 0;
  for (let index = 0; index < channel.length; index += 1) {
    random ^= random << 13;
    random ^= random >>> 17;
    random ^= random << 5;
    channel[index] = ((random >>> 0) / 0xffffffff) * 2 - 1;
  }
  return buffer;
}

function createImpulseBuffer(
  context: BaseAudioContext,
  durationSeconds: number,
  decay: number,
  seed: number,
) {
  const buffer = context.createBuffer(
    2,
    Math.ceil(context.sampleRate * durationSeconds),
    context.sampleRate,
  );
  let random = seed >>> 0;
  for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
    const channel = buffer.getChannelData(channelIndex);
    for (let index = 0; index < channel.length; index += 1) {
      random ^= random << 13;
      random ^= random >>> 17;
      random ^= random << 5;
      const noise = ((random >>> 0) / 0xffffffff) * 2 - 1;
      channel[index] = noise * (1 - index / channel.length) ** decay;
    }
  }
  return buffer;
}

function midiFrequency(note: number) {
  return 440 * 2 ** ((note - 69) / 12);
}

function trackSource(
  sources: Set<AudioScheduledSourceNode>,
  source: AudioScheduledSourceNode,
) {
  sources.add(source);
  source.addEventListener("ended", () => sources.delete(source), { once: true });
}

function smoothstep(value: number) {
  const normalized = clamp01(value);
  return normalized * normalized * (3 - 2 * normalized);
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function positiveModulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}
