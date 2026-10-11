/**
 * Deterministic match-wide event scheduling.
 *
 * This module deliberately has no clocks, timers, or Math.random calls. The
 * caller advances it with an absolute simulation tick (or elapsed match time),
 * making the same seed and serialized state safe to use for local games,
 * authoritative servers, replays, and reconnect catch-up.
 */

import { WORLD_BOUNDS } from "./map";

export const WORLD_EVENT_KINDS = [
  "salvage_drop",
  "biome_weather",
  "buff_drop",
  "debuff_event",
  "machine_cycle",
  "tether_cycle",
] as const;

export type WorldEventKind = (typeof WORLD_EVENT_KINDS)[number];

export type WorldEventCategory =
  | "resource_drop"
  | "environment"
  | "buff"
  | "debuff"
  | "machine_hook"
  | "tether_hook";

export type WorldBiome = "water" | "jungle" | "desert" | "taiga";

export interface WorldPoint {
  x: number;
  y: number;
}

export interface WorldBounds {
  width: number;
  height: number;
}

export interface BiomeRegion {
  id: string;
  biome: WorldBiome;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type WorldEventWeights = Record<WorldEventKind, number>;

export interface WorldTimelineRules {
  ticksPerSecond: number;
  minimumIntervalTicks: number;
  maximumIntervalTicks: number;
  maximumEventsPerAdvance: number;
  minimumWeatherDurationTicks: number;
  maximumWeatherDurationTicks: number;
  minimumEffectDurationTicks: number;
  maximumEffectDurationTicks: number;
  maximumSalvageAmount: number;
  largeSalvageDropChance: number;
  bounds: WorldBounds;
  biomeRegions: BiomeRegion[];
  eventWeights: WorldEventWeights;
}

export interface WorldTimelineRuleOverrides {
  ticksPerSecond?: number;
  minimumIntervalTicks?: number;
  maximumIntervalTicks?: number;
  maximumEventsPerAdvance?: number;
  minimumWeatherDurationTicks?: number;
  maximumWeatherDurationTicks?: number;
  minimumEffectDurationTicks?: number;
  maximumEffectDurationTicks?: number;
  maximumSalvageAmount?: number;
  largeSalvageDropChance?: number;
  bounds?: Partial<WorldBounds>;
  biomeRegions?: readonly BiomeRegion[];
  eventWeights?: Partial<WorldEventWeights>;
}

interface WorldEventBase<
  Category extends WorldEventCategory,
  Kind extends WorldEventKind,
> {
  id: string;
  sequence: number;
  scheduledTick: number;
  eventSeed: number;
  category: Category;
  kind: Kind;
}

export interface SalvageDropEvent
  extends WorldEventBase<"resource_drop", "salvage_drop"> {
  regionId: string;
  biome: WorldBiome;
  position: WorldPoint;
  amount: number;
}

export type BiomeWeatherEffect =
  | "rough_current"
  | "bug_swarm"
  | "dust_storm"
  | "snow_squall";

export interface BiomeWeatherEvent
  extends WorldEventBase<"environment", "biome_weather"> {
  regionId: string;
  biome: WorldBiome;
  effect: BiomeWeatherEffect;
  intensity: 1 | 2 | 3;
  durationTicks: number;
}

export type BuffKind = "oxygen_refill" | "burst_efficiency";

export interface BuffDropEvent extends WorldEventBase<"buff", "buff_drop"> {
  regionId: string;
  biome: WorldBiome;
  position: WorldPoint;
  buff: BuffKind;
  durationTicks: number;
}

export type DebuffKind = "oxygen_leak" | "movement_drag";

export interface DebuffEvent
  extends WorldEventBase<"debuff", "debuff_event"> {
  regionId: string;
  biome: WorldBiome;
  debuff: DebuffKind;
  intensity: 1 | 2 | 3;
  durationTicks: number;
}

/** A deterministic hook that a future machine system can consume. */
export interface MachineCycleEvent
  extends WorldEventBase<"machine_hook", "machine_cycle"> {
  cycle: "production";
}

/** A deterministic hook that a future tether system can consume. */
export interface TetherCycleEvent
  extends WorldEventBase<"tether_hook", "tether_cycle"> {
  cycle: "network_pulse";
}

export type WorldTimelineEvent =
  | SalvageDropEvent
  | BiomeWeatherEvent
  | BuffDropEvent
  | DebuffEvent
  | MachineCycleEvent
  | TetherCycleEvent;

/**
 * JSON-safe state. Persist or send this object without needing to serialize a
 * timer, callback, or generator instance.
 */
export interface WorldTimelineState {
  schemaVersion: 1;
  seed: number;
  randomState: number;
  processedThroughTick: number;
  nextEventTick: number;
  nextSequence: number;
  rules: WorldTimelineRules;
}

export interface WorldTimelineAdvance {
  state: WorldTimelineState;
  events: WorldTimelineEvent[];
  targetTick: number;
  /** False when the per-call event limit stopped a large catch-up pass. */
  caughtUp: boolean;
}

export interface CreateWorldTimelineOptions {
  startTick?: number;
  rules?: WorldTimelineRuleOverrides;
}

const DEFAULT_BOUNDS: WorldBounds = {
  width: WORLD_BOUNDS.width,
  height: WORLD_BOUNDS.height,
};

const DEFAULT_EVENT_WEIGHTS: WorldEventWeights = {
  salvage_drop: 7,
  biome_weather: 3,
  buff_drop: 0,
  debuff_event: 0,
  machine_cycle: 0,
  tether_cycle: 0,
};

export const DEFAULT_WORLD_TIMELINE_RULES: Readonly<WorldTimelineRules> = {
  ticksPerSecond: 20,
  minimumIntervalTicks: 60,
  maximumIntervalTicks: 140,
  maximumEventsPerAdvance: 32,
  minimumWeatherDurationTicks: 160,
  maximumWeatherDurationTicks: 320,
  minimumEffectDurationTicks: 100,
  maximumEffectDurationTicks: 240,
  maximumSalvageAmount: 2,
  largeSalvageDropChance: 0.3,
  bounds: DEFAULT_BOUNDS,
  biomeRegions: createQuadrantBiomes(DEFAULT_BOUNDS),
  eventWeights: DEFAULT_EVENT_WEIGHTS,
};

const UINT32_RANGE = 0x1_0000_0000;

interface RandomSample {
  state: number;
  value: number;
  uint32: number;
}

interface GeneratedEvent {
  event: WorldTimelineEvent;
  randomState: number;
}

export function createQuadrantBiomes(bounds: WorldBounds): BiomeRegion[] {
  const halfWidth = bounds.width / 2;
  const halfHeight = bounds.height / 2;

  return [
    {
      id: "water",
      biome: "water",
      x: 0,
      y: 0,
      width: halfWidth,
      height: halfHeight,
    },
    {
      id: "jungle",
      biome: "jungle",
      x: halfWidth,
      y: 0,
      width: bounds.width - halfWidth,
      height: halfHeight,
    },
    {
      id: "desert",
      biome: "desert",
      x: 0,
      y: halfHeight,
      width: halfWidth,
      height: bounds.height - halfHeight,
    },
    {
      id: "taiga",
      biome: "taiga",
      x: halfWidth,
      y: halfHeight,
      width: bounds.width - halfWidth,
      height: bounds.height - halfHeight,
    },
  ];
}

export function normalizeWorldSeed(seed: number | string): number {
  if (typeof seed === "number") {
    if (!Number.isFinite(seed)) {
      throw new RangeError("World timeline seed must be finite.");
    }

    return Math.trunc(seed) >>> 0;
  }

  // FNV-1a turns room IDs and other string seeds into a stable uint32.
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createWorldTimeline(
  seed: number | string,
  options: CreateWorldTimelineOptions = {},
): WorldTimelineState {
  const startTick = normalizeTick(options.startTick ?? 0, "startTick");
  const rules = resolveRules(options.rules);
  const normalizedSeed = normalizeWorldSeed(seed);
  const firstInterval = randomInteger(
    normalizedSeed,
    rules.minimumIntervalTicks,
    rules.maximumIntervalTicks,
  );

  return {
    schemaVersion: 1,
    seed: normalizedSeed,
    randomState: firstInterval.state,
    processedThroughTick: startTick,
    nextEventTick: startTick + firstInterval.value,
    nextSequence: 0,
    rules,
  };
}

/**
 * Advances to an absolute simulation tick. Calling this more than once with
 * the same (or an older) tick is an intentional no-op, which makes duplicate
 * network snapshots harmless.
 */
export function advanceWorldTimeline(
  source: WorldTimelineState,
  targetTickInput: number,
): WorldTimelineAdvance {
  const targetTick = normalizeTick(targetTickInput, "targetTick");
  if (targetTick <= source.processedThroughTick) {
    return {
      state: source,
      events: [],
      targetTick,
      caughtUp: true,
    };
  }

  let randomState = source.randomState;
  let nextEventTick = source.nextEventTick;
  let nextSequence = source.nextSequence;
  const events: WorldTimelineEvent[] = [];

  while (
    nextEventTick <= targetTick &&
    events.length < source.rules.maximumEventsPerAdvance
  ) {
    const generated = generateEvent(
      source.seed,
      randomState,
      nextSequence,
      nextEventTick,
      source.rules,
    );
    events.push(generated.event);
    randomState = generated.randomState;
    nextSequence += 1;

    const interval = randomInteger(
      randomState,
      source.rules.minimumIntervalTicks,
      source.rules.maximumIntervalTicks,
    );
    randomState = interval.state;
    nextEventTick += interval.value;
  }

  const caughtUp = nextEventTick > targetTick;
  const processedThroughTick = caughtUp
    ? targetTick
    : Math.max(source.processedThroughTick, nextEventTick - 1);

  return {
    state: {
      ...source,
      randomState,
      processedThroughTick,
      nextEventTick,
      nextSequence,
    },
    events,
    targetTick,
    caughtUp,
  };
}

/** Convert absolute elapsed match time into the timeline's simulation tick. */
export function elapsedMsToWorldTick(
  elapsedMs: number,
  ticksPerSecond: number,
): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new RangeError("elapsedMs must be a finite, non-negative number.");
  }
  assertPositiveInteger(ticksPerSecond, "ticksPerSecond");
  return Math.floor((elapsedMs * ticksPerSecond) / 1000);
}

export function advanceWorldTimelineToElapsedMs(
  state: WorldTimelineState,
  elapsedMs: number,
): WorldTimelineAdvance {
  return advanceWorldTimeline(
    state,
    elapsedMsToWorldTick(elapsedMs, state.rules.ticksPerSecond),
  );
}

function resolveRules(
  overrides: WorldTimelineRuleOverrides = {},
): WorldTimelineRules {
  const bounds = {
    width: overrides.bounds?.width ?? DEFAULT_WORLD_TIMELINE_RULES.bounds.width,
    height: overrides.bounds?.height ?? DEFAULT_WORLD_TIMELINE_RULES.bounds.height,
  };
  const biomeRegions = (
    overrides.biomeRegions ??
    (overrides.bounds
      ? createQuadrantBiomes(bounds)
      : DEFAULT_WORLD_TIMELINE_RULES.biomeRegions)
  ).map((region) => ({ ...region }));
  const rules: WorldTimelineRules = {
    ticksPerSecond:
      overrides.ticksPerSecond ?? DEFAULT_WORLD_TIMELINE_RULES.ticksPerSecond,
    minimumIntervalTicks:
      overrides.minimumIntervalTicks ??
      DEFAULT_WORLD_TIMELINE_RULES.minimumIntervalTicks,
    maximumIntervalTicks:
      overrides.maximumIntervalTicks ??
      DEFAULT_WORLD_TIMELINE_RULES.maximumIntervalTicks,
    maximumEventsPerAdvance:
      overrides.maximumEventsPerAdvance ??
      DEFAULT_WORLD_TIMELINE_RULES.maximumEventsPerAdvance,
    minimumWeatherDurationTicks:
      overrides.minimumWeatherDurationTicks ??
      DEFAULT_WORLD_TIMELINE_RULES.minimumWeatherDurationTicks,
    maximumWeatherDurationTicks:
      overrides.maximumWeatherDurationTicks ??
      DEFAULT_WORLD_TIMELINE_RULES.maximumWeatherDurationTicks,
    minimumEffectDurationTicks:
      overrides.minimumEffectDurationTicks ??
      DEFAULT_WORLD_TIMELINE_RULES.minimumEffectDurationTicks,
    maximumEffectDurationTicks:
      overrides.maximumEffectDurationTicks ??
      DEFAULT_WORLD_TIMELINE_RULES.maximumEffectDurationTicks,
    maximumSalvageAmount:
      overrides.maximumSalvageAmount ??
      DEFAULT_WORLD_TIMELINE_RULES.maximumSalvageAmount,
    largeSalvageDropChance:
      overrides.largeSalvageDropChance ??
      DEFAULT_WORLD_TIMELINE_RULES.largeSalvageDropChance,
    bounds,
    biomeRegions,
    eventWeights: {
      ...DEFAULT_WORLD_TIMELINE_RULES.eventWeights,
      ...overrides.eventWeights,
    },
  };

  validateRules(rules);
  return rules;
}

function validateRules(rules: WorldTimelineRules): void {
  assertPositiveInteger(rules.ticksPerSecond, "ticksPerSecond");
  assertPositiveInteger(rules.minimumIntervalTicks, "minimumIntervalTicks");
  assertPositiveInteger(rules.maximumIntervalTicks, "maximumIntervalTicks");
  assertPositiveInteger(
    rules.maximumEventsPerAdvance,
    "maximumEventsPerAdvance",
  );
  assertPositiveInteger(
    rules.minimumWeatherDurationTicks,
    "minimumWeatherDurationTicks",
  );
  assertPositiveInteger(
    rules.maximumWeatherDurationTicks,
    "maximumWeatherDurationTicks",
  );
  assertPositiveInteger(
    rules.minimumEffectDurationTicks,
    "minimumEffectDurationTicks",
  );
  assertPositiveInteger(
    rules.maximumEffectDurationTicks,
    "maximumEffectDurationTicks",
  );
  assertPositiveInteger(rules.maximumSalvageAmount, "maximumSalvageAmount");
  if (
    !Number.isFinite(rules.largeSalvageDropChance) ||
    rules.largeSalvageDropChance < 0 ||
    rules.largeSalvageDropChance > 1
  ) {
    throw new RangeError("largeSalvageDropChance must be between 0 and 1.");
  }

  if (rules.minimumIntervalTicks > rules.maximumIntervalTicks) {
    throw new RangeError(
      "minimumIntervalTicks cannot exceed maximumIntervalTicks.",
    );
  }
  if (rules.minimumWeatherDurationTicks > rules.maximumWeatherDurationTicks) {
    throw new RangeError(
      "minimumWeatherDurationTicks cannot exceed maximumWeatherDurationTicks.",
    );
  }
  if (rules.minimumEffectDurationTicks > rules.maximumEffectDurationTicks) {
    throw new RangeError(
      "minimumEffectDurationTicks cannot exceed maximumEffectDurationTicks.",
    );
  }
  if (!Number.isFinite(rules.bounds.width) || rules.bounds.width <= 0) {
    throw new RangeError("World width must be finite and greater than zero.");
  }
  if (!Number.isFinite(rules.bounds.height) || rules.bounds.height <= 0) {
    throw new RangeError("World height must be finite and greater than zero.");
  }
  if (rules.biomeRegions.length === 0) {
    throw new RangeError("At least one biome region is required.");
  }

  const regionIds = new Set<string>();
  for (const region of rules.biomeRegions) {
    if (region.id.length === 0 || regionIds.has(region.id)) {
      throw new RangeError("Biome region IDs must be non-empty and unique.");
    }
    regionIds.add(region.id);
    if (
      !Number.isFinite(region.x) ||
      !Number.isFinite(region.y) ||
      !Number.isFinite(region.width) ||
      !Number.isFinite(region.height) ||
      region.x < 0 ||
      region.y < 0 ||
      region.width <= 0 ||
      region.height <= 0 ||
      region.x + region.width > rules.bounds.width ||
      region.y + region.height > rules.bounds.height
    ) {
      throw new RangeError(
        `Biome region "${region.id}" must fit inside the world bounds.`,
      );
    }
  }

  let totalWeight = 0;
  for (const kind of WORLD_EVENT_KINDS) {
    const weight = rules.eventWeights[kind];
    if (!Number.isFinite(weight) || weight < 0) {
      throw new RangeError(`Event weight "${kind}" must be non-negative.`);
    }
    totalWeight += weight;
  }
  if (totalWeight <= 0) {
    throw new RangeError("At least one world event kind must have weight.");
  }
}

function generateEvent(
  timelineSeed: number,
  randomState: number,
  sequence: number,
  scheduledTick: number,
  rules: WorldTimelineRules,
): GeneratedEvent {
  // One master-stream sample supplies an isolated payload seed. Payload code
  // can evolve without changing the interval or identity of later events.
  const payloadSeedSample = nextRandom(randomState);
  let payloadRandomState = payloadSeedSample.uint32;
  const kindSample = chooseWeightedKind(payloadRandomState, rules.eventWeights);
  payloadRandomState = kindSample.state;
  const id = createWorldEventId(timelineSeed, sequence, scheduledTick, kindSample.kind);
  const base = {
    id,
    sequence,
    scheduledTick,
    eventSeed: payloadSeedSample.uint32,
  };

  switch (kindSample.kind) {
    case "salvage_drop": {
      const location = generateLocation(payloadRandomState, rules.biomeRegions);
      const largeDropRoll = nextRandom(location.state);
      const amount =
        rules.maximumSalvageAmount > 1 &&
        largeDropRoll.value < rules.largeSalvageDropChance
          ? rules.maximumSalvageAmount
          : 1;
      return {
        randomState: payloadSeedSample.state,
        event: {
          ...base,
          category: "resource_drop",
          kind: "salvage_drop",
          regionId: location.region.id,
          biome: location.region.biome,
          position: location.position,
          amount,
        },
      };
    }
    case "biome_weather": {
      const region = randomItem(payloadRandomState, rules.biomeRegions);
      const intensity = randomInteger(region.state, 1, 3);
      const duration = randomInteger(
        intensity.state,
        rules.minimumWeatherDurationTicks,
        rules.maximumWeatherDurationTicks,
      );
      return {
        randomState: payloadSeedSample.state,
        event: {
          ...base,
          category: "environment",
          kind: "biome_weather",
          regionId: region.value.id,
          biome: region.value.biome,
          effect: weatherForBiome(region.value.biome),
          intensity: intensity.value as 1 | 2 | 3,
          durationTicks: duration.value,
        },
      };
    }
    case "buff_drop": {
      const location = generateLocation(payloadRandomState, rules.biomeRegions);
      const buff = randomItem(location.state, [
        "oxygen_refill",
        "burst_efficiency",
      ] as const);
      const duration = randomInteger(
        buff.state,
        rules.minimumEffectDurationTicks,
        rules.maximumEffectDurationTicks,
      );
      return {
        randomState: payloadSeedSample.state,
        event: {
          ...base,
          category: "buff",
          kind: "buff_drop",
          regionId: location.region.id,
          biome: location.region.biome,
          position: location.position,
          buff: buff.value,
          durationTicks: duration.value,
        },
      };
    }
    case "debuff_event": {
      const region = randomItem(payloadRandomState, rules.biomeRegions);
      const debuff = randomItem(region.state, [
        "oxygen_leak",
        "movement_drag",
      ] as const);
      const intensity = randomInteger(debuff.state, 1, 3);
      const duration = randomInteger(
        intensity.state,
        rules.minimumEffectDurationTicks,
        rules.maximumEffectDurationTicks,
      );
      return {
        randomState: payloadSeedSample.state,
        event: {
          ...base,
          category: "debuff",
          kind: "debuff_event",
          regionId: region.value.id,
          biome: region.value.biome,
          debuff: debuff.value,
          intensity: intensity.value as 1 | 2 | 3,
          durationTicks: duration.value,
        },
      };
    }
    case "machine_cycle":
      return {
        randomState: payloadSeedSample.state,
        event: {
          ...base,
          category: "machine_hook",
          kind: "machine_cycle",
          cycle: "production",
        },
      };
    case "tether_cycle":
      return {
        randomState: payloadSeedSample.state,
        event: {
          ...base,
          category: "tether_hook",
          kind: "tether_cycle",
          cycle: "network_pulse",
        },
      };
  }
}

function createWorldEventId(
  seed: number,
  sequence: number,
  scheduledTick: number,
  kind: WorldEventKind,
): string {
  return [
    "world",
    seed.toString(36).padStart(7, "0"),
    sequence.toString(36).padStart(6, "0"),
    scheduledTick.toString(36),
    kind,
  ].join("-");
}

function generateLocation(
  randomState: number,
  regions: readonly BiomeRegion[],
): { state: number; region: BiomeRegion; position: WorldPoint } {
  const region = randomItem(randomState, regions);
  const x = nextRandom(region.state);
  const y = nextRandom(x.state);

  return {
    state: y.state,
    region: region.value,
    position: {
      x: region.value.x + x.value * region.value.width,
      y: region.value.y + y.value * region.value.height,
    },
  };
}

function weatherForBiome(biome: WorldBiome): BiomeWeatherEffect {
  switch (biome) {
    case "water":
      return "rough_current";
    case "jungle":
      return "bug_swarm";
    case "desert":
      return "dust_storm";
    case "taiga":
      return "snow_squall";
  }
}

function chooseWeightedKind(
  randomState: number,
  weights: WorldEventWeights,
): { state: number; kind: WorldEventKind } {
  const roll = nextRandom(randomState);
  const totalWeight = WORLD_EVENT_KINDS.reduce(
    (total, kind) => total + weights[kind],
    0,
  );
  const target = roll.value * totalWeight;
  let cumulativeWeight = 0;
  let fallback: WorldEventKind = WORLD_EVENT_KINDS[0];

  for (const kind of WORLD_EVENT_KINDS) {
    if (weights[kind] <= 0) {
      continue;
    }
    fallback = kind;
    cumulativeWeight += weights[kind];
    if (target < cumulativeWeight) {
      return { state: roll.state, kind };
    }
  }

  return { state: roll.state, kind: fallback };
}

function randomItem<const Item>(
  randomState: number,
  values: readonly Item[],
): { state: number; value: Item } {
  const index = randomInteger(randomState, 0, values.length - 1);
  return { state: index.state, value: values[index.value] };
}

function randomInteger(
  randomState: number,
  minimum: number,
  maximum: number,
): { state: number; value: number } {
  const sample = nextRandom(randomState);
  return {
    state: sample.state,
    value: minimum + Math.floor(sample.value * (maximum - minimum + 1)),
  };
}

/** Mulberry32 step; all arithmetic is deliberately constrained to uint32. */
function nextRandom(randomState: number): RandomSample {
  const state = (randomState + 0x6d2b79f5) >>> 0;
  let value = state;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  const uint32 = (value ^ (value >>> 14)) >>> 0;
  return {
    state,
    uint32,
    value: uint32 / UINT32_RANGE,
  };
}

function normalizeTick(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite, non-negative number.`);
  }
  return Math.floor(value);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
}
