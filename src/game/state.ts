import { GAME_RULES, SIMULATION_RULES, WORLD } from "./constants";
import { createMovementState } from "./movement/movement";
import type { GameState, PlayerId } from "./types";
import { WORLD_BASE_SLOTS } from "./world/map";
import {
  createWorldTimeline,
  type BiomeRegion as TimelineBiomeRegion,
} from "./world/timeline";

const PLAYER_BASE = WORLD_BASE_SLOTS.south.basePosition;
const RIVAL_BASE = WORLD_BASE_SLOTS.north.basePosition;

const TIMELINE_BIOME_REGIONS: TimelineBiomeRegion[] = [
  { id: "water-event-zone", biome: "water", x: 6, y: 65, width: 82, height: 90 },
  { id: "jungle-event-zone", biome: "jungle", x: 122, y: 65, width: 82, height: 90 },
  { id: "desert-event-zone", biome: "desert", x: 6, y: 195, width: 82, height: 85 },
  { id: "taiga-event-zone", biome: "taiga", x: 122, y: 195, width: 82, height: 85 },
];

export function createInitialGameState(seed: number | string = "local-sandbox"): GameState {
  return {
    elapsedMs: 0,
    simulationRemainderMs: 0,
    pendingInputs: {},
    remainingMs: GAME_RULES.matchDurationMs,
    nextAnchorId: 1,
    worldTimeline: createGameWorldTimeline(seed),
    activeWeather: [],
    lastWorldEvent: null,
    players: {
      player: {
        id: "player",
        basePosition: { ...PLAYER_BASE },
        astronaut: {
          position: { ...WORLD_BASE_SLOTS.south.spawnPosition },
          movement: createMovementState(WORLD_BASE_SLOTS.south.facing),
          oxygen: GAME_RULES.oxygenMaximum,
          carriedSalvage: 0,
          bankedSalvage: 0,
          tetherKits: 2,
          respawns: 0,
        },
      },
      rival: {
        id: "rival",
        basePosition: { ...RIVAL_BASE },
        astronaut: {
          position: { ...WORLD_BASE_SLOTS.north.spawnPosition },
          movement: createMovementState(WORLD_BASE_SLOTS.north.facing),
          oxygen: GAME_RULES.oxygenMaximum,
          carriedSalvage: 0,
          bankedSalvage: 0,
          tetherKits: 2,
          respawns: 0,
        },
      },
    },
    anchors: [],
    salvage: [
      { id: "salvage-1", position: { x: 90, y: 300 }, collected: false },
      { id: "salvage-2", position: { x: 120, y: 50 }, collected: false },
      { id: "salvage-3", position: { x: 125, y: 290 }, collected: false },
      { id: "salvage-4", position: { x: 85, y: 60 }, collected: false },
      { id: "salvage-5", position: { x: 65, y: 265 }, collected: false },
      { id: "salvage-6", position: { x: 145, y: 85 }, collected: false },
      { id: "salvage-7", position: { x: 155, y: 250 }, collected: false },
      { id: "salvage-8", position: { x: 55, y: 100 }, collected: false },
      { id: "salvage-9", position: { x: 90, y: 225 }, collected: false },
      { id: "salvage-10", position: { x: 120, y: 125 }, collected: false },
      { id: "salvage-11", position: { x: 50, y: 200 }, collected: false },
      { id: "salvage-12", position: { x: 160, y: 150 }, collected: false },
      { id: "salvage-13", position: { x: 150, y: 205 }, collected: false },
      { id: "salvage-14", position: { x: 60, y: 145 }, collected: false },
      { id: "salvage-15", position: { x: 90, y: 175 }, collected: false },
      { id: "salvage-16", position: { x: 120, y: 175 }, collected: false },
    ],
  };
}

export function createGameWorldTimeline(
  seed: number | string,
  startTick = 0,
) {
  return createWorldTimeline(seed, {
    startTick,
    rules: {
      ticksPerSecond: SIMULATION_RULES.ticksPerSecond,
      minimumIntervalTicks: 8 * SIMULATION_RULES.ticksPerSecond,
      maximumIntervalTicks: 14 * SIMULATION_RULES.ticksPerSecond,
      bounds: WORLD,
      biomeRegions: TIMELINE_BIOME_REGIONS,
    },
  });
}

export function baseId(playerId: PlayerId) {
  return `${playerId}-base`;
}
