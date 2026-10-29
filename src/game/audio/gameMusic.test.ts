import { describe, expect, it } from "vitest";
import {
  GAME_MUSIC_RULES,
  RESOLUTION_VOICING,
  getMusicArrangement,
  getMusicIntensity,
  getMusicNotesForStep,
  shouldScheduleResolution,
} from "./gameMusic";

describe("background music composition", () => {
  it("uses a liquid drum-and-bass tempo and a bounded output level", () => {
    expect(GAME_MUSIC_RULES.bpm).toBe(172);
    expect(GAME_MUSIC_RULES.stepsPerBeat).toBe(4);
    expect(GAME_MUSIC_RULES.loopSteps).toBe(128);
    expect(GAME_MUSIC_RULES.outputGain).toBeCloseTo(0.48 * 1.3, 10);
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
