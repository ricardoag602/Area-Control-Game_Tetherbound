import { GAME_RULES } from "./constants";
import type { GameState, PlayerId, Vec2 } from "./types";

const PLAYER_BASE: Vec2 = { x: 50, y: 148 };
const RIVAL_BASE: Vec2 = { x: 50, y: 12 };

export function createInitialGameState(): GameState {
  return {
    remainingMs: GAME_RULES.matchDurationMs,
    players: {
      player: {
        id: "player",
        basePosition: PLAYER_BASE,
        astronaut: {
          position: { x: 50, y: 135 },
          oxygen: GAME_RULES.oxygenMaximum,
          carriedSalvage: 0,
          bankedSalvage: 0,
          tetherKits: 2,
          respawns: 0,
        },
      },
      rival: {
        id: "rival",
        basePosition: RIVAL_BASE,
        astronaut: {
          position: { x: 50, y: 25 },
          oxygen: GAME_RULES.oxygenMaximum,
          carriedSalvage: 0,
          bankedSalvage: 0,
          tetherKits: 1,
          respawns: 0,
        },
      },
    },
    anchors: [
      {
        id: "rival-anchor-1",
        owner: "rival",
        position: { x: 58, y: 34 },
        parentId: baseId("rival"),
        powered: true,
      },
    ],
    salvage: [
      { id: "salvage-1", position: { x: 28, y: 106 }, collected: false },
      { id: "salvage-2", position: { x: 65, y: 96 }, collected: false },
      { id: "salvage-3", position: { x: 43, y: 78 }, collected: false },
      { id: "salvage-4", position: { x: 73, y: 63 }, collected: false },
      { id: "salvage-5", position: { x: 31, y: 51 }, collected: false },
    ],
  };
}

export function baseId(playerId: PlayerId) {
  return `${playerId}-base`;
}
