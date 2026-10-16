import { GAME_RULES } from "../constants";
import type { GameState } from "../types";

export const GAME_MUSIC_RULES = {
  bpm: 96,
  stepsPerBeat: 2,
  loopSteps: 64,
  scheduleAheadSeconds: 0.65,
  outputGain: 0.5,
} as const;

const STEP_SECONDS = 60 / GAME_MUSIC_RULES.bpm / GAME_MUSIC_RULES.stepsPerBeat;

// Eight bars in D Dorian. Each voicing lasts two bars, leaving enough room for
// footsteps, tether impacts, and the biome soundscape to stay legible.
const PAD_VOICINGS = [
  [50, 57, 60, 64], // Dm(add9)
  [48, 55, 59, 64], // Cmaj7(add9)
  [43, 50, 57, 59], // G(add9)
  [45, 52, 55, 59], // Am7
] as const;

const ARPEGGIO_DEGREES = [0, 2, 1, 3, 1, 2, 0, 2] as const;

export interface GameMusicRuntime {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly activeSources: Set<AudioScheduledSourceNode>;
  nextStep: number;
  nextStepTime: number;
}

export function getMusicIntensity(state: Pick<GameState, "matchPhase" | "remainingMs">) {
  if (state.matchPhase === "finished") return 0;
  if (state.matchPhase === "setup") return 0.48;
  if (state.matchPhase === "overtime") return 1;
  if (state.remainingMs <= GAME_RULES.scoreSurgeDurationMs) return 0.9;
  return 0.66;
}

export function getMusicNotesForStep(step: number) {
  const normalizedStep = positiveModulo(step, GAME_MUSIC_RULES.loopSteps);
  const phrase = Math.floor(normalizedStep / 16);
  const voicing = PAD_VOICINGS[phrase];
  const withinPhrase = normalizedStep % 16;
  const arpeggioDegree = ARPEGGIO_DEGREES[normalizedStep % ARPEGGIO_DEGREES.length];
  return {
    normalizedStep,
    pad: withinPhrase === 0 ? voicing : null,
    bass: normalizedStep % 4 === 0 ? voicing[0] - 12 : null,
    arpeggio: normalizedStep % 2 === 0 ? voicing[arpeggioDegree] + 12 : null,
    pulse: normalizedStep % 8 === 0 || normalizedStep % 8 === 4,
  } as const;
}

export function createGameMusicRuntime(
  context: AudioContext,
  destination: AudioNode,
  activeSources: Set<AudioScheduledSourceNode>,
): GameMusicRuntime {
  const input = context.createGain();
  input.gain.value = 0.85;
  const tone = context.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 3_200;
  tone.Q.value = 0.35;
  const output = context.createGain();
  output.gain.value = 0;

  const delay = context.createDelay(0.8);
  delay.delayTime.value = STEP_SECONDS * 1.5;
  const delayFeedback = context.createGain();
  delayFeedback.gain.value = 0.22;
  const delayWet = context.createGain();
  delayWet.gain.value = 0.17;

  input.connect(tone).connect(output).connect(destination);
  tone.connect(delay).connect(delayWet).connect(output);
  delay.connect(delayFeedback).connect(delay);

  return {
    input,
    output,
    activeSources,
    nextStep: 0,
    nextStepTime: context.currentTime + 0.055,
  };
}

export function updateGameMusic(
  runtime: GameMusicRuntime,
  context: AudioContext,
  state: Pick<GameState, "matchPhase" | "remainingMs">,
) {
  const intensity = getMusicIntensity(state);
  const now = context.currentTime;
  runtime.output.gain.cancelScheduledValues(now);
  runtime.output.gain.setTargetAtTime(
    intensity * GAME_MUSIC_RULES.outputGain,
    now,
    intensity > 0 ? 0.85 : 0.18,
  );
  if (intensity <= 0 || context.state !== "running") return;

  // A suspended context does not advance its clock. The guard additionally
  // prevents a long debugger pause from causing an audible catch-up burst.
  if (runtime.nextStepTime < now - STEP_SECONDS) {
    runtime.nextStepTime = now + 0.04;
  }
  while (runtime.nextStepTime < now + GAME_MUSIC_RULES.scheduleAheadSeconds) {
    scheduleMusicStep(runtime, context, runtime.nextStep, runtime.nextStepTime, intensity);
    runtime.nextStep += 1;
    runtime.nextStepTime += STEP_SECONDS;
  }
}

function scheduleMusicStep(
  runtime: GameMusicRuntime,
  context: AudioContext,
  step: number,
  time: number,
  intensity: number,
) {
  const notes = getMusicNotesForStep(step);
  if (notes.pad) {
    notes.pad.forEach((note, index) => {
      scheduleVoice(runtime, context, {
        note,
        time,
        duration: STEP_SECONDS * 15.7,
        gain: 0.026,
        attack: 0.72,
        release: 1.1,
        type: index % 2 === 0 ? "triangle" : "sine",
        pan: -0.52 + index * 0.35,
        detune: index % 2 === 0 ? -3 : 3,
      });
    });
  }
  if (notes.bass !== null) {
    scheduleVoice(runtime, context, {
      note: notes.bass,
      time,
      duration: STEP_SECONDS * 3.2,
      gain: 0.062 + intensity * 0.012,
      attack: 0.035,
      release: 0.32,
      type: "sine",
      pan: 0,
    });
  }
  if (notes.arpeggio !== null) {
    scheduleVoice(runtime, context, {
      note: notes.arpeggio,
      time,
      duration: STEP_SECONDS * 1.45,
      gain: 0.022 + intensity * 0.014,
      attack: 0.012,
      release: 0.26,
      type: "triangle",
      pan: notes.normalizedStep % 4 === 0 ? -0.28 : 0.28,
    });
  }
  if (notes.pulse && intensity >= 0.82) {
    schedulePulse(runtime, context, time, intensity);
  }
}

function scheduleVoice(
  runtime: GameMusicRuntime,
  context: AudioContext,
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
  },
) {
  const oscillator = context.createOscillator();
  oscillator.type = options.type;
  oscillator.frequency.value = midiFrequency(options.note);
  oscillator.detune.value = options.detune ?? 0;
  const envelope = context.createGain();
  const end = options.time + options.duration;
  envelope.gain.setValueAtTime(0.0001, options.time);
  envelope.gain.exponentialRampToValueAtTime(options.gain, options.time + options.attack);
  envelope.gain.setValueAtTime(options.gain, Math.max(options.time + options.attack, end - options.release));
  envelope.gain.exponentialRampToValueAtTime(0.0001, end);
  const panner = context.createStereoPanner();
  panner.pan.value = options.pan;
  oscillator.connect(envelope).connect(panner).connect(runtime.input);
  trackSource(runtime.activeSources, oscillator);
  oscillator.start(options.time);
  oscillator.stop(end + 0.03);
}

function schedulePulse(
  runtime: GameMusicRuntime,
  context: AudioContext,
  time: number,
  intensity: number,
) {
  const oscillator = context.createOscillator();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(78, time);
  oscillator.frequency.exponentialRampToValueAtTime(42, time + 0.16);
  const envelope = context.createGain();
  envelope.gain.setValueAtTime(0.0001, time);
  envelope.gain.exponentialRampToValueAtTime(0.035 * intensity, time + 0.008);
  envelope.gain.exponentialRampToValueAtTime(0.0001, time + 0.19);
  oscillator.connect(envelope).connect(runtime.input);
  trackSource(runtime.activeSources, oscillator);
  oscillator.start(time);
  oscillator.stop(time + 0.22);
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

function positiveModulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}
