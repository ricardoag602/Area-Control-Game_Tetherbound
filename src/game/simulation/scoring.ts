import type { GameState, PlayerId } from "../types";
import { sampleTerritoryGrid } from "../world/territory";

export function getTerritoryScore(state: GameState, playerId: PlayerId) {
  return sampleTerritoryGrid(state).score[playerId];
}
