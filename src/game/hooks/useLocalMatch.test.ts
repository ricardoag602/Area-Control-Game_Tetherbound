import { describe, expect, it } from "vitest";
import { consumeSimulationBacklog } from "./useLocalMatch";

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
