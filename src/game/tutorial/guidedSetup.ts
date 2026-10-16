import { GAME_RULES } from "../constants";
import type { GameState, PlayerId, Vec2 } from "../types";

export {
  TUTORIAL_PREFERENCE_KEY,
  readTutorialPreference,
  writeTutorialPreference,
  type TutorialPreferenceStorage,
} from "./preference";

export const GUIDED_SETUP_STEPS = [
  "move",
  "boost",
  "deploy",
  "salvage",
  "bank",
  "break",
] as const;

export type TutorialStepId = (typeof GUIDED_SETUP_STEPS)[number];
export type GuidedSetupStatus = "active" | "completed" | "disabled";

export const GUIDED_SETUP_OBJECTIVE_REMINDER_DURATION_MS = 5_000;

const MOVEMENT_GOAL_DISTANCE = 6;
const STARTING_TETHER_KITS = 2;
const RESOURCE_EPSILON = 1e-6;
export const GUIDED_SETUP_MATERIAL_GOAL = GAME_RULES.salvagePerTether;

export interface GuidedSetupProgress {
  enabled: boolean;
  status: GuidedSetupStatus;
  completedAtElapsedMs: number | null;
  completed: Record<TutorialStepId, boolean>;
  movementDistance: number;
  previousPosition: Vec2;
  resourceUnits: number;
  materialsCollected: number;
  materialsAvailable: number;
  ownedAnchorCount: number;
  anchorTetherFabrications: number;
  tetherDisruptions: number;
}

/**
 * Starts a serializable progress tracker from an authoritative match snapshot.
 * Facts that are already visible in the snapshot are credited immediately.
 */
export function createGuidedSetupProgress(
  state: GameState,
  playerId: PlayerId,
  enabled = true,
): GuidedSetupProgress {
  const astronaut = state.players[playerId].astronaut;
  const ownedAnchorCount = countOwnedAnchors(state, playerId);
  const resourceUnits = getResourceUnits(state, playerId, ownedAnchorCount);
  const inferredMaterialsCollected = inferCollectedMaterialCount(resourceUnits);
  const anchorTetherFabrications = getAnchorTetherFabricationCount(
    state,
    playerId,
  );
  const convertedSalvage = anchorTetherFabrications > 0;
  const materialsCollected = convertedSalvage
    ? Math.max(GUIDED_SETUP_MATERIAL_GOAL, inferredMaterialsCollected)
    : inferredMaterialsCollected;
  const materialsAvailable = getAvailableMaterialCount(state, playerId);
  const tetherDisruptions = getTetherDisruptionCount(state, playerId);
  const status: GuidedSetupStatus = !enabled
    ? "disabled"
    : "active";

  return {
    enabled,
    status,
    completedAtElapsedMs: null,
    completed: {
      move: false,
      boost: astronaut.movement.mode === "burst" || astronaut.movement.burstDistanceTotal > 0,
      deploy: state.hasDeployedAnchor[playerId] || ownedAnchorCount > 0,
      salvage: materialsCollected >= GUIDED_SETUP_MATERIAL_GOAL,
      bank: convertedSalvage,
      break: tetherDisruptions > 0,
    },
    movementDistance: 0,
    previousPosition: copyPosition(astronaut.position),
    resourceUnits,
    materialsCollected,
    materialsAvailable,
    ownedAnchorCount,
    anchorTetherFabrications,
    tetherDisruptions,
  };
}

/** Advances only from confirmed local-player state; command attempts never count. */
export function advanceGuidedSetup(
  progress: GuidedSetupProgress,
  state: GameState,
  playerId: PlayerId,
): GuidedSetupProgress {
  if (progress.status !== "active") {
    return progress;
  }

  const astronaut = state.players[playerId].astronaut;
  const position = copyPosition(astronaut.position);
  const movementDistance = progress.movementDistance + distance(progress.previousPosition, position);
  const ownedAnchorCount = countOwnedAnchors(state, playerId);
  const resourceUnits = getResourceUnits(state, playerId, ownedAnchorCount);
  const gainedMaterial = Math.max(0, resourceUnits - progress.resourceUnits);
  const materialsCollected = Math.max(
    progress.materialsCollected + gainedMaterial,
    inferCollectedMaterialCount(resourceUnits),
  );
  const materialsAvailable = getAvailableMaterialCount(state, playerId);
  const anchorTetherFabrications = getAnchorTetherFabricationCount(
    state,
    playerId,
  );
  const tetherDisruptions = getTetherDisruptionCount(state, playerId);
  const completed = { ...progress.completed };
  completed.bank ||= anchorTetherFabrications > progress.anchorTetherFabrications;

  completed.move ||= movementDistance + RESOURCE_EPSILON >= MOVEMENT_GOAL_DISTANCE;
  completed.boost ||= astronaut.movement.mode === "burst" || astronaut.movement.burstDistanceTotal > 0;
  completed.deploy ||= state.hasDeployedAnchor[playerId] || ownedAnchorCount > progress.ownedAnchorCount;
  completed.salvage ||= completed.bank ||
    materialsCollected + RESOURCE_EPSILON >= GUIDED_SETUP_MATERIAL_GOAL;
  completed.break ||= tetherDisruptions > progress.tetherDisruptions;

  const status = GUIDED_SETUP_STEPS.every((step) => completed[step])
    ? "completed"
    : "active";

  return {
    ...progress,
    status,
    completedAtElapsedMs: status === "completed"
      ? state.elapsedMs
      : progress.completedAtElapsedMs,
    completed,
    movementDistance,
    previousPosition: position,
    resourceUnits,
    materialsCollected,
    materialsAvailable,
    ownedAnchorCount,
    anchorTetherFabrications,
    tetherDisruptions,
  };
}

export function shouldShowGuidedSetupObjectiveReminder(
  progress: GuidedSetupProgress,
  elapsedMs: number,
): boolean {
  if (
    progress.status !== "completed" ||
    progress.completedAtElapsedMs === null ||
    !Number.isFinite(progress.completedAtElapsedMs) ||
    !Number.isFinite(elapsedMs)
  ) {
    return false;
  }

  const ageMs = elapsedMs - progress.completedAtElapsedMs;
  return ageMs >= 0 && ageMs < GUIDED_SETUP_OBJECTIVE_REMINDER_DURATION_MS;
}

export function getCurrentGuidedSetupStep(
  progress: GuidedSetupProgress,
): TutorialStepId | null {
  if (progress.status !== "active") {
    return null;
  }

  return GUIDED_SETUP_STEPS.find((step) => !progress.completed[step]) ?? null;
}

function countOwnedAnchors(state: GameState, playerId: PlayerId): number {
  return state.anchors.reduce(
    (count, anchor) => count + Number(anchor.owner === playerId),
    0,
  );
}

function getAvailableMaterialCount(
  state: GameState,
  playerId: PlayerId,
): number {
  const astronaut = state.players[playerId].astronaut;
  return astronaut.carriedSalvage + astronaut.bankedSalvage;
}

function getResourceUnits(
  state: GameState,
  playerId: PlayerId,
  ownedAnchorCount: number,
): number {
  const astronaut = state.players[playerId].astronaut;
  return astronaut.carriedSalvage + astronaut.bankedSalvage +
    (astronaut.tetherKits + ownedAnchorCount) * GAME_RULES.salvagePerTether;
}

function inferCollectedMaterialCount(resourceUnits: number): number {
  const startingResources = STARTING_TETHER_KITS * GAME_RULES.salvagePerTether;
  return Math.max(0, resourceUnits - startingResources);
}

function getAnchorTetherFabricationCount(
  state: GameState,
  playerId: PlayerId,
): number {
  return Math.max(
    0,
    Math.floor(state.anchorTetherFabrications?.[playerId] ?? 0),
  );
}

function getTetherDisruptionCount(state: GameState, playerId: PlayerId): number {
  return Math.max(0, Math.floor(state.tetherDisruptions?.[playerId] ?? 0));
}

function copyPosition(position: Vec2): Vec2 {
  return { x: position.x, y: position.y };
}

function distance(left: Vec2, right: Vec2): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}
