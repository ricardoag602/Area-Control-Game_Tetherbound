import { GAME_RULES, SIMULATION_RULES, WORLD } from "./constants";
import { createMovementState } from "./movement/movement";
import { PLAYER_IDS, type GameState, type PlayerId, type PlayerLimit, type Vec2 } from "./types";
import {
  createWorldTimeline,
  type BiomeRegion as TimelineBiomeRegion,
} from "./world/timeline";

const TIMELINE_BIOME_REGIONS: TimelineBiomeRegion[] = [
  { id: "water-event-zone", biome: "water", x: 70, y: 70, width: 68, height: 68 },
  { id: "jungle-event-zone", biome: "jungle", x: 212, y: 70, width: 68, height: 68 },
  { id: "desert-event-zone", biome: "desert", x: 70, y: 212, width: 68, height: 68 },
  { id: "taiga-event-zone", biome: "taiga", x: 212, y: 212, width: 68, height: 68 },
];

export function createInitialGameState(
  seed: number | string = "local-sandbox",
  playerLimit: PlayerLimit = 2,
): GameState {
  const activePlayerIds = PLAYER_IDS.slice(0, playerLimit);
  const activeLayout = createPlayerLayout(playerLimit);
  const fallbackLayout = createPlayerLayout(4);
  const players = Object.fromEntries(
    PLAYER_IDS.map((playerId) => {
      const placement = activeLayout[playerId] ?? fallbackLayout[playerId]!;
      return [playerId, {
        id: playerId,
        basePosition: { ...placement.basePosition },
        astronaut: {
          position: { ...placement.spawnPosition },
          movement: createMovementState(placement.facing),
          oxygen: GAME_RULES.oxygenMaximum,
          carriedSalvage: 0,
          bankedSalvage: 0,
          tetherKits: 2,
          respawns: 0,
        },
      }];
    }),
  ) as GameState["players"];

  return {
    elapsedMs: 0,
    simulationRemainderMs: 0,
    pendingInputs: {},
    activePlayerIds,
    matchPhase: "setup",
    scores: createNumberRecord(0),
    overtimeScores: createNumberRecord(0),
    overtimeElapsedMs: 0,
    hasDeployedAnchor: createBooleanRecord(false),
    tetherDisruptions: createNumberRecord(0),
    anchorTetherFabrications: createNumberRecord(0),
    baseCollapseProgressMs: createNumberRecord(0),
    baseCollapseAttacker: createNullablePlayerRecord(),
    matchOutcome: null,
    remainingMs: GAME_RULES.matchDurationMs,
    nextAnchorId: 1,
    worldTimeline: createGameWorldTimeline(seed),
    activeWeather: [],
    lastWorldEvent: null,
    players,
    anchors: [],
    salvage: createSymmetricSalvage(activePlayerIds, activeLayout),
  };
}

interface PlayerPlacement {
  basePosition: Vec2;
  spawnPosition: Vec2;
  facing: Vec2;
  angle: number;
}

export function createPlayerLayout(playerLimit: PlayerLimit) {
  const center = { x: WORLD.width / 2, y: WORLD.height / 2 };
  const baseRadius = Math.min(WORLD.width, WORLD.height) / 2 - 16;
  const angles = playerLimit === 2
    ? [Math.PI / 2, -Math.PI / 2]
    : playerLimit === 3
      ? [Math.PI / 2, 7 * Math.PI / 6, 11 * Math.PI / 6]
      : [Math.PI / 2, -Math.PI / 2, Math.PI, 0];

  return Object.fromEntries(
    PLAYER_IDS.slice(0, playerLimit).map((playerId, index) => {
      const angle = angles[index];
      const outward = { x: Math.cos(angle), y: Math.sin(angle) };
      return [playerId, {
        angle,
        basePosition: {
          x: center.x + outward.x * baseRadius,
          y: center.y + outward.y * baseRadius,
        },
        spawnPosition: {
          x: center.x + outward.x * (baseRadius - 18),
          y: center.y + outward.y * (baseRadius - 18),
        },
        facing: { x: -outward.x, y: -outward.y },
      }];
    }),
  ) as Partial<Record<PlayerId, PlayerPlacement>>;
}

function createSymmetricSalvage(
  activePlayerIds: readonly PlayerId[],
  layout: Partial<Record<PlayerId, PlayerPlacement>>,
) {
  const center = { x: WORLD.width / 2, y: WORLD.height / 2 };
  const baseRadius = Math.min(WORLD.width, WORLD.height) / 2 - 16;
  const offsets = [-0.16, 0.16, -0.24, 0.24, -0.32, 0.32, -0.4, 0.4];
  let sequence = 0;
  return activePlayerIds.flatMap((playerId) => offsets.map((offset, index) => {
    const placement = layout[playerId]!;
    const radius = baseRadius - 30 - Math.floor(index / 2) * 25;
    const angle = placement.angle + offset;
    sequence += 1;
    return {
      id: `salvage-${sequence}`,
      position: {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      },
      collected: false,
    };
  }));
}

function createNumberRecord(value: number): Record<PlayerId, number> {
  return Object.fromEntries(PLAYER_IDS.map((playerId) => [playerId, value])) as Record<PlayerId, number>;
}

function createBooleanRecord(value: boolean): Record<PlayerId, boolean> {
  return Object.fromEntries(PLAYER_IDS.map((playerId) => [playerId, value])) as Record<PlayerId, boolean>;
}

function createNullablePlayerRecord(): Record<PlayerId, PlayerId | null> {
  return Object.fromEntries(PLAYER_IDS.map((playerId) => [playerId, null])) as Record<PlayerId, PlayerId | null>;
}

export function createGameWorldTimeline(
  seed: number | string,
  startTick = 0,
) {
  return createWorldTimeline(seed, {
    startTick,
    rules: {
      ticksPerSecond: SIMULATION_RULES.ticksPerSecond,
      // A 2.5–4.6 second interval raises the average supply-drop rate by 50%
      // from the previous 4–6⅔ second tuning.
      minimumIntervalTicks: Math.round(
        2.5 * SIMULATION_RULES.ticksPerSecond,
      ),
      maximumIntervalTicks: Math.round(
        4.6 * SIMULATION_RULES.ticksPerSecond,
      ),
      largeSalvageDropChance: 0.3,
      bounds: WORLD,
      biomeRegions: TIMELINE_BIOME_REGIONS,
      eventWeights: {
        salvage_drop: 1,
        biome_weather: 0,
      },
    },
  });
}

export function baseId(playerId: PlayerId) {
  return `${playerId}-base`;
}
