import { useId, type ReactElement } from "react";
import { GAME_RULES } from "../constants";
import {
  getAnchorPowerState,
  getAnchorPresence,
  getPlayerConflictTarget,
  type AnchorPowerState,
} from "../simulation/tetherConflict";
import { baseId } from "../state";
import { OBJECT_SPRITES } from "../presentation/objectSprites";
import type { Anchor, GameState, PlayerId, Vec2 } from "../types";

interface TetherNetworkLayerProps {
  state: GameState;
  renderPositions: Readonly<Record<PlayerId, Vec2>>;
  localPlayerId: PlayerId;
}

interface NetworkNode {
  id: string;
  position: Vec2;
}

interface ZoneOverlap {
  id: string;
  firstNode: NetworkNode;
  secondNode: NetworkNode;
}

/**
 * Presents tether ownership and conflict without adding a second UI language.
 * Every state is encoded with shape and line texture as well as team colour.
 */
export function TetherNetworkLayer({
  state,
  renderPositions,
  localPlayerId,
}: TetherNetworkLayerProps) {
  return (
    <g className="world__tether-layer">
      <InteractionFilaments state={state} renderPositions={renderPositions} />

      {state.activePlayerIds.map((playerId) => (
        <NetworkNodes key={playerId} state={state} playerId={playerId}
          highlightDelivery={localPlayerId === playerId}
          isLocalBase={localPlayerId === playerId} />
      ))}
    </g>
  );
}

export function TetherCableLayer({
  state,
  localPlayerId,
}: Pick<TetherNetworkLayerProps, "state" | "localPlayerId">) {
  const instanceId = useId().replaceAll(":", "");
  const hatchId = `tether-contested-hatch-${instanceId}`;
  const networkNodes = state.activePlayerIds.map((playerId) =>
    collectPoweredNodes(state, playerId));
  const overlaps = collectZoneOverlaps(networkNodes);

  return (
    <g className="world__tether-layer">
      <defs>
        <pattern
          id={hatchId}
          width="4"
          height="4"
          patternUnits="userSpaceOnUse"
        >
          <path className="world__contested-hatch-line" d="M -1 1 L 3 5 M 1 -1 L 5 3" />
          <path className="world__contested-hatch-line world__contested-hatch-line--cross" d="M -1 3 L 3 -1 M 1 5 L 5 1" />
        </pattern>
        {overlaps.map((overlap) => (
          <clipPath key={overlap.id} id={`${overlap.id}-${instanceId}`}>
            <circle
              cx={overlap.secondNode.position.x}
              cy={overlap.secondNode.position.y}
              r={GAME_RULES.safeZoneRadius}
            />
          </clipPath>
        ))}
      </defs>

      {state.activePlayerIds.map((playerId) => (
        <NetworkZones key={playerId} state={state} playerId={playerId}
          highlightDelivery={localPlayerId === playerId} />
      ))}

      <g className="world__contested-zones" aria-hidden="true">
        {overlaps.map((overlap) => (
          <circle
            key={overlap.id}
            className="world__contested-zone"
            cx={overlap.firstNode.position.x}
            cy={overlap.firstNode.position.y}
            r={GAME_RULES.safeZoneRadius}
            fill={`url(#${hatchId})`}
            clipPath={`url(#${overlap.id}-${instanceId})`}
          />
        ))}
      </g>

      {state.activePlayerIds.map((playerId) => (
        <NetworkConnections key={playerId} state={state} playerId={playerId} />
      ))}
    </g>
  );
}

function NetworkZones({
  state,
  playerId,
  highlightDelivery,
}: {
  state: GameState;
  playerId: PlayerId;
  highlightDelivery: boolean;
}) {
  const player = state.players[playerId];
  const anchors = state.anchors.filter((anchor) => anchor.owner === playerId);

  return (
    <g className={`world__network world__network--${playerId}`} aria-hidden="true">
      <circle
        className={`world__safe-zone world__safe-zone--powered world__safe-zone--base${highlightDelivery && player.astronaut.carriedSalvage > 0 ? " world__safe-zone--delivery-ready" : ""}`}
        cx={player.basePosition.x}
        cy={player.basePosition.y}
        r={GAME_RULES.safeZoneRadius}
      />
      {anchors.map((anchor) => {
        const powerState = getAnchorPowerState(anchor, state.elapsedMs);
        return (
          <circle
            key={anchor.id}
            className={`world__safe-zone world__safe-zone--${powerState}`}
            cx={anchor.position.x}
            cy={anchor.position.y}
            r={GAME_RULES.safeZoneRadius}
          />
        );
      })}
    </g>
  );
}

function NetworkConnections({
  state,
  playerId,
}: {
  state: GameState;
  playerId: PlayerId;
}) {
  const player = state.players[playerId];
  const anchors = state.anchors.filter((anchor) => anchor.owner === playerId);
  const nodes = new Map<string, Vec2>([
    [baseId(playerId), player.basePosition],
    ...anchors.map((anchor) => [anchor.id, anchor.position] as [string, Vec2]),
  ]);

  return (
    <g className={`world__network world__network--${playerId}`} aria-hidden="true">
      {anchors.map((anchor) => {
        const parent = nodes.get(anchor.parentId);
        if (!parent) return null;
        const powerState = getAnchorPowerState(anchor, state.elapsedMs);
        const deltaX = anchor.position.x - parent.x;
        const deltaY = anchor.position.y - parent.y;
        const length = Math.hypot(deltaX, deltaY);
        if (length <= 0.01) return null;
        const midpointX = (parent.x + anchor.position.x) / 2;
        const midpointY = (parent.y + anchor.position.y) / 2;
        const angle = Math.atan2(deltaY, deltaX) * 180 / Math.PI;
        return (
          <image
            key={anchor.id}
            className={`world__cable-sprite world__cable-sprite--${powerState}`}
            href={OBJECT_SPRITES[playerId].tether}
            x={-length / 2}
            y="-3"
            width={length}
            height="6"
            preserveAspectRatio="none"
            transform={`translate(${midpointX} ${midpointY}) rotate(${angle})`}
          />
        );
      })}
    </g>
  );
}

function NetworkNodes({
  state,
  playerId,
  highlightDelivery,
  isLocalBase,
}: {
  state: GameState;
  playerId: PlayerId;
  highlightDelivery: boolean;
  isLocalBase: boolean;
}) {
  const player = state.players[playerId];
  const anchors = state.anchors.filter((anchor) => anchor.owner === playerId);
  const baseVulnerable = state.matchPhase !== "setup" &&
    state.hasDeployedAnchor[playerId] &&
    !anchors.some((anchor) => anchor.powered);
  const collapseProgressMs = state.baseCollapseProgressMs[playerId];

  return (
    <g className={`world__network world__network--${playerId}`}>
      {anchors.map((anchor) => {
        const powerState = getAnchorPowerState(anchor, state.elapsedMs);
        return (
          <AnchorMarker
            key={anchor.id}
            anchor={anchor}
            powerState={powerState}
            hasCargo={highlightDelivery && player.astronaut.carriedSalvage > 0}
          />
        );
      })}
      <g
        className={`world__base${baseVulnerable ? " world__base--vulnerable" : ""}${collapseProgressMs > 0 ? " world__base--collapsing" : ""}`}
        transform={`translate(${player.basePosition.x} ${player.basePosition.y})`}
        role="img"
        aria-label={`${isLocalBase ? "Your" : "Rival"} base${collapseProgressMs > 0 ? ` collapse ${Math.round(collapseProgressMs / GAME_RULES.baseCollapseHoldMs * 100)} percent` : baseVulnerable ? " exposed" : " secure"}`}
      >
        <image
          className="world__base-sprite"
          href={OBJECT_SPRITES[playerId].homeBase}
          x="-9.75"
          y="-9.75"
          width="19.5"
          height="19.5"
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        />
        {baseVulnerable && (
          <BaseCollapseIndicator
            progressMs={collapseProgressMs}
            isLocalBase={isLocalBase}
          />
        )}
      </g>
    </g>
  );
}

function BaseCollapseIndicator({
  progressMs,
  isLocalBase,
}: {
  progressMs: number;
  isLocalBase: boolean;
}) {
  const progress = Math.min(
    1,
    Math.max(0, progressMs / GAME_RULES.baseCollapseHoldMs),
  );

  return (
    <g
      className={`world__base-collapse${progress > 0 ? " world__base-collapse--active" : ""}${isLocalBase ? " world__base-collapse--local" : ""}`}
      aria-hidden="true"
    >
      <circle className="world__base-collapse-zone" r={GAME_RULES.baseCollapseRadius} />
      <circle className="world__base-collapse-track" r={GAME_RULES.baseCollapseRadius + 1.15} />
      {progress > 0 && (
        <>
          <circle
            className="world__base-collapse-progress"
            r={GAME_RULES.baseCollapseRadius + 1.15}
            pathLength="1"
            strokeDasharray={`${progress} 1`}
            transform="rotate(-90)"
          />
          <circle className="world__base-collapse-pulse" r={GAME_RULES.baseCollapseRadius} />
        </>
      )}
    </g>
  );
}

function AnchorMarker({
  anchor,
  powerState,
  hasCargo,
}: {
  anchor: Anchor;
  powerState: AnchorPowerState;
  hasCargo: boolean;
}) {
  const { x, y } = anchor.position;
  const stateDescription = powerState === "powered"
    ? "powered"
    : powerState === "shielded"
      ? "temporarily protected"
    : powerState === "disrupted"
      ? "directly disrupted"
      : "severed from its network";

  return (
    <g
      className={`world__anchor-marker world__anchor-marker--${powerState}`}
      transform={`translate(${x} ${y})`}
      role="img"
      aria-label={`${anchor.owner} tether ${stateDescription}`}
    >
      <title>{`${anchor.owner} tether: ${stateDescription}`}</title>
      <image
        className={`world__break-point-sprite world__break-point-sprite--${powerState}`}
        href={OBJECT_SPRITES[anchor.owner].breakPoint}
        x="-3.8"
        y="-3.8"
        width="7.6"
        height="7.6"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      />
      {(powerState === "powered" || powerState === "shielded") && (
        <>
          <circle
            className="world__anchor-delivery-ring"
            r={GAME_RULES.deliveryRadius}
            aria-hidden="true"
          />
          {hasCargo && (
            <circle
              className="world__anchor-delivery-pulse"
              r="3.2"
              aria-hidden="true"
            />
          )}
          {powerState === "shielded" && (
            <>
              <circle className="world__anchor-shield" r="3.35" />
              <path className="world__anchor-shield-satellite" d="M 0 -3.35 A 3.35 3.35 0 0 1 2.37 -2.37" />
            </>
          )}
        </>
      )}
      {powerState === "disrupted" && (
        <>
          <path className="world__anchor-break" d="M -2.8 -2.8 L -1 -1 L -2.4 .7 M 2.8 2.8 L 1 1 L 2.4 -.7" />
          <circle className="world__anchor-disruption-pulse" r="3.25" />
        </>
      )}
      {powerState === "severed" && (
        <>
          <path className="world__anchor-severed-mark" d="M -2.5 0 H -1 M 1 0 H 2.5" />
        </>
      )}
      <AnchorProgressRing
        kind="overload"
        radius={4.15}
        progress={anchor.overloadProgress}
      />
      <AnchorProgressRing
        kind="repair"
        radius={3.35}
        progress={anchor.repairProgress}
      />
    </g>
  );
}

function AnchorProgressRing({
  kind,
  radius,
  progress,
}: {
  kind: "overload" | "repair";
  radius: number;
  progress: number;
}) {
  if (progress <= 0) return null;
  const clampedProgress = Math.min(1, Math.max(0, progress));

  return (
    <g className={`world__anchor-progress world__anchor-progress--${kind}`} aria-hidden="true">
      <circle className="world__anchor-progress-track" r={radius} />
      <circle
        className="world__anchor-progress-fill"
        r={radius}
        pathLength="1"
        strokeDasharray={`${clampedProgress} 1`}
        transform="rotate(-90)"
      />
    </g>
  );
}

function InteractionFilaments({
  state,
  renderPositions,
}: Pick<TetherNetworkLayerProps, "state" | "renderPositions">) {
  const collapseFilaments = state.activePlayerIds.flatMap((defenderId) => {
    if (state.baseCollapseProgressMs[defenderId] <= 0) return [];
    const attackerId = state.baseCollapseAttacker[defenderId];
    if (!attackerId) return [];
    const defenderBase = state.players[defenderId].basePosition;
    const attackerPosition = state.players[attackerId].astronaut.position;
    if (
      Math.hypot(
        attackerPosition.x - defenderBase.x,
        attackerPosition.y - defenderBase.y,
      ) > GAME_RULES.baseCollapseRadius
    ) {
      return [];
    }
    return [
      <InteractionFilament
        key={`${defenderId}-base-collapse`}
        kind="collapse"
        start={renderPositions[attackerId]}
        end={defenderBase}
      />,
    ];
  });

  return (
    <g className="world__interaction-filaments" aria-hidden="true">
      {state.anchors.flatMap((anchor) => {
        const presence = getAnchorPresence(state, anchor);
        const strands: ReactElement[] = [];

        if (anchor.overloadProgress > 0 && presence.attackerNearby) {
          const attackers = state.activePlayerIds.filter((playerId) => {
            const target = getPlayerConflictTarget(state, playerId);
            return target?.kind === "overload" && target.anchorId === anchor.id;
          });
          strands.push(...attackers.map((attackerId) =>
            <InteractionFilament
              key={`${anchor.id}-${attackerId}-overload`}
              kind="overload"
              start={renderPositions[attackerId]}
              end={anchor.position}
            />,
          ));
        }
        if (
          anchor.repairProgress > 0 &&
          presence.repairingOwnerNearby &&
          !presence.hostileNearby
        ) {
          strands.push(
            <InteractionFilament
              key={`${anchor.id}-repair`}
              kind="repair"
              start={renderPositions[anchor.owner]}
              end={anchor.position}
            />,
          );
        }
        return strands;
      })}
      {collapseFilaments}
    </g>
  );
}

function InteractionFilament({
  kind,
  start,
  end,
}: {
  kind: "overload" | "repair" | "collapse";
  start: Vec2;
  end: Vec2;
}) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const bend = Math.min(1.1, length * 0.16);
  const control = {
    x: (start.x + end.x) / 2 - dy / length * bend,
    y: (start.y + end.y) / 2 + dx / length * bend,
  };
  const path = `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`;

  return (
    <g className={`world__interaction-filament world__interaction-filament--${kind}`}>
      <path className="world__interaction-filament-glow" d={path} />
      <path className="world__interaction-filament-core" d={path} />
      <circle className="world__interaction-endpoint" cx={end.x} cy={end.y} r=".65" />
    </g>
  );
}

function collectPoweredNodes(
  state: GameState,
  playerId: PlayerId,
): NetworkNode[] {
  return [
    {
      id: baseId(playerId),
      position: state.players[playerId].basePosition,
    },
    ...state.anchors
      .filter((anchor) => anchor.owner === playerId && anchor.powered)
      .map((anchor) => ({ id: anchor.id, position: anchor.position })),
  ];
}

function collectZoneOverlaps(networks: readonly (readonly NetworkNode[])[]): ZoneOverlap[] {
  const diameter = GAME_RULES.safeZoneRadius * 2;
  const overlaps: ZoneOverlap[] = [];

  for (let first = 0; first < networks.length; first += 1) {
    for (let second = first + 1; second < networks.length; second += 1) {
      for (const firstNode of networks[first]) {
        for (const secondNode of networks[second]) {
      const distance = Math.hypot(
        secondNode.position.x - firstNode.position.x,
        secondNode.position.y - firstNode.position.y,
      );
      if (distance >= diameter) continue;
      overlaps.push({
        id: `tether-overlap-${overlaps.length}`,
        firstNode,
        secondNode,
      });
        }
      }
    }
  }

  return overlaps;
}
