import { GAME_RULES } from "../constants";
import { distance } from "../geometry";
import { MOVEMENT_RULES } from "../movement/movement";
import { isAnchorDirectlyDisrupted, isAnchorProtected } from "../simulation/tetherConflict";
import { canDeployAnchor, getPoweredNodes, isInsideSafeZone } from "../simulation/tetherNetwork";
import type { PlayerCommand } from "../simulation/playerController";
import type { Anchor, GameState, MovementCommand, PlayerId, Vec2 } from "../types";

const BOT_THINK_INTERVAL_MS = 250;
const BOT_OBJECTIVE_LOCK_MS = 1_000;
const BOT_BOOST_ALIGNMENT_MS = 200;
const BOT_BOOST_HOLD_SECONDS = 0.56;
const BOT_BOOST_COOLDOWN_MS = 2_200;
const BOT_DEPLOY_REACTION_MS = 300;
const BOT_RETURN_RESERVE_OXYGEN = 18;
const BOT_RETURN_SPEED_RATIO = 0.75;
const BOT_RETURN_DRAIN_RATIO = 1.2;
const BOT_RECOVERY_OXYGEN = 80;
const BOT_DEPARTURE_BOOST_OXYGEN = 88;
const BOT_ATTACK_OXYGEN = 68;
const BOT_ATTACK_RANGE = 48;
const BOT_BOOST_TARGET_DISTANCE = 52;
const BOT_DEPLOY_DISTANCE_RATIO = 0.7;
const BOT_BOOST_DEPLOY_GUARD_RATIO = 0.45;
const BOT_RETARGET_STOP_SPEED = 0.1;

type BotBoostPhase = "idle" | "aligning" | "arming" | "charging" | "cooldown";

export type BotObjectiveKind =
  | "retreat"
  | "defend"
  | "repair"
  | "bank"
  | "expand"
  | "attack_anchor"
  | "attack_base"
  | "salvage";

export interface BotObjective {
  kind: BotObjectiveKind;
  target: Vec2;
  targetId: string | null;
}

/**
 * Local-only decision memory. It deliberately contains no physics state: the bot
 * still has to express every action through the same commands as a player.
 */
export interface BotControllerState {
  nextThinkAtMs: number;
  objective: BotObjective | null;
  objectiveLockedUntilMs: number;
  boostPhase: BotBoostPhase;
  boostPhaseStartedAtMs: number;
  boostCooldownUntilMs: number;
  deployEligibleSinceMs: number | null;
  lastDeployAtMs: number;
}

export interface BotControllerStep {
  controller: BotControllerState;
  command: PlayerCommand;
}

const NO_COMMAND: PlayerCommand = {
  movementCommands: [],
  deployAnchor: false,
};

export function createBotControllerState(): BotControllerState {
  return {
    nextThinkAtMs: 0,
    objective: null,
    objectiveLockedUntilMs: 0,
    boostPhase: "idle",
    boostPhaseStartedAtMs: 0,
    boostCooldownUntilMs: 0,
    deployEligibleSinceMs: null,
    lastDeployAtMs: Number.NEGATIVE_INFINITY,
  };
}

/**
 * Advances one deterministic bot decision step. The returned commands are the
 * same commands emitted by the live pointer/keyboard controls; movement, oxygen,
 * collection, conflicts, and deployment remain authoritative simulation work.
 */
export function advanceBotController(
  state: GameState,
  playerId: PlayerId,
  current: BotControllerState,
): BotControllerStep {
  if (state.matchPhase === "finished" || state.remainingMs <= 0) {
    const controller = current.objective === null &&
        current.boostPhase === "idle" &&
        current.deployEligibleSinceMs === null
      ? current
      : {
          ...current,
          objective: null,
          boostPhase: "idle" as const,
          deployEligibleSinceMs: null,
        };
    return {
      controller,
      command: command({ type: "stop" }),
    };
  }

  const elapsedMs = state.elapsedMs;
  const astronaut = state.players[playerId].astronaut;
  let controller = normalizeController(current, elapsedMs);

  // A committed launch cannot be redirected by either a human or the bot.
  if (astronaut.movement.mode === "burst") {
    return {
      controller: {
        ...controller,
        boostPhase: "cooldown",
        boostCooldownUntilMs: Math.max(
          controller.boostCooldownUntilMs,
          elapsedMs + BOT_BOOST_COOLDOWN_MS,
        ),
        deployEligibleSinceMs: null,
      },
      command: NO_COMMAND,
    };
  }

  const urgentObjective = chooseUrgentObjective(state, playerId, controller);
  if (
    urgentObjective &&
    controller.objective?.kind !== urgentObjective.kind &&
    isPreparingBoost(controller.boostPhase)
  ) {
    // A player can cancel an unlaunched charge with Stop. Do the same when life
    // support or the home base requires an immediate change of plan.
    return {
      controller: {
        ...controller,
        objective: urgentObjective,
        objectiveLockedUntilMs: elapsedMs + BOT_OBJECTIVE_LOCK_MS,
        nextThinkAtMs: elapsedMs + BOT_THINK_INTERVAL_MS,
        boostPhase: "cooldown",
        boostCooldownUntilMs: elapsedMs + BOT_BOOST_COOLDOWN_MS,
        deployEligibleSinceMs: null,
      },
      command: command({ type: "stop" }),
    };
  }

  const boostStep = advanceBoostGesture(state, playerId, controller);
  if (boostStep) return boostStep;

  let objective = urgentObjective ?? retainedObjective(state, playerId, controller);
  const mayThink = elapsedMs >= controller.nextThinkAtMs;
  if (!objective && mayThink) objective = chooseObjective(state, playerId);

  if (objective !== controller.objective) {
    controller = {
      ...controller,
      objective,
      objectiveLockedUntilMs: elapsedMs + BOT_OBJECTIVE_LOCK_MS,
    };
  }

  const deploy = advanceDeployIntent(state, playerId, controller, objective);
  controller = deploy.controller;

  if (!mayThink) {
    return {
      controller,
      command: deploy.deployAnchor
        ? { movementCommands: [], deployAnchor: true }
        : NO_COMMAND,
    };
  }

  controller = {
    ...controller,
    nextThinkAtMs: elapsedMs + BOT_THINK_INTERVAL_MS,
  };

  if (!objective) {
    return {
      controller,
      command: {
        movementCommands: astronaut.movement.mode === "idle"
          ? []
          : [{ type: "stop" }],
        deployAnchor: deploy.deployAnchor,
      },
    };
  }

  const remainingDistance = distance(astronaut.position, objective.target);
  const arrived = remainingDistance <= objectiveArrivalRadius(objective.kind);
  if (arrived) {
    return {
      controller,
      command: {
        movementCommands: astronaut.movement.mode === "idle"
          ? []
          : [{ type: "stop" }],
        deployAnchor: deploy.deployAnchor,
      },
    };
  }

  const sameWalkTarget = astronaut.movement.mode === "walking" &&
    astronaut.movement.target !== null &&
    samePosition(astronaut.movement.target, objective.target);
  if (sameWalkTarget) {
    return {
      controller,
      command: { movementCommands: [], deployAnchor: deploy.deployAnchor },
    };
  }

  // Changing a target while carrying velocity can ask the target-walker's
  // arrival guard to cross the destination in one frame. A player naturally
  // releases their old input before reversing; explicitly do that here too.
  // The authoritative deceleration resolves on the next fixed simulation tick.
  if (mustStopBeforeRetarget(astronaut.movement, objective.target)) {
    return {
      controller,
      command: {
        movementCommands: [{ type: "stop" }],
        deployAnchor: deploy.deployAnchor,
      },
    };
  }

  const shouldBoost = canBeginBoost(state, playerId, controller, objective);
  return {
    controller: shouldBoost
      ? {
          ...controller,
          boostPhase: "aligning",
          boostPhaseStartedAtMs: elapsedMs,
        }
      : controller,
    command: {
      movementCommands: [{ type: "walk", target: { ...objective.target } }],
      deployAnchor: deploy.deployAnchor,
    },
  };
}

/** First-decision compatibility helper; local matches use advanceBotController. */
export function getBotCommand(state: GameState, playerId: PlayerId): PlayerCommand {
  return advanceBotController(state, playerId, createBotControllerState()).command;
}

function advanceBoostGesture(
  state: GameState,
  playerId: PlayerId,
  controller: BotControllerState,
): BotControllerStep | null {
  const elapsedMs = state.elapsedMs;
  const movement = state.players[playerId].astronaut.movement;

  if (controller.boostPhase === "aligning") {
    if (elapsedMs - controller.boostPhaseStartedAtMs < BOT_BOOST_ALIGNMENT_MS) {
      return { controller, command: NO_COMMAND };
    }
    return {
      controller: {
        ...controller,
        boostPhase: "arming",
        boostPhaseStartedAtMs: elapsedMs,
      },
      command: command({ type: "tank_drive", throttle: 1, steering: 0 }),
    };
  }

  if (controller.boostPhase === "arming") {
    if (elapsedMs - controller.boostPhaseStartedAtMs < MOVEMENT_RULES.gestureArmMs) {
      return { controller, command: NO_COMMAND };
    }
    return {
      controller: {
        ...controller,
        boostPhase: "charging",
        boostPhaseStartedAtMs: elapsedMs,
      },
      command: command({ type: "tank_charge", throttle: 1, steering: 0 }),
    };
  }

  if (controller.boostPhase === "charging") {
    if (
      movement.mode === "charging" &&
      movement.chargeSeconds < BOT_BOOST_HOLD_SECONDS
    ) {
      return { controller, command: NO_COMMAND };
    }
    if (movement.mode === "charging") {
      return {
        controller: {
          ...controller,
          boostPhase: "cooldown",
          boostCooldownUntilMs: elapsedMs + BOT_BOOST_COOLDOWN_MS,
        },
        command: command({ type: "tank_release" }),
      };
    }
    return {
      controller: {
        ...controller,
        boostPhase: "cooldown",
        boostCooldownUntilMs: elapsedMs + BOT_BOOST_COOLDOWN_MS,
      },
      command: NO_COMMAND,
    };
  }

  return null;
}

function advanceDeployIntent(
  state: GameState,
  playerId: PlayerId,
  controller: BotControllerState,
  objective: BotObjective | null,
) {
  const eligible = Boolean(
    objective &&
    (objective.kind === "expand" || objective.kind === "salvage") &&
    isUsefulExtensionPosition(state, playerId) &&
    canDeployAnchor(state, playerId),
  );
  if (!eligible) {
    return {
      controller: controller.deployEligibleSinceMs === null
        ? controller
        : { ...controller, deployEligibleSinceMs: null },
      deployAnchor: false,
    };
  }

  if (controller.deployEligibleSinceMs === null) {
    return {
      controller: { ...controller, deployEligibleSinceMs: state.elapsedMs },
      deployAnchor: false,
    };
  }

  const reacted = state.elapsedMs - controller.deployEligibleSinceMs >=
    BOT_DEPLOY_REACTION_MS;
  if (!reacted) return { controller, deployAnchor: false };

  return {
    controller: {
      ...controller,
      deployEligibleSinceMs: null,
      lastDeployAtMs: state.elapsedMs,
    },
    deployAnchor: true,
  };
}

function chooseUrgentObjective(
  state: GameState,
  playerId: PlayerId,
  controller: BotControllerState,
): BotObjective | null {
  const astronaut = state.players[playerId].astronaut;
  const refilling = controller.objective?.kind === "retreat" &&
    astronaut.oxygen < BOT_RECOVERY_OXYGEN;
  if (refilling || needsOxygenRetreat(state, playerId)) {
    const node = closestPoweredNode(state, playerId);
    return node
      ? { kind: "retreat", target: { ...node.position }, targetId: node.id }
      : null;
  }
  if (state.baseCollapseProgressMs[playerId] > 0) {
    return {
      kind: "defend",
      target: { ...state.players[playerId].basePosition },
      targetId: `${playerId}-base`,
    };
  }
  return null;
}

function chooseObjective(state: GameState, playerId: PlayerId): BotObjective | null {
  const astronaut = state.players[playerId].astronaut;
  const repair = chooseRepairTarget(state, playerId);
  if (repair) {
    return {
      kind: "repair",
      target: { ...repair.position },
      targetId: repair.id,
    };
  }

  const shouldBank = astronaut.carriedSalvage >= GAME_RULES.salvageCarryLimit ||
    (
      astronaut.carriedSalvage >= GAME_RULES.salvagePerTether &&
      astronaut.tetherKits === 0
    );
  if (shouldBank) {
    const node = closestPoweredNode(state, playerId);
    if (node) {
      return {
        kind: "bank",
        target: { ...node.position },
        targetId: node.id,
      };
    }
  }

  const attack = chooseAttackTarget(state, playerId);
  const salvage = chooseSalvageTarget(state, playerId);
  const hasExpansionKit = astronaut.tetherKits > 0;

  if (attack && attack.distance <= GAME_RULES.anchorInteractionRadius * 2.4) {
    return attack.objective;
  }
  if (salvage) {
    return {
      kind: hasExpansionKit ? "expand" : "salvage",
      target: { ...salvage.position },
      targetId: salvage.id,
    };
  }
  if (attack) return attack.objective;

  if (astronaut.carriedSalvage > 0) {
    const node = closestPoweredNode(state, playerId);
    if (node) {
      return {
        kind: "bank",
        target: { ...node.position },
        targetId: node.id,
      };
    }
  }
  return null;
}

function retainedObjective(
  state: GameState,
  playerId: PlayerId,
  controller: BotControllerState,
) {
  const objective = controller.objective;
  if (!objective || state.elapsedMs >= controller.objectiveLockedUntilMs) return null;
  return objectiveIsValid(state, playerId, objective) ? objective : null;
}

function objectiveIsValid(
  state: GameState,
  playerId: PlayerId,
  objective: BotObjective,
) {
  if (objective.kind === "retreat") return needsOxygenRetreat(state, playerId);
  if (objective.kind === "defend") return state.baseCollapseProgressMs[playerId] > 0;
  if (objective.kind === "bank") {
    return state.players[playerId].astronaut.carriedSalvage > 0;
  }
  if (objective.kind === "repair") {
    const anchor = state.anchors.find((candidate) => candidate.id === objective.targetId);
    return Boolean(
      anchor &&
      anchor.owner === playerId &&
      isAnchorDirectlyDisrupted(anchor, state.elapsedMs),
    );
  }
  if (objective.kind === "attack_anchor") {
    const anchor = state.anchors.find((candidate) => candidate.id === objective.targetId);
    return Boolean(
      anchor &&
      anchor.owner !== playerId &&
      anchor.powered &&
      !isAnchorProtected(anchor, state.elapsedMs),
    );
  }
  if (objective.kind === "attack_base") {
    const opponentId = objective.targetId as PlayerId | null;
    return opponentId ? enemyBaseIsExposed(state, opponentId) : false;
  }
  const deposit = state.salvage.find((candidate) => candidate.id === objective.targetId);
  return Boolean(deposit && !deposit.collected);
}

function needsOxygenRetreat(state: GameState, playerId: PlayerId) {
  const astronaut = state.players[playerId].astronaut;
  if (isInsideSafeZone(state, playerId, astronaut.position)) return false;
  const node = closestPoweredNode(state, playerId);
  if (!node) return true;
  const distanceToSafety = Math.max(
    0,
    distance(astronaut.position, node.position) - GAME_RULES.safeZoneRadius,
  );
  const conservativeSpeed = MOVEMENT_RULES.walkMaximumSpeed * BOT_RETURN_SPEED_RATIO;
  const oxygenForTrip = distanceToSafety / conservativeSpeed *
    GAME_RULES.oxygenDrainPerSecond * BOT_RETURN_DRAIN_RATIO;
  return astronaut.oxygen <= oxygenForTrip + BOT_RETURN_RESERVE_OXYGEN;
}

function chooseRepairTarget(state: GameState, playerId: PlayerId) {
  const origin = state.players[playerId].astronaut.position;
  return state.anchors
    .filter(
      (anchor) =>
        anchor.owner === playerId &&
        isAnchorDirectlyDisrupted(anchor, state.elapsedMs) &&
        parentIsPowered(state, anchor),
    )
    .map((anchor) => ({
      anchor,
      descendants: descendantCount(state, anchor),
      distance: distance(origin, anchor.position),
    }))
    .sort(
      (a, b) =>
        b.descendants - a.descendants ||
        a.distance - b.distance ||
        a.anchor.id.localeCompare(b.anchor.id),
    )[0]?.anchor ?? null;
}

function chooseAttackTarget(state: GameState, playerId: PlayerId) {
  const astronaut = state.players[playerId].astronaut;
  if (state.matchPhase === "setup" || astronaut.oxygen < BOT_ATTACK_OXYGEN) return null;
  const opponentIds = state.activePlayerIds.filter((candidate) => candidate !== playerId);
  const anchorChoice = state.anchors
    .filter(
      (anchor) =>
        anchor.owner !== playerId &&
        anchor.powered &&
        !isAnchorProtected(anchor, state.elapsedMs),
    )
    .map((anchor) => ({
      anchor,
      distance: distance(astronaut.position, anchor.position),
      descendants: descendantCount(state, anchor),
    }))
    .filter((candidate) => candidate.distance <= BOT_ATTACK_RANGE)
    .sort(
      (a, b) =>
        b.descendants - a.descendants ||
        a.distance - b.distance ||
        a.anchor.id.localeCompare(b.anchor.id),
    )[0];
  if (anchorChoice) {
    return {
      distance: anchorChoice.distance,
      objective: {
        kind: "attack_anchor" as const,
        target: { ...anchorChoice.anchor.position },
        targetId: anchorChoice.anchor.id,
      },
    };
  }

  const exposedBase = opponentIds
    .filter((opponentId) => enemyBaseIsExposed(state, opponentId))
    .map((opponentId) => ({
      opponentId,
      target: state.players[opponentId].basePosition,
      distance: distance(
        astronaut.position,
        state.players[opponentId].basePosition,
      ),
    }))
    .filter((candidate) => candidate.distance <= BOT_ATTACK_RANGE)
    .sort(
      (a, b) =>
        a.distance - b.distance ||
        a.opponentId.localeCompare(b.opponentId),
    )[0];
  return exposedBase
    ? {
        distance: exposedBase.distance,
        objective: {
          kind: "attack_base" as const,
          target: { ...exposedBase.target },
          targetId: exposedBase.opponentId,
        },
      }
    : null;
}

function chooseSalvageTarget(state: GameState, playerId: PlayerId) {
  const origin = state.players[playerId].astronaut.position;
  const opponents = state.activePlayerIds.filter((candidate) => candidate !== playerId);
  const nodes = getPoweredNodes(state, playerId);
  return state.salvage
    .filter((deposit) => !deposit.collected)
    .map((deposit) => {
      const travelDistance = distance(origin, deposit.position);
      const networkDistance = minimumDistance(
        deposit.position,
        nodes.map((node) => node.position),
      );
      const opponentDistance = minimumDistance(
        deposit.position,
        opponents.map((opponentId) => state.players[opponentId].astronaut.position),
      );
      const contestOpportunity = Math.max(
        0,
        Math.min(12, opponentDistance - travelDistance + 6),
      );
      return {
        deposit,
        score: travelDistance + networkDistance * 0.14 - contestOpportunity * 0.25,
      };
    })
    .sort(
      (a, b) =>
        a.score - b.score ||
        distance(origin, a.deposit.position) - distance(origin, b.deposit.position) ||
        a.deposit.id.localeCompare(b.deposit.id),
    )[0]?.deposit ?? null;
}

function canBeginBoost(
  state: GameState,
  playerId: PlayerId,
  controller: BotControllerState,
  objective: BotObjective,
) {
  const astronaut = state.players[playerId].astronaut;
  if (
    controller.boostPhase !== "idle" ||
    state.elapsedMs < controller.boostCooldownUntilMs ||
    astronaut.movement.mode === "charging" ||
    astronaut.movement.mode === "burst" ||
    (
      objective.kind !== "retreat" &&
      astronaut.oxygen < BOT_DEPARTURE_BOOST_OXYGEN
    ) ||
    distance(astronaut.position, objective.target) < BOT_BOOST_TARGET_DISTANCE
  ) return false;

  const node = closestPoweredNode(state, playerId);
  const nodeDistance = node ? distance(astronaut.position, node.position) : 0;
  const approachingDeployBand = astronaut.tetherKits > 0 &&
    (objective.kind === "expand" || objective.kind === "salvage") &&
    nodeDistance >= GAME_RULES.maximumLinkDistance * BOT_BOOST_DEPLOY_GUARD_RATIO;
  return !approachingDeployBand;
}

function mustStopBeforeRetarget(
  movement: GameState["players"][PlayerId]["astronaut"]["movement"],
  target: Vec2,
) {
  if (movement.target && samePosition(movement.target, target)) return false;
  return Math.hypot(movement.velocity.x, movement.velocity.y) >
    BOT_RETARGET_STOP_SPEED;
}

function normalizeController(
  controller: BotControllerState,
  elapsedMs: number,
): BotControllerState {
  if (
    controller.boostPhase === "cooldown" &&
    elapsedMs >= controller.boostCooldownUntilMs
  ) {
    return { ...controller, boostPhase: "idle" };
  }
  return controller;
}

function isPreparingBoost(phase: BotBoostPhase) {
  return phase === "aligning" || phase === "arming" || phase === "charging";
}

function isUsefulExtensionPosition(state: GameState, playerId: PlayerId) {
  const astronaut = state.players[playerId].astronaut;
  const node = closestPoweredNode(state, playerId);
  return Boolean(
    node &&
    distance(astronaut.position, node.position) >=
      GAME_RULES.maximumLinkDistance * BOT_DEPLOY_DISTANCE_RATIO,
  );
}

function closestPoweredNode(state: GameState, playerId: PlayerId) {
  const origin = state.players[playerId].astronaut.position;
  return getPoweredNodes(state, playerId)
    .map((node) => ({ node, distance: distance(origin, node.position) }))
    .sort(
      (a, b) =>
        a.distance - b.distance ||
        a.node.id.localeCompare(b.node.id),
    )[0]?.node ?? null;
}

function descendantCount(state: GameState, root: Anchor) {
  const children = new Map<string, Anchor[]>();
  for (const anchor of state.anchors) {
    const siblings = children.get(anchor.parentId) ?? [];
    siblings.push(anchor);
    children.set(anchor.parentId, siblings);
  }
  let count = 0;
  const pending = [...(children.get(root.id) ?? [])];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const anchor = pending.pop()!;
    if (visited.has(anchor.id)) continue;
    visited.add(anchor.id);
    count += 1;
    pending.push(...(children.get(anchor.id) ?? []));
  }
  return count;
}

function parentIsPowered(state: GameState, anchor: Anchor) {
  if (anchor.parentId === `${anchor.owner}-base`) return true;
  return state.anchors.some(
    (candidate) => candidate.id === anchor.parentId && candidate.powered,
  );
}

function enemyBaseIsExposed(state: GameState, opponentId: PlayerId) {
  return state.matchPhase !== "setup" &&
    state.hasDeployedAnchor[opponentId] &&
    !state.anchors.some(
      (anchor) => anchor.owner === opponentId && anchor.powered,
    );
}

function objectiveArrivalRadius(kind: BotObjectiveKind) {
  if (kind === "attack_anchor" || kind === "repair") {
    return GAME_RULES.anchorInteractionRadius * 0.72;
  }
  if (kind === "attack_base" || kind === "defend") {
    return GAME_RULES.baseCollapseRadius * 0.72;
  }
  if (kind === "retreat") return GAME_RULES.safeZoneRadius * 0.55;
  if (kind === "bank") return GAME_RULES.deliveryRadius * 0.7;
  return GAME_RULES.collectionRadius * 0.6;
}

function minimumDistance(origin: Vec2, positions: Vec2[]) {
  if (positions.length === 0) return Number.POSITIVE_INFINITY;
  return Math.min(...positions.map((position) => distance(origin, position)));
}

function samePosition(a: Vec2, b: Vec2) {
  return Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001;
}

function command(movementCommand: MovementCommand): PlayerCommand {
  return { movementCommands: [movementCommand], deployAnchor: false };
}
