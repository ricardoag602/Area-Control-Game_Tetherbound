import { GAME_RULES } from "../constants";
import { baseId } from "../state";
import type { GameState, PlayerId, Vec2 } from "../types";

export type InteractionState = Pick<
  GameState,
  "elapsedMs" | "activePlayerIds" | "anchors" | "salvage" | "players"
>;

export interface AnchorInteractionSnapshot {
  readonly id: string;
  readonly owner: PlayerId;
  readonly position: Vec2;
  readonly parentId: string;
  readonly powered: boolean;
  readonly directlyDisrupted: boolean;
}

interface SalvageSnapshot {
  readonly id: string;
  readonly position: Vec2;
  readonly collected: boolean;
}

interface PlayerSnapshot {
  readonly playerId: PlayerId;
  readonly basePosition: Vec2;
  readonly astronautPosition: Vec2;
  readonly carriedSalvage: number;
  readonly bankedSalvage: number;
  readonly tetherKits: number;
  readonly respawns: number;
}

export interface ThreeInteractionSnapshot {
  readonly elapsedMs: number;
  readonly activePlayerIds: readonly PlayerId[];
  readonly anchors: ReadonlyMap<string, AnchorInteractionSnapshot>;
  readonly salvage: ReadonlyMap<string, SalvageSnapshot>;
  readonly players: ReadonlyMap<PlayerId, PlayerSnapshot>;
}

export type ThreeInteractionEvent =
  | {
    readonly kind: "anchor_deployed";
    readonly id: string;
    readonly playerId: PlayerId;
    readonly position: Vec2;
    readonly parentPosition: Vec2;
  }
  | {
    readonly kind: "anchor_broken";
    readonly id: string;
    readonly playerId: PlayerId;
    readonly position: Vec2;
  }
  | {
    readonly kind: "salvage_picked_up";
    readonly id: string;
    readonly position: Vec2;
  }
  | {
    readonly kind: "salvage_deposited";
    readonly playerId: PlayerId;
    readonly position: Vec2;
    readonly amount: number;
    readonly fabricatedKits: number;
    readonly nodeId: string;
  };

export interface ThreeInteractionEventResult {
  readonly events: readonly ThreeInteractionEvent[];
  readonly snapshot: ThreeInteractionSnapshot;
}

export function createThreeInteractionSnapshot(
  state: InteractionState,
): ThreeInteractionSnapshot {
  return {
    elapsedMs: finiteOr(state.elapsedMs, 0),
    activePlayerIds: [...state.activePlayerIds],
    anchors: new Map(state.anchors.map((anchor) => [anchor.id, {
      id: anchor.id,
      owner: anchor.owner,
      position: copyPosition(anchor.position),
      parentId: anchor.parentId,
      powered: anchor.powered,
      directlyDisrupted:
        typeof anchor.disruptedUntilMs === "number"
        && Number.isFinite(anchor.disruptedUntilMs)
        && anchor.disruptedUntilMs > state.elapsedMs,
    }])),
    salvage: new Map(state.salvage.map((deposit) => [deposit.id, {
      id: deposit.id,
      position: copyPosition(deposit.position),
      collected: deposit.collected,
    }])),
    players: new Map(state.activePlayerIds.map((playerId) => {
      const player = state.players[playerId];
      const astronaut = player.astronaut;
      return [playerId, {
        playerId,
        basePosition: copyPosition(player.basePosition),
        astronautPosition: copyPosition(astronaut.position),
        carriedSalvage: finiteOr(astronaut.carriedSalvage, 0),
        bankedSalvage: finiteOr(astronaut.bankedSalvage, 0),
        tetherKits: finiteOr(astronaut.tetherKits, 0),
        respawns: finiteOr(astronaut.respawns, 0),
      }];
    })),
  };
}

export function collectThreeInteractionEvents(
  previous: ThreeInteractionSnapshot | null,
  state: InteractionState,
): ThreeInteractionEventResult {
  const snapshot = createThreeInteractionSnapshot(state);
  if (
    !previous
    || snapshot.elapsedMs < previous.elapsedMs
    || !sameRoster(previous.activePlayerIds, snapshot.activePlayerIds)
  ) {
    return { events: [], snapshot };
  }

  const events: ThreeInteractionEvent[] = [];
  const addedAnchorsByPlayer = new Map<PlayerId, number>();
  for (const anchor of snapshot.anchors.values()) {
    const earlier = previous.anchors.get(anchor.id);
    if (!earlier) {
      addedAnchorsByPlayer.set(
        anchor.owner,
        (addedAnchorsByPlayer.get(anchor.owner) ?? 0) + 1,
      );
      const parent = snapshot.anchors.get(anchor.parentId);
      const player = snapshot.players.get(anchor.owner);
      const parentPosition = parent?.position ?? player?.basePosition;
      if (parentPosition) {
        events.push({
          kind: "anchor_deployed",
          id: anchor.id,
          playerId: anchor.owner,
          position: copyPosition(anchor.position),
          parentPosition: copyPosition(parentPosition),
        });
      }
      continue;
    }
    if (!earlier.directlyDisrupted && anchor.directlyDisrupted) {
      events.push({
        kind: "anchor_broken",
        id: anchor.id,
        playerId: anchor.owner,
        position: copyPosition(anchor.position),
      });
    }
  }

  for (const deposit of snapshot.salvage.values()) {
    const earlier = previous.salvage.get(deposit.id);
    if (earlier && !earlier.collected && deposit.collected) {
      events.push({
        kind: "salvage_picked_up",
        id: deposit.id,
        position: copyPosition(deposit.position),
      });
    }
  }

  for (const playerId of snapshot.activePlayerIds) {
    const earlier = previous.players.get(playerId);
    const current = snapshot.players.get(playerId);
    if (!earlier || !current || current.respawns > earlier.respawns) continue;

    const previousStored = earlier.bankedSalvage
      + earlier.tetherKits * GAME_RULES.salvagePerTether;
    const currentStored = current.bankedSalvage
      + current.tetherKits * GAME_RULES.salvagePerTether;
    const deployedResourceValue = (addedAnchorsByPlayer.get(playerId) ?? 0)
      * GAME_RULES.salvagePerTether;
    const depositedAmount = Math.round(
      currentStored - previousStored + deployedResourceValue,
    );
    if (depositedAmount <= 0) continue;

    const deliveryNode = findDeliveryNode(
      state,
      previous,
      playerId,
      earlier.astronautPosition,
      current.astronautPosition,
    );
    if (!deliveryNode) continue;
    events.push({
      kind: "salvage_deposited",
      playerId,
      position: copyPosition(deliveryNode.position),
      amount: depositedAmount,
      fabricatedKits: Math.max(
        0,
        current.tetherKits
          - earlier.tetherKits
          + (addedAnchorsByPlayer.get(playerId) ?? 0),
      ),
      nodeId: deliveryNode.id,
    });
  }

  return { events, snapshot };
}

function findDeliveryNode(
  state: Pick<GameState, "players" | "anchors">,
  previous: ThreeInteractionSnapshot,
  playerId: PlayerId,
  previousPosition: Vec2,
  currentPosition: Vec2,
): { id: string; position: Vec2 } | null {
  const basePosition = state.players[playerId].basePosition;
  if (distance(basePosition, currentPosition) <= GAME_RULES.safeZoneRadius) {
    return { id: baseId(playerId), position: basePosition };
  }
  const nearest = state.anchors
    .filter((anchor) => (
      anchor.owner === playerId
      && anchor.powered
      && distance(anchor.position, currentPosition) <= GAME_RULES.deliveryRadius
    ))
    .map((anchor) => ({
      id: anchor.id,
      position: anchor.position,
      distance: distance(anchor.position, currentPosition),
    }))
    .sort((left, right) => left.distance - right.distance || left.id.localeCompare(right.id))[0];
  if (nearest) return { id: nearest.id, position: nearest.position };

  // A server update can contain several simulation ticks. The astronaut may
  // have crossed a delivery node and already moved beyond it by the final
  // snapshot, so retain the cue when the observed travel segment intersects
  // a valid node.
  const crossedNodes: Array<{
    id: string;
    position: Vec2;
    distance: number;
    progress: number;
  }> = [];
  const baseCrossing = distanceToSegment(
    basePosition,
    previousPosition,
    currentPosition,
  );
  if (baseCrossing.distance <= GAME_RULES.safeZoneRadius) {
    crossedNodes.push({
      id: baseId(playerId),
      position: basePosition,
      ...baseCrossing,
    });
  }
  for (const anchor of state.anchors) {
    const earlier = previous.anchors.get(anchor.id);
    if (
      anchor.owner !== playerId
      || (!anchor.powered && !earlier?.powered)
    ) continue;
    const crossing = distanceToSegment(
      anchor.position,
      previousPosition,
      currentPosition,
    );
    if (crossing.distance > GAME_RULES.deliveryRadius) continue;
    crossedNodes.push({
      id: anchor.id,
      position: anchor.position,
      ...crossing,
    });
  }
  const crossed = crossedNodes.sort((left, right) => (
    left.progress - right.progress
    || left.distance - right.distance
    || left.id.localeCompare(right.id)
  ))[0];
  return crossed ? { id: crossed.id, position: crossed.position } : null;
}

export function getPlayerMaterialEquivalent(
  snapshot: ThreeInteractionSnapshot,
  playerId: PlayerId,
) {
  const player = snapshot.players.get(playerId);
  if (!player) return 0;
  let ownedAnchors = 0;
  for (const anchor of snapshot.anchors.values()) {
    if (anchor.owner === playerId) ownedAnchors += 1;
  }
  return player.carriedSalvage
    + player.bankedSalvage
    + (player.tetherKits + ownedAnchors) * GAME_RULES.salvagePerTether;
}

function sameRoster(left: readonly PlayerId[], right: readonly PlayerId[]) {
  return left.length === right.length
    && left.every((playerId, index) => playerId === right[index]);
}

function copyPosition(position: Vec2): Vec2 {
  return {
    x: finiteOr(position.x, 0),
    y: finiteOr(position.y, 0),
  };
}

function distance(left: Vec2, right: Vec2) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function distanceToSegment(point: Vec2, start: Vec2, end: Vec2) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  const progress = lengthSquared <= 0.000001
    ? 0
    : Math.min(1, Math.max(0, (
      (point.x - start.x) * deltaX + (point.y - start.y) * deltaY
    ) / lengthSquared));
  return {
    distance: Math.hypot(
      point.x - (start.x + deltaX * progress),
      point.y - (start.y + deltaY * progress),
    ),
    progress,
  };
}

function finiteOr(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}
