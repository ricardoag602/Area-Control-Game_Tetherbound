import { useId, type ReactElement } from "react";
import { GAME_RULES } from "../constants";
import {
  getAnchorPowerState,
  getAnchorPresence,
  type AnchorPowerState,
} from "../simulation/tetherConflict";
import { baseId } from "../state";
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
  playerNode: NetworkNode;
  rivalNode: NetworkNode;
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
  const instanceId = useId().replaceAll(":", "");
  const hatchId = `tether-contested-hatch-${instanceId}`;
  const playerNodes = collectPoweredNodes(state, "player");
  const rivalNodes = collectPoweredNodes(state, "rival");
  const overlaps = collectZoneOverlaps(playerNodes, rivalNodes);

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
              cx={overlap.rivalNode.position.x}
              cy={overlap.rivalNode.position.y}
              r={GAME_RULES.safeZoneRadius}
            />
          </clipPath>
        ))}
      </defs>

      <NetworkZones state={state} playerId="rival" highlightDelivery={localPlayerId === "rival"} />
      <NetworkZones state={state} playerId="player" highlightDelivery={localPlayerId === "player"} />

      <g className="world__contested-zones" aria-hidden="true">
        {overlaps.map((overlap) => (
          <circle
            key={overlap.id}
            className="world__contested-zone"
            cx={overlap.playerNode.position.x}
            cy={overlap.playerNode.position.y}
            r={GAME_RULES.safeZoneRadius}
            fill={`url(#${hatchId})`}
            clipPath={`url(#${overlap.id}-${instanceId})`}
          />
        ))}
      </g>

      <NetworkConnections state={state} playerId="rival" />
      <NetworkConnections state={state} playerId="player" />

      <InteractionFilaments state={state} renderPositions={renderPositions} />

      <NetworkNodes state={state} playerId="rival" highlightDelivery={localPlayerId === "rival"} />
      <NetworkNodes state={state} playerId="player" highlightDelivery={localPlayerId === "player"} />
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
        return (
          <line
            key={anchor.id}
            className={`world__cable world__cable--${powerState}`}
            x1={parent.x}
            y1={parent.y}
            x2={anchor.position.x}
            y2={anchor.position.y}
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
}: {
  state: GameState;
  playerId: PlayerId;
  highlightDelivery: boolean;
}) {
  const player = state.players[playerId];
  const anchors = state.anchors.filter((anchor) => anchor.owner === playerId);

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
        className="world__base"
        transform={`translate(${player.basePosition.x} ${player.basePosition.y})`}
        aria-hidden="true"
      >
        <circle className="world__base-ring" r="5" />
        <path className="world__base-spokes" d="M -3 0 H 3 M 0 -3 V 3" />
        <circle className="world__base-core" r="2.5" />
      </g>
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
      {(powerState === "powered" || powerState === "shielded") && (
        <>
          <circle
            className={`world__anchor-delivery-ring${hasCargo ? " world__anchor-delivery-ring--active" : ""}`}
            r={GAME_RULES.deliveryRadius}
            aria-hidden="true"
          />
          <circle className="world__anchor world__anchor--powered" r="2.2" />
          <circle className="world__anchor-core" r=".8" />
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
          <circle className="world__anchor world__anchor--disrupted" r="2.45" />
          <path className="world__anchor-break" d="M -2.8 -2.8 L -1 -1 L -2.4 .7 M 2.8 2.8 L 1 1 L 2.4 -.7" />
          <circle className="world__anchor-disruption-pulse" r="3.25" />
        </>
      )}
      {powerState === "severed" && (
        <>
          <rect
            className="world__anchor world__anchor--severed"
            x="-1.8"
            y="-1.8"
            width="3.6"
            height="3.6"
            transform="rotate(45)"
          />
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
  return (
    <g className="world__interaction-filaments" aria-hidden="true">
      {state.anchors.flatMap((anchor) => {
        const presence = getAnchorPresence(state, anchor);
        const attackerId: PlayerId = anchor.owner === "player" ? "rival" : "player";
        const strands: ReactElement[] = [];

        if (anchor.overloadProgress > 0 && presence.attackerNearby) {
          strands.push(
            <InteractionFilament
              key={`${anchor.id}-overload`}
              kind="overload"
              start={renderPositions[attackerId]}
              end={anchor.position}
            />,
          );
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
    </g>
  );
}

function InteractionFilament({
  kind,
  start,
  end,
}: {
  kind: "overload" | "repair";
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

function collectZoneOverlaps(
  playerNodes: readonly NetworkNode[],
  rivalNodes: readonly NetworkNode[],
): ZoneOverlap[] {
  const diameter = GAME_RULES.safeZoneRadius * 2;
  const overlaps: ZoneOverlap[] = [];

  for (const playerNode of playerNodes) {
    for (const rivalNode of rivalNodes) {
      const distance = Math.hypot(
        rivalNode.position.x - playerNode.position.x,
        rivalNode.position.y - playerNode.position.y,
      );
      if (distance >= diameter) continue;
      overlaps.push({
        id: `tether-overlap-${overlaps.length}`,
        playerNode,
        rivalNode,
      });
    }
  }

  return overlaps;
}
