import { GAME_RULES, SIMULATION_RULES, WORLD } from "../constants";
import { clampToWorld } from "../geometry";
import { createGameWorldTimeline } from "../state";
import type { GameState } from "../types";
import {
  advanceWorldTimelineToElapsedMs,
  elapsedMsToWorldTick,
  type SalvageDropEvent,
  type WorldTimelineEvent,
} from "../world/timeline";

export function normalizeWorldSystems(state: GameState): GameState {
  const elapsedMs = Number.isFinite(state.elapsedMs)
    ? state.elapsedMs
    : Math.max(0, GAME_RULES.matchDurationMs - state.remainingMs);
  const simulationRemainderMs = Number.isFinite(state.simulationRemainderMs)
    ? Math.max(0, state.simulationRemainderMs)
    : 0;
  const pendingInputs = state.pendingInputs ?? {};
  if (state.worldTimeline) {
    return {
      ...state,
      elapsedMs,
      simulationRemainderMs,
      pendingInputs,
      activeWeather: Array.isArray(state.activeWeather) ? state.activeWeather : [],
      lastWorldEvent: state.lastWorldEvent ?? null,
    };
  }

  const startTick = Math.floor(
    (elapsedMs / 1_000) * SIMULATION_RULES.ticksPerSecond,
  );
  return {
    ...state,
    elapsedMs,
    simulationRemainderMs,
    pendingInputs,
    worldTimeline: createGameWorldTimeline("legacy-match", startTick),
    activeWeather: [],
    lastWorldEvent: null,
  };
}

export function advanceWorldSystems(state: GameState): GameState {
  let timeline = state.worldTimeline;
  const generatedEvents: WorldTimelineEvent[] = [];
  const targetTick = elapsedMsToWorldTick(
    state.elapsedMs,
    timeline.rules.ticksPerSecond,
  );
  const regulationHasExpired =
    state.matchPhase === "regulation" && state.remainingMs <= 0;
  if (
    state.matchPhase === "overtime" ||
    state.matchPhase === "finished" ||
    regulationHasExpired
  ) {
    return {
      ...state,
      activeWeather: state.activeWeather.filter(
        (event) => event.scheduledTick + event.durationTicks > targetTick,
      ),
    };
  }
  const maximumOverdueEvents = Math.max(
    1,
    Math.floor(
      (targetTick - timeline.processedThroughTick) /
        timeline.rules.minimumIntervalTicks,
    ) + 1,
  );
  const maximumPasses =
    Math.ceil(
      maximumOverdueEvents / timeline.rules.maximumEventsPerAdvance,
    ) + 1;
  let caughtUp = false;

  // Normal play emits at most one event here. Serialized replays/reconnects
  // may be farther behind, so drain every provably possible overdue event.
  for (let pass = 0; pass < maximumPasses; pass += 1) {
    const advanced = advanceWorldTimelineToElapsedMs(timeline, state.elapsedMs);
    timeline = advanced.state;
    generatedEvents.push(...advanced.events);
    if (advanced.caughtUp) {
      caughtUp = true;
      break;
    }
  }
  if (!caughtUp) {
    throw new RangeError(
      "World timeline could not catch up from its serialized state.",
    );
  }
  const currentTick = targetTick;
  let activeWeather = state.activeWeather.filter(
    (event) => event.scheduledTick + event.durationTicks > currentTick,
  );
  let salvage = state.salvage;
  let lastWorldEvent = state.lastWorldEvent;

  for (const event of generatedEvents) {
    lastWorldEvent = event;
    if (event.kind === "salvage_drop") {
      salvage = [...salvage, ...salvageFromDrop(event)];
    } else if (
      event.kind === "biome_weather" &&
      event.scheduledTick + event.durationTicks > currentTick
    ) {
      activeWeather = [...activeWeather, event];
    }
  }

  return {
    ...state,
    worldTimeline: timeline,
    activeWeather,
    lastWorldEvent,
    salvage,
  };
}

function salvageFromDrop(event: SalvageDropEvent) {
  const deposits = [];
  const baseAngle = ((event.eventSeed % 360) * Math.PI) / 180;
  for (let index = 0; index < event.amount; index += 1) {
    const radius = index === 0 ? 0 : 3;
    const angle = baseAngle + index * Math.PI;
    deposits.push({
      id: `salvage-${event.id}-${index}`,
      position: clampToWorld(
        {
          x: event.position.x + Math.cos(angle) * radius,
          y: event.position.y + Math.sin(angle) * radius,
        },
        WORLD.width,
        WORLD.height,
      ),
      collected: false,
    });
  }
  return deposits;
}
