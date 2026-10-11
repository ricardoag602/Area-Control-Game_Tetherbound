import { describe, expect, it, vi } from "vitest";
import {
  advanceWorldTimeline,
  advanceWorldTimelineToElapsedMs,
  createWorldTimeline,
  elapsedMsToWorldTick,
  normalizeWorldSeed,
  WORLD_EVENT_KINDS,
  type WorldTimelineEvent,
  type WorldTimelineState,
} from "./timeline";

function collectThrough(
  initial: WorldTimelineState,
  targetTick: number,
): { state: WorldTimelineState; events: WorldTimelineEvent[] } {
  let state = initial;
  const events: WorldTimelineEvent[] = [];

  for (;;) {
    const result = advanceWorldTimeline(state, targetTick);
    state = result.state;
    events.push(...result.events);
    if (result.caughtUp) {
      return { state, events };
    }
  }
}

describe("world event timeline", () => {
  it("produces the same schedule and stable IDs for the same seed", () => {
    const first = collectThrough(createWorldTimeline("room-alpha"), 2_000);
    const second = collectThrough(createWorldTimeline("room-alpha"), 2_000);

    expect(first).toEqual(second);
    expect(new Set(first.events.map((event) => event.id)).size).toBe(
      first.events.length,
    );
    expect(first.events[0].id).toMatch(
      /^world-[0-9a-z]+-[0-9a-z]+-[0-9a-z]+-(salvage_drop|biome_weather)$/,
    );
  });

  it("produces a different schedule for a different match seed", () => {
    const first = collectThrough(createWorldTimeline("room-alpha"), 2_000);
    const second = collectThrough(createWorldTimeline("room-beta"), 2_000);

    expect(second.events).not.toEqual(first.events);
    expect(second.state.seed).not.toBe(first.state.seed);
  });

  it("does not rely on Math.random", () => {
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random must not be used by the timeline");
    });

    expect(() => collectThrough(createWorldTimeline(42), 1_000)).not.toThrow();
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });

  it("is independent of how elapsed simulation time is chunked", () => {
    const direct = collectThrough(createWorldTimeline(98_765), 2_000);
    let chunkedState = createWorldTimeline(98_765);
    const chunkedEvents: WorldTimelineEvent[] = [];

    for (const tick of [13, 99, 347, 1_001, 1_333, 2_000]) {
      const advanced = collectThrough(chunkedState, tick);
      chunkedState = advanced.state;
      chunkedEvents.push(...advanced.events);
    }

    expect(chunkedEvents).toEqual(direct.events);
    expect(chunkedState).toEqual(direct.state);
  });

  it("survives JSON serialization without changing future events", () => {
    const beforeSave = advanceWorldTimeline(createWorldTimeline("save-slot-3"), 500);
    const restored = JSON.parse(
      JSON.stringify(beforeSave.state),
    ) as WorldTimelineState;

    expect(collectThrough(restored, 2_000)).toEqual(
      collectThrough(beforeSave.state, 2_000),
    );
  });

  it("uses only the safe initial salvage and biome weather slice by default", () => {
    const { events } = collectThrough(createWorldTimeline(12), 10_000);
    const kinds = new Set(events.map((event) => event.kind));

    expect(events.length).toBeGreaterThan(20);
    expect(kinds).toEqual(new Set(["salvage_drop", "biome_weather"]));
    expect(
      events.every(
        (event) =>
          event.category === "resource_drop" || event.category === "environment",
      ),
    ).toBe(true);
  });

  it("places salvage inside its selected biome and maps weather to that biome", () => {
    const state = createWorldTimeline(45, {
      rules: {
        minimumIntervalTicks: 1,
        maximumIntervalTicks: 1,
        eventWeights: { salvage_drop: 1, biome_weather: 1 },
      },
    });
    const { events } = collectThrough(state, 100);
    const weatherByBiome = {
      water: "rough_current",
      jungle: "bug_swarm",
      desert: "dust_storm",
      taiga: "snow_squall",
    } as const;

    for (const event of events) {
      if (!("regionId" in event)) {
        throw new Error(`Unexpected non-spatial event: ${event.kind}`);
      }
      const region = state.rules.biomeRegions.find(
        (candidate) => candidate.id === event.regionId,
      );
      expect(region).toBeDefined();

      if (event.kind === "salvage_drop" && region) {
        expect(event.position.x).toBeGreaterThanOrEqual(region.x);
        expect(event.position.x).toBeLessThan(region.x + region.width);
        expect(event.position.y).toBeGreaterThanOrEqual(region.y);
        expect(event.position.y).toBeLessThan(region.y + region.height);
      }
      if (event.kind === "biome_weather") {
        expect(event.effect).toBe(weatherByBiome[event.biome]);
      }
    }
  });

  it("makes 30% of supply drops large while keeping the result deterministic", () => {
    const timeline = createWorldTimeline("large-supply-drops", {
      rules: {
        minimumIntervalTicks: 1,
        maximumIntervalTicks: 1,
        maximumEventsPerAdvance: 64,
        maximumSalvageAmount: 2,
        largeSalvageDropChance: 0.3,
        eventWeights: { salvage_drop: 1, biome_weather: 0 },
      },
    });
    const first = collectThrough(timeline, 2_000).events;
    const second = collectThrough(timeline, 2_000).events;
    const largeDropCount = first.filter(
      (event) => event.kind === "salvage_drop" && event.amount === 2,
    ).length;

    expect(second).toEqual(first);
    expect(largeDropCount / first.length).toBeCloseTo(0.3, 1);
    expect(
      new Set(
        first.map((event) =>
          event.kind === "salvage_drop" ? event.amount : 0,
        ),
      ),
    ).toEqual(new Set([1, 2]));
  });

  it("caps a catch-up pass without dropping overdue events", () => {
    const initial = createWorldTimeline(9, {
      rules: {
        minimumIntervalTicks: 1,
        maximumIntervalTicks: 1,
        maximumEventsPerAdvance: 3,
      },
    });
    const first = advanceWorldTimeline(initial, 10);

    expect(first.events).toHaveLength(3);
    expect(first.caughtUp).toBe(false);
    expect(first.state.processedThroughTick).toBe(3);

    const all = collectThrough(first.state, 10);
    expect(all.events).toHaveLength(7);
    expect([...first.events, ...all.events].map((event) => event.scheduledTick)).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    );
    expect(all.state.processedThroughTick).toBe(10);
  });

  it("treats duplicate and stale target ticks as no-ops", () => {
    const initial = createWorldTimeline(77);
    const current = advanceWorldTimeline(initial, 500).state;

    expect(advanceWorldTimeline(current, 500)).toEqual({
      state: current,
      events: [],
      targetTick: 500,
      caughtUp: true,
    });
    expect(advanceWorldTimeline(current, 100).events).toEqual([]);
  });

  it("can be driven by elapsed match time without a runtime timer", () => {
    const state = createWorldTimeline(123, {
      rules: {
        ticksPerSecond: 20,
        minimumIntervalTicks: 20,
        maximumIntervalTicks: 20,
      },
    });

    expect(elapsedMsToWorldTick(999, 20)).toBe(19);
    expect(advanceWorldTimelineToElapsedMs(state, 999).events).toHaveLength(0);
    expect(advanceWorldTimelineToElapsedMs(state, 1_000).events).toHaveLength(1);
  });

  it("gives every modeled category a deterministic opt-in hook", () => {
    for (const enabledKind of WORLD_EVENT_KINDS) {
      const eventWeights = Object.fromEntries(
        WORLD_EVENT_KINDS.map((kind) => [kind, kind === enabledKind ? 1 : 0]),
      ) as Record<(typeof WORLD_EVENT_KINDS)[number], number>;
      const state = createWorldTimeline("all-categories", {
        rules: {
          minimumIntervalTicks: 1,
          maximumIntervalTicks: 1,
          eventWeights,
        },
      });

      expect(advanceWorldTimeline(state, 1).events[0].kind).toBe(enabledKind);
    }
  });

  it("normalizes number and string seeds consistently and rejects bad rules", () => {
    expect(normalizeWorldSeed(0x1_0000_0001)).toBe(1);
    expect(normalizeWorldSeed("room-alpha")).toBe(
      normalizeWorldSeed("room-alpha"),
    );
    expect(() => createWorldTimeline(Number.NaN)).toThrow(/seed/i);
    expect(() =>
      createWorldTimeline(1, {
        rules: { minimumIntervalTicks: 2, maximumIntervalTicks: 1 },
      }),
    ).toThrow(/minimumIntervalTicks/);
    expect(() =>
      createWorldTimeline(1, {
        rules: { largeSalvageDropChance: 1.01 },
      }),
    ).toThrow(/largeSalvageDropChance/);
    expect(() =>
      createWorldTimeline(1, {
        rules: {
          eventWeights: Object.fromEntries(
            WORLD_EVENT_KINDS.map((kind) => [kind, 0]),
          ),
        },
      }),
    ).toThrow(/at least one world event/i);
  });
});
