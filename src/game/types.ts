import type {
  BiomeWeatherEvent,
  WorldTimelineEvent,
  WorldTimelineState,
} from "./world/timeline";

export const PLAYER_IDS = ["player", "rival", "player3", "player4"] as const;
export type PlayerId = (typeof PLAYER_IDS)[number];
export type PlayerLimit = 2 | 3 | 4;
export type GameMode = "bot" | "multiplayer";
export type MatchPhase = "setup" | "regulation" | "overtime" | "finished";
export type MatchWinner = PlayerId | "draw";
export type MatchFinishReason =
  | "regulation_score"
  | "overtime_lead"
  | "overtime_territory"
  | "base_collapse";

export interface MatchOutcome {
  winner: MatchWinner;
  reason: MatchFinishReason;
}

export interface Vec2 {
  x: number;
  y: number;
}

export type MovementMode = "idle" | "walking" | "charging" | "burst";
export type TankAxis = -1 | 0 | 1;

export interface TankInput {
  throttle: TankAxis;
  steering: TankAxis;
}

export type MovementCommand =
  | { type: "walk"; target: Vec2 }
  | { type: "walk_direction"; direction: Vec2 }
  | { type: "charge"; target: Vec2 }
  | { type: "release"; target: Vec2 }
  | { type: "charge_direction"; direction: Vec2 }
  | { type: "release_direction"; direction: Vec2 }
  | ({ type: "tank_drive" | "tank_charge" } & TankInput)
  | { type: "tank_release" }
  | { type: "stop" };

export interface MovementState {
  mode: MovementMode;
  target: Vec2 | null;
  queuedDirection: Vec2 | null;
  direction: Vec2;
  facing: Vec2;
  /** Continuous, unwrapped orientation used to render complete revolutions. */
  headingRadians: number;
  velocity: Vec2;
  forwardSpeed: number;
  angularVelocity: number;
  tankThrottle: TankAxis;
  tankSteering: TankAxis;
  queuedTankInput: TankInput | null;
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
  /** Derived from this anchor's disruption and the power of every ancestor. */
  powered: boolean;
  /** Match-clock deadline for a direct overload. Null means locally healthy. */
  disruptedUntilMs: number | null;
  /** Match-clock deadline for post-recovery overload immunity. */
  protectedUntilMs: number | null;
  /** Normalized hostile hold progress, rendered as the outer warning arc. */
  overloadProgress: number;
  /** Normalized owner repair progress, rendered as the inner recovery arc. */
  repairProgress: number;
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
  /** Authoritative match clock used by deterministic world systems. */
  elapsedMs: number;
  /** Unsimulated wall time retained until the next fixed physics tick. */
  simulationRemainderMs: number;
  /** Commands received between fixed ticks, consumed together in sequence order. */
  pendingInputs: MatchInputs;
  /** Ordered roster participating in this match. Inactive maximum slots are ignored. */
  activePlayerIds: PlayerId[];
  /** Current authoritative rules phase. Setup is part of regulation time. */
  matchPhase: MatchPhase;
  /** Cumulative scorable-map-fraction seconds earned by each player. */
  scores: Record<PlayerId, number>;
  /** Overtime-only gains used for the sudden-lead victory threshold. */
  overtimeScores: Record<PlayerId, number>;
  overtimeElapsedMs: number;
  /** Historical deployment flag; a player with no prior anchor is collapse-immune. */
  hasDeployedAnchor: Record<PlayerId, boolean>;
  /** Hold progress indexed by the defender whose base is being collapsed. */
  baseCollapseProgressMs: Record<PlayerId, number>;
  /** Sole attacker currently credited with each defender's collapse progress. */
  baseCollapseAttacker: Record<PlayerId, PlayerId | null>;
  /** Set once and only once when authoritative play has finished. */
  matchOutcome: MatchOutcome | null;
  /** Remaining time in regulation, or in overtime after regulation expires. */
  remainingMs: number;
  nextAnchorId: number;
  worldTimeline: WorldTimelineState;
  activeWeather: BiomeWeatherEvent[];
  lastWorldEvent: WorldTimelineEvent | null;
  players: Record<PlayerId, PlayerState>;
  anchors: Anchor[];
  salvage: SalvageDeposit[];
}

export interface GameInput {
  sequence: number;
  command: MovementCommand;
}

export type MatchInputs = Partial<Record<PlayerId, GameInput[]>>;
