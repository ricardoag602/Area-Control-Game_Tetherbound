export type PlayerId = "player" | "rival";
export type GameMode = "bot" | "multiplayer";

export interface Vec2 {
  x: number;
  y: number;
}

export type MovementMode = "idle" | "walking" | "charging" | "burst";

export type MovementCommand =
  | { type: "walk"; target: Vec2 }
  | { type: "walk_direction"; direction: Vec2 }
  | { type: "charge" | "release"; target: Vec2 }
  | { type: "charge_direction" | "release_direction"; direction: Vec2 }
  | { type: "stop" };

export interface MovementState {
  mode: MovementMode;
  target: Vec2 | null;
  queuedDirection: Vec2 | null;
  direction: Vec2;
  velocity: Vec2;
  gaitDistance: number;
  gaitPhase: number;
  chargeSeconds: number;
  burstDistanceRemaining: number;
  burstDistanceTotal: number;
  lastCommandSequence: number;
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
  movement: MovementState;
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
  nextAnchorId: number;
  players: Record<PlayerId, PlayerState>;
  anchors: Anchor[];
  salvage: SalvageDeposit[];
}

export interface GameInput {
  sequence: number;
  command: MovementCommand;
}

export type MatchInputs = Partial<Record<PlayerId, GameInput[]>>;
