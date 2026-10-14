import { GAME_RULES } from "../constants";
import { distance } from "../geometry";
import { baseId } from "../state";
import { PLAYER_IDS, type Anchor, type GameState, type PlayerId } from "../types";

export type AnchorPowerState = "powered" | "shielded" | "disrupted" | "severed";

export interface AnchorPresence {
  attackerNearby: boolean;
  hostileNearby: boolean;
  defenderNearby: boolean;
  repairingOwnerNearby: boolean;
}

export interface PlayerConflictTarget {
  kind: "overload" | "repair";
  anchorId: string;
}

/**
 * Advances proximity-based tether conflict. No additional input command is
 * required: holding an enemy node overloads it, while holding your directly
 * disrupted node repairs it. The server and bot use this exact same system.
 */
export function advanceTetherConflict(
  state: GameState,
  deltaSeconds: number,
  activePlayerIds: readonly PlayerId[] = state.activePlayerIds,
): GameState {
  const safeDeltaSeconds = Number.isFinite(deltaSeconds)
    ? Math.max(0, deltaSeconds)
    : 0;
  let anchors = resolveAnchorPower(
    state.anchors.map((anchor) => normalizeAnchor(anchor, state.elapsedMs)),
    state.elapsedMs,
  );
  const powerBeforeInteraction = new Map(
    anchors.map((anchor) => [anchor.id, anchor.powered]),
  );
  const interactionState = { ...state, anchors };
  const targets = Object.fromEntries(PLAYER_IDS.map((playerId) => [
    playerId,
    activePlayerIds.includes(playerId)
      ? getPlayerConflictTarget(interactionState, playerId)
      : null,
  ])) as Record<PlayerId, PlayerConflictTarget | null>;
  const activePlayers = new Set(activePlayerIds);
  const creditedDisruptors = new Set<PlayerId>();

  anchors = anchors.map((anchor) => {
    const presence = getAnchorPresence(
      interactionState,
      anchor,
      targets,
      activePlayers,
    );
    const directlyDisrupted = isAnchorDirectlyDisrupted(anchor, state.elapsedMs);

    if (directlyDisrupted) {
      const canRepair =
        presence.repairingOwnerNearby &&
        !presence.hostileNearby &&
        isParentPowered(anchor, powerBeforeInteraction);
      const repairProgress = canRepair
        ? clamp01(
            anchor.repairProgress +
              safeDeltaSeconds / GAME_RULES.anchorRepairSeconds,
          )
        : clamp01(
            anchor.repairProgress -
              safeDeltaSeconds * GAME_RULES.anchorRepairDecayPerSecond,
          );

      if (repairProgress >= 1) {
        return {
          ...anchor,
          disruptedUntilMs: null,
          protectedUntilMs:
            state.elapsedMs + GAME_RULES.anchorReactivationShieldMs,
          overloadProgress: 0,
          repairProgress: 0,
        };
      }

      return {
        ...anchor,
        overloadProgress: 0,
        repairProgress,
      };
    }

    if (!anchor.powered) {
      return {
        ...anchor,
        overloadProgress: decay(
          anchor.overloadProgress,
          GAME_RULES.anchorOverloadDecayPerSecond,
          safeDeltaSeconds,
        ),
        repairProgress: 0,
      };
    }

    let overloadProgress = anchor.overloadProgress;
    if (presence.attackerNearby && !presence.defenderNearby) {
      overloadProgress = clamp01(
        overloadProgress +
          safeDeltaSeconds / GAME_RULES.anchorOverloadSeconds,
      );
    } else {
      overloadProgress = decay(
        overloadProgress,
        presence.defenderNearby
          ? GAME_RULES.anchorDefenseRecoveryPerSecond
          : GAME_RULES.anchorOverloadDecayPerSecond,
        safeDeltaSeconds,
      );
    }

    if (overloadProgress >= 1) {
      for (const attackerId of activePlayerIds) {
        const target = targets[attackerId];
        if (target?.kind === "overload" && target.anchorId === anchor.id) {
          creditedDisruptors.add(attackerId);
        }
      }
      return {
        ...anchor,
        powered: false,
        disruptedUntilMs:
          state.elapsedMs + GAME_RULES.anchorDisruptionDurationMs,
        overloadProgress: 0,
        repairProgress: 0,
      };
    }

    return {
      ...anchor,
      overloadProgress,
      repairProgress: 0,
    };
  });

  return {
    ...state,
    anchors: resolveAnchorPower(anchors, state.elapsedMs),
    tetherDisruptions: Object.fromEntries(
      PLAYER_IDS.map((playerId) => [
        playerId,
        Math.max(0, Math.floor(state.tetherDisruptions?.[playerId] ?? 0)) +
          Number(creditedDisruptors.has(playerId)),
      ]),
    ) as Record<PlayerId, number>,
  };
}

/** Recomputes every descendant so a severed branch cannot remain safe. */
export function resolveAnchorPower(
  anchors: readonly Anchor[],
  elapsedMs: number,
): Anchor[] {
  const normalized = anchors.map((anchor) => normalizeAnchor(anchor, elapsedMs));
  const byId = new Map(normalized.map((anchor) => [anchor.id, anchor]));
  const memo = new Map<string, boolean>();

  function isPowered(anchor: Anchor, visiting: Set<string>): boolean {
    const cached = memo.get(anchor.id);
    if (cached !== undefined) return cached;
    if (isAnchorDirectlyDisrupted(anchor, elapsedMs) || visiting.has(anchor.id)) {
      memo.set(anchor.id, false);
      return false;
    }
    if (anchor.parentId === baseId(anchor.owner)) {
      memo.set(anchor.id, true);
      return true;
    }

    const parent = byId.get(anchor.parentId);
    if (!parent || parent.owner !== anchor.owner) {
      memo.set(anchor.id, false);
      return false;
    }
    const nextVisiting = new Set(visiting);
    nextVisiting.add(anchor.id);
    const powered = isPowered(parent, nextVisiting);
    memo.set(anchor.id, powered);
    return powered;
  }

  return normalized.map((anchor) => ({
    ...anchor,
    powered: isPowered(anchor, new Set()),
  }));
}

export function getAnchorPowerState(
  anchor: Anchor,
  elapsedMs: number,
): AnchorPowerState {
  if (isAnchorDirectlyDisrupted(anchor, elapsedMs)) return "disrupted";
  if (!anchor.powered) return "severed";
  return isAnchorProtected(anchor, elapsedMs) ? "shielded" : "powered";
}

export function getAnchorPresence(
  state: GameState,
  anchor: Anchor,
  targets: Record<PlayerId, PlayerConflictTarget | null> = Object.fromEntries(
    PLAYER_IDS.map((playerId) => [
      playerId,
      state.activePlayerIds.includes(playerId)
        ? getPlayerConflictTarget(state, playerId)
        : null,
    ]),
  ) as Record<PlayerId, PlayerConflictTarget | null>,
  activePlayerIds: ReadonlySet<PlayerId> = new Set(state.activePlayerIds),
): AnchorPresence {
  const hostilePlayerIds = [...activePlayerIds].filter(
    (playerId) => playerId !== anchor.owner,
  );
  return {
    attackerNearby: hostilePlayerIds.some((playerId) =>
      targets[playerId]?.kind === "overload" &&
      targets[playerId]?.anchorId === anchor.id),
    hostileNearby: hostilePlayerIds.some((playerId) =>
      distance(state.players[playerId].astronaut.position, anchor.position) <=
        GAME_RULES.anchorInteractionRadius),
    defenderNearby:
      activePlayerIds.has(anchor.owner) &&
      distance(
        state.players[anchor.owner].astronaut.position,
        anchor.position,
      ) <= GAME_RULES.anchorInteractionRadius,
    repairingOwnerNearby: targets[anchor.owner]?.kind === "repair" &&
      targets[anchor.owner]?.anchorId === anchor.id,
  };
}

/** Chooses one deterministic target so a single astronaut cannot affect a cluster. */
export function getPlayerConflictTarget(
  state: GameState,
  playerId: PlayerId,
): PlayerConflictTarget | null {
  const position = state.players[playerId].astronaut.position;
  const powerById = new Map(
    state.anchors.map((anchor) => [anchor.id, anchor.powered]),
  );
  const nearby = (anchor: Anchor) =>
    distance(position, anchor.position) <= GAME_RULES.anchorInteractionRadius;
  const nearest = (anchors: Anchor[]) => anchors
    .map((anchor) => ({ anchor, distance: distance(position, anchor.position) }))
    .sort((a, b) => a.distance - b.distance || a.anchor.id.localeCompare(b.anchor.id))[0]
    ?.anchor;

  const repairTarget = nearest(
    state.anchors.filter(
      (anchor) =>
        anchor.owner === playerId &&
        isAnchorDirectlyDisrupted(anchor, state.elapsedMs) &&
        isParentPowered(anchor, powerById) &&
        nearby(anchor),
    ),
  );
  if (repairTarget) return { kind: "repair", anchorId: repairTarget.id };

  const overloadTarget = nearest(
    state.anchors.filter(
      (anchor) =>
        anchor.owner !== playerId &&
        anchor.powered &&
        !isAnchorProtected(anchor, state.elapsedMs) &&
        nearby(anchor),
    ),
  );
  return overloadTarget
    ? { kind: "overload", anchorId: overloadTarget.id }
    : null;
}

export function isAnchorDirectlyDisrupted(
  anchor: Anchor,
  elapsedMs: number,
) {
  return (
    typeof anchor.disruptedUntilMs === "number" &&
    Number.isFinite(anchor.disruptedUntilMs) &&
    anchor.disruptedUntilMs > elapsedMs
  );
}

export function isAnchorProtected(anchor: Anchor, elapsedMs: number) {
  return (
    typeof anchor.protectedUntilMs === "number" &&
    Number.isFinite(anchor.protectedUntilMs) &&
    anchor.protectedUntilMs > elapsedMs
  );
}

function normalizeAnchor(anchor: Anchor, elapsedMs: number): Anchor {
  const disruptionDeadline =
    typeof anchor.disruptedUntilMs === "number" &&
    Number.isFinite(anchor.disruptedUntilMs)
      ? anchor.disruptedUntilMs
      : null;
  const disruptedUntilMs = disruptionDeadline !== null &&
      disruptionDeadline > elapsedMs
    ? disruptionDeadline
    : null;
  const existingProtection =
    typeof anchor.protectedUntilMs === "number" &&
    Number.isFinite(anchor.protectedUntilMs) &&
    anchor.protectedUntilMs > elapsedMs
      ? anchor.protectedUntilMs
      : null;
  const recoveryProtection = disruptionDeadline !== null &&
      disruptionDeadline <= elapsedMs &&
      disruptionDeadline + GAME_RULES.anchorReactivationShieldMs > elapsedMs
    ? disruptionDeadline + GAME_RULES.anchorReactivationShieldMs
    : null;
  return {
    ...anchor,
    disruptedUntilMs,
    protectedUntilMs: existingProtection ?? recoveryProtection,
    overloadProgress: clamp01(anchor.overloadProgress ?? 0),
    repairProgress: disruptedUntilMs
      ? clamp01(anchor.repairProgress ?? 0)
      : 0,
  };
}

function isParentPowered(
  anchor: Anchor,
  poweredById: ReadonlyMap<string, boolean>,
) {
  if (anchor.parentId === baseId(anchor.owner)) return true;
  return poweredById.get(anchor.parentId) === true;
}

function decay(value: number, rate: number, deltaSeconds: number) {
  return clamp01(value - rate * deltaSeconds);
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
