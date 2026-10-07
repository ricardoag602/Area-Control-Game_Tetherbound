export type PlayerId = "player" | "rival";
export type GameMode = "bot" | "multiplayer";

export interface Vec2 {
  x: number;
  y: number;
}

export interface Anchor {
  id: string;
  owner: PlayerId;
  position: Vec2;
  parentId: string;
  powered: boolean;
}

export interface SalvageDeposit {
  id: string;
  position: Vec2;
  collected: boolean;
}

export interface AstronautState {
  position: Vec2;
  oxygen: number;
  carriedSalvage: number;
  bankedSalvage: number;
  tetherKits: number;
  respawns: number;
}

export interface PlayerState {
  id: PlayerId;
  basePosition: Vec2;
  astronaut: AstronautState;
}

export interface GameState {
  remainingMs: number;
  players: Record<PlayerId, PlayerState>;
  anchors: Anchor[];
  salvage: SalvageDeposit[];
}

export interface GameInput {
  moveTarget: Vec2 | null;
}
