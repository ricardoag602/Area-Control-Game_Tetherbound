import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type ReactElement,
  type RefObject,
} from "react";
import { GAME_RULES } from "../constants";
import {
  PRESENTATION_FRAME_PRIORITY,
  subscribePresentationFrame,
} from "../presentation/presentationClock";
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
  renderPositionsRef: RefObject<Readonly<Record<PlayerId, Vec2>>>;
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
  renderPositionsRef,
  localPlayerId,
}: TetherNetworkLayerProps) {
  return (
    <g className="world__tether-layer">
      <InteractionFilaments
        state={state}
        renderPositions={renderPositions}
        renderPositionsRef={renderPositionsRef}
      />
      <NetworkNodeLayer state={state} localPlayerId={localPlayerId} />
    </g>
  );
}

const NetworkNodeLayer = memo(function NetworkNodeLayer({
  state,
  localPlayerId,
}: Pick<TetherNetworkLayerProps, "state" | "localPlayerId">) {
  return state.activePlayerIds.map((playerId) => (
    <NetworkNodes key={playerId} state={state} playerId={playerId}
      highlightDelivery={localPlayerId === playerId}
      isLocalBase={localPlayerId === playerId} />
  ));
}, sameStaticNetworkProps);

export const TetherCableLayer = memo(function TetherCableLayer({
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
}, sameStaticNetworkProps);

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
  renderPositionsRef,
}: Pick<
  TetherNetworkLayerProps,
  "state" | "renderPositions" | "renderPositionsRef"
>) {
  const hasActiveInteraction = state.activePlayerIds.some(
    (playerId) => state.baseCollapseProgressMs[playerId] > 0,
  ) || state.anchors.some(
    (anchor) => anchor.overloadProgress > 0 || anchor.repairProgress > 0,
  );
  if (!hasActiveInteraction) return null;

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
        startPlayerId={attackerId}
        fallbackStart={renderPositions[attackerId]}
        end={defenderBase}
        renderPositionsRef={renderPositionsRef}
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
              startPlayerId={attackerId}
              fallbackStart={renderPositions[attackerId]}
              end={anchor.position}
              renderPositionsRef={renderPositionsRef}
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
              startPlayerId={anchor.owner}
              fallbackStart={renderPositions[anchor.owner]}
              end={anchor.position}
              renderPositionsRef={renderPositionsRef}
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
  startPlayerId,
  fallbackStart,
  end,
  renderPositionsRef,
}: {
  kind: "overload" | "repair" | "collapse";
  startPlayerId: PlayerId;
  fallbackStart: Vec2;
  end: Vec2;
  renderPositionsRef: RefObject<Readonly<Record<PlayerId, Vec2>>>;
}) {
  const glowRef = useRef<SVGPathElement>(null);
  const coreRef = useRef<SVGPathElement>(null);
  const endX = end.x;
  const endY = end.y;
  const path = getInteractionFilamentPath(fallbackStart, end);
  const syncPath = useCallback(() => {
    const start = renderPositionsRef.current[startPlayerId];
    const livePath = interactionFilamentPathFromCoordinates(
      start.x,
      start.y,
      endX,
      endY,
    );
    if (glowRef.current?.getAttribute("d") !== livePath) {
      glowRef.current?.setAttribute("d", livePath);
    }
    if (coreRef.current?.getAttribute("d") !== livePath) {
      coreRef.current?.setAttribute("d", livePath);
    }
  }, [
    endX,
    endY,
    renderPositionsRef,
    startPlayerId,
  ]);

  // React can replace the declarative path on an authoritative snapshot.
  // Restore the current frame-cadence endpoint before that snapshot paints.
  useLayoutEffect(syncPath, [syncPath]);
  useEffect(() => subscribePresentationFrame(
    syncPath,
    PRESENTATION_FRAME_PRIORITY.scene,
  ), [syncPath]);

  return (
    <g className={`world__interaction-filament world__interaction-filament--${kind}`}>
      <path ref={glowRef} className="world__interaction-filament-glow" d={path} />
      <path ref={coreRef} className="world__interaction-filament-core" d={path} />
      <circle className="world__interaction-endpoint" cx={end.x} cy={end.y} r=".65" />
    </g>
  );
}

export function getInteractionFilamentPath(start: Vec2, end: Vec2) {
  return interactionFilamentPathFromCoordinates(start.x, start.y, end.x, end.y);
}

function interactionFilamentPathFromCoordinates(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
) {
  const dx = endX - startX;
  const dy = endY - startY;
  const length = Math.hypot(dx, dy) || 1;
  const bend = Math.min(1.1, length * 0.16);
  const controlX = (startX + endX) / 2 - dy / length * bend;
  const controlY = (startY + endY) / 2 + dx / length * bend;
  return `M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}`;
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

export function sameStaticNetworkProps(
  previous: Pick<TetherNetworkLayerProps, "state" | "localPlayerId">,
  next: Pick<TetherNetworkLayerProps, "state" | "localPlayerId">,
) {
  if (previous.localPlayerId !== next.localPlayerId) return false;
  if (previous.state === next.state) return true;
  const previousState = previous.state;
  const nextState = next.state;
  if (
    previousState.matchPhase !== nextState.matchPhase ||
    previousState.anchors.length !== nextState.anchors.length ||
    previousState.activePlayerIds.length !== nextState.activePlayerIds.length
  ) return false;

  for (let index = 0; index < previousState.anchors.length; index += 1) {
    const previousAnchor = previousState.anchors[index];
    const nextAnchor = nextState.anchors[index];
    if (
      previousAnchor.id !== nextAnchor.id ||
      previousAnchor.owner !== nextAnchor.owner ||
      previousAnchor.position.x !== nextAnchor.position.x ||
      previousAnchor.position.y !== nextAnchor.position.y ||
      previousAnchor.parentId !== nextAnchor.parentId ||
      previousAnchor.powered !== nextAnchor.powered ||
      previousAnchor.disruptedUntilMs !== nextAnchor.disruptedUntilMs ||
      previousAnchor.protectedUntilMs !== nextAnchor.protectedUntilMs ||
      previousAnchor.overloadProgress !== nextAnchor.overloadProgress ||
      previousAnchor.repairProgress !== nextAnchor.repairProgress ||
      getAnchorPowerState(previousAnchor, previousState.elapsedMs) !==
        getAnchorPowerState(nextAnchor, nextState.elapsedMs)
    ) return false;
  }

  for (let index = 0; index < previousState.activePlayerIds.length; index += 1) {
    const playerId = previousState.activePlayerIds[index];
    if (playerId !== nextState.activePlayerIds[index]) return false;
    const previousPlayer = previousState.players[playerId];
    const nextPlayer = nextState.players[playerId];
    if (
      previousPlayer.basePosition.x !== nextPlayer.basePosition.x ||
      previousPlayer.basePosition.y !== nextPlayer.basePosition.y ||
      previousPlayer.astronaut.carriedSalvage !== nextPlayer.astronaut.carriedSalvage ||
      previousState.hasDeployedAnchor[playerId] !== nextState.hasDeployedAnchor[playerId] ||
      previousState.baseCollapseProgressMs[playerId] !== nextState.baseCollapseProgressMs[playerId] ||
      previousState.baseCollapseAttacker[playerId] !== nextState.baseCollapseAttacker[playerId]
    ) return false;
  }

  return true;
}
