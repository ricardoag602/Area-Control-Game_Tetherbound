import { describe, expect, it } from "vitest";
import {
  GAME_MUSIC_RULES,
  RESOLUTION_VOICING,
  SCORE_SURGE_MUSIC_RULES,
  getMusicArrangement,
  getMusicIntensity,
  getMusicNotesForStep,
  getScoreSurgeTransitionState,
  isRoboticBrassActive,
  shouldScheduleResolution,
} from "./gameMusic";

describe("background music composition", () => {
  it("uses a liquid drum-and-bass tempo and a bounded output level", () => {
    expect(GAME_MUSIC_RULES.bpm).toBe(172);
    expect(GAME_MUSIC_RULES.stepsPerBeat).toBe(4);
    expect(GAME_MUSIC_RULES.loopSteps).toBe(128);
    expect(GAME_MUSIC_RULES.outputGain).toBeCloseTo(0.48 * 1.3 * 1.3, 10);
    expect(GAME_MUSIC_RULES.outputGain).toBeGreaterThan(0);
    expect(GAME_MUSIC_RULES.outputGain).toBeLessThan(1);
  });

  it("adds only a subtle gameplay high-shelf lift", () => {
    const menu = getMusicArrangement({ scene: "menu" });
    const gameplay = getMusicArrangement({
      scene: "gameplay",
      matchPhase: "regulation",
      remainingMs: 120_000,
    });
    const finished = getMusicArrangement({ scene: "finished" });

    expect(menu.highShelfGainDb).toBe(0);
    expect(finished.highShelfGainDb).toBe(0);
    expect(gameplay.highShelfGainDb).toBeGreaterThan(0);
    expect(gameplay.highShelfGainDb).toBeLessThanOrEqual(1.25);
  });

  it("keeps percussion out of the menu arrangement and brings it into gameplay", () => {
    const menu = getMusicArrangement({ scene: "menu" });
    const gameplay = getMusicArrangement({
      scene: "gameplay",
      matchPhase: "regulation",
      remainingMs: 120_000,
    });

    expect(menu.percussionGain).toBe(0);
    expect(gameplay.percussionGain).toBeGreaterThan(0);
    expect(menu.energy).toBeGreaterThan(0);
    expect(gameplay.energy).toBeGreaterThan(0);
  });

  it("ramps its energy gradually and monotonically as regulation runs down", () => {
    const countdown = [300_000, 120_000, 60_000, 10_000].map((remainingMs) =>
      getMusicIntensity({ matchPhase: "regulation", remainingMs }),
    );

    for (let index = 1; index < countdown.length; index += 1) {
      expect(countdown[index]).toBeGreaterThan(countdown[index - 1]);
    }
    for (const intensity of countdown) {
      expect(intensity).toBeGreaterThan(0);
      expect(intensity).toBeLessThanOrEqual(1);
    }
    expect(getMusicIntensity({ matchPhase: "finished", remainingMs: 0 })).toBe(0);
  });

  it("builds an eight-second white-noise transition around the one-minute alert", () => {
    const gameplay = (remainingMs: number) => ({
      scene: "gameplay" as const,
      matchPhase: "regulation" as const,
      remainingMs,
    });

    expect(SCORE_SURGE_MUSIC_RULES.riserDurationMs).toBe(4_000);
    expect(SCORE_SURGE_MUSIC_RULES.tailDurationMs).toBe(4_000);
    expect(getScoreSurgeTransitionState(gameplay(65_000))).toEqual({
      phase: "idle",
      progress: 0,
    });
    expect(getScoreSurgeTransitionState(gameplay(64_000))).toEqual({
      phase: "riser",
      progress: 0,
    });
    expect(getScoreSurgeTransitionState(gameplay(62_000))).toEqual({
      phase: "riser",
      progress: 0.5,
    });
    expect(getScoreSurgeTransitionState(gameplay(60_000))).toEqual({
      phase: "riser",
      progress: 1,
    });
    expect(getScoreSurgeTransitionState(gameplay(58_000))).toEqual({
      phase: "tail",
      progress: 0.5,
    });
    expect(getScoreSurgeTransitionState(gameplay(56_000))).toEqual({
      phase: "complete",
      progress: 1,
    });
    expect(getScoreSurgeTransitionState({ scene: "menu" })).toEqual({
      phase: "idle",
      progress: 0,
    });
  });

  it("adds a louder three-voice robotic brass layer without replacing the original toot", () => {
    const gameplay = (remainingMs: number) => ({
      scene: "gameplay" as const,
      matchPhase: "regulation" as const,
      remainingMs,
    });

    expect(SCORE_SURGE_MUSIC_RULES.brassPans).toEqual([-0.3, 0, 0.3]);
    expect(SCORE_SURGE_MUSIC_RULES.duplicateGainScale).toBeGreaterThan(0);
    expect(SCORE_SURGE_MUSIC_RULES.duplicateGainScale).toBeLessThan(1);
    expect(SCORE_SURGE_MUSIC_RULES.roboticBrassGainScale).toBe(1.4);
    expect(isRoboticBrassActive(gameplay(60_001))).toBe(false);
    expect(isRoboticBrassActive(gameplay(60_000))).toBe(true);
    expect(isRoboticBrassActive(gameplay(60_250), 300)).toBe(true);
    expect(isRoboticBrassActive({
      scene: "gameplay",
      matchPhase: "overtime",
      remainingMs: 60_000,
    })).toBe(true);
    expect(isRoboticBrassActive({ scene: "menu" })).toBe(false);
  });

  it("forms a seamless 128-step loop", () => {
    for (let step = 0; step < GAME_MUSIC_RULES.loopSteps; step += 1) {
      expect(getMusicNotesForStep(step + GAME_MUSIC_RULES.loopSteps)).toEqual(
        getMusicNotesForStep(step),
      );
    }
  });

  it("opens each phrase with harmony and uses a jungle-style break pattern", () => {
    for (let phraseStart = 0; phraseStart < GAME_MUSIC_RULES.loopSteps; phraseStart += 16) {
      const opening = getMusicNotesForStep(phraseStart);
      expect(opening.pad).toHaveLength(4);
      expect(opening.bass).not.toBeNull();

      const phrase = Array.from({ length: 16 }, (_, offset) =>
        getMusicNotesForStep(phraseStart + offset),
      );
      const snareOffsets = phrase.flatMap((notes, offset) => (notes.snare ? [offset] : []));
      expect(snareOffsets).toEqual([4, 12]);
    }

    const loop = Array.from({ length: GAME_MUSIC_RULES.loopSteps }, (_, step) =>
      getMusicNotesForStep(step),
    );
    expect(loop.some((notes) => notes.kick)).toBe(true);
    expect(loop.some((notes) => notes.hat)).toBe(true);
    expect(loop.some((notes) => notes.ghost)).toBe(true);
    expect(loop.some((notes) => notes.arpeggio !== null)).toBe(true);
  });

  it("schedules the resolution only on entry into the finished scene", () => {
    expect(shouldScheduleResolution("gameplay", "finished")).toBe(true);
    expect(shouldScheduleResolution("finished", "finished")).toBe(false);
    expect(shouldScheduleResolution("menu", "gameplay")).toBe(false);
    expect(shouldScheduleResolution("gameplay", "gameplay")).toBe(false);
    expect(shouldScheduleResolution("finished", "menu")).toBe(false);
  });

  it("resolves to a D-major add-nine voicing", () => {
    const pitchClasses = new Set(RESOLUTION_VOICING.map((midiNote) => midiNote % 12));

    expect(pitchClasses).toContain(2); // D
    expect(pitchClasses).toContain(6); // F-sharp
    expect(pitchClasses).toContain(4); // E, the added ninth
  });
});
