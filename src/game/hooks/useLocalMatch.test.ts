import { describe, expect, it } from "vitest";
import {
  advanceLocalBots,
  consumeSimulationBacklog,
  createLocalMatchState,
} from "./useLocalMatch";

describe("consumeSimulationBacklog", () => {
  it("preserves work beyond one catch-up batch", () => {
    const first = consumeSimulationBacklog(0, 0.5, 0.05, 5);

    expect(first.stepCount).toBe(5);
    expect(first.remainingSeconds).toBeCloseTo(0.25, 8);

    const second = consumeSimulationBacklog(
      first.remainingSeconds,
      0,
      0.05,
      5,
    );
    expect(second.stepCount).toBe(5);
    expect(second.remainingSeconds).toBeCloseTo(0, 8);
  });

  it("caps extreme inactive-tab gaps without discarding ordinary frame debt", () => {
    const result = consumeSimulationBacklog(0, 60, 0.05, 5);

    expect(result.stepCount).toBe(5);
    expect(result.remainingSeconds).toBeCloseTo(0.75, 8);
  });
});

describe("local bot rosters", () => {
  it.each([
    [3, ["rival", "player3"]],
    [4, ["rival", "player3", "player4"]],
  ] as const)(
    "creates and advances every opponent in a %i-player match",
    (playerLimit, opponentIds) => {
      const match = createLocalMatchState(playerLimit);
      const next = advanceLocalBots(match.game, match.bots);

      expect(match.game.activePlayerIds).toHaveLength(playerLimit);
      expect(Object.keys(match.bots)).toEqual(opponentIds);
      expect(Object.keys(next.bots)).toEqual(opponentIds);
      expect(Object.keys(next.commands)).toEqual(opponentIds);
      for (const opponentId of opponentIds) {
        expect(next.commands[opponentId]).toBeDefined();
      }
    },
  );
});
