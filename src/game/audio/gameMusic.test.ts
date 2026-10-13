import { describe, expect, it } from "vitest";
import { GAME_RULES } from "../constants";
import { GAME_MUSIC_RULES, getMusicIntensity, getMusicNotesForStep } from "./gameMusic";

describe("background music composition", () => {
  it("forms a seamless eight-bar loop", () => {
    for (let step = 0; step < GAME_MUSIC_RULES.loopSteps; step += 1) {
      expect(getMusicNotesForStep(step + GAME_MUSIC_RULES.loopSteps)).toEqual(
        getMusicNotesForStep(step),
      );
    }
  });

  it("opens each two-bar phrase with a pad voicing and bass note", () => {
    for (const step of [0, 16, 32, 48]) {
      const notes = getMusicNotesForStep(step);
      expect(notes.pad).toHaveLength(4);
      expect(notes.bass).not.toBeNull();
    }
    expect(getMusicNotesForStep(2).pad).toBeNull();
  });

  it("adds energy for the signal surge and overtime, then fades at the result", () => {
    const regulation = getMusicIntensity({ matchPhase: "regulation", remainingMs: 120_000 });
    const surge = getMusicIntensity({
      matchPhase: "regulation",
      remainingMs: GAME_RULES.scoreSurgeDurationMs,
    });
    const overtime = getMusicIntensity({ matchPhase: "overtime", remainingMs: 30_000 });
    expect(surge).toBeGreaterThan(regulation);
    expect(overtime).toBeGreaterThan(surge);
    expect(getMusicIntensity({ matchPhase: "finished", remainingMs: 0 })).toBe(0);
  });
});
