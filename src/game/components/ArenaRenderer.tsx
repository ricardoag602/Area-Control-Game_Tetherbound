import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { GAME_RULES, WORLD } from "../constants";
import { MOVEMENT_RULES } from "../movement";
import { baseId } from "../state";
import { useKeyboardMovement } from "../input/useKeyboardMovement";
import type {
  AstronautState,
  GameState,
  MovementCommand,
  PlayerId,
  Vec2,
} from "../types";
import { useSmoothedPositions } from "./useSmoothedPositions";

interface ArenaRendererProps {
  state: GameState;
  localPlayerId: PlayerId;
  onMovementCommand: (command: MovementCommand) => void;
  disabled?: boolean;
  interpolatePositions?: boolean;
}

type GestureMode = "walking" | "charge-candidate" | "charging";

interface ActiveGesture {
  element: SVGSVGElement;
  pointerId: number;
  mode: GestureMode;
  originClient: Vec2;
  latestClient: Vec2;
}

export function ArenaRenderer({
  state,
  localPlayerId,
  onMovementCommand,
  disabled = false,
  interpolatePositions = false,
}: ArenaRendererProps) {
  const renderPositions = useSmoothedPositions(state, interpolatePositions);
  const localAstronaut = state.players[localPlayerId].astronaut;
  const arenaRef = useRef<SVGSVGElement>(null);
  const commandRef = useRef(onMovementCommand);
  const gestureRef = useRef<ActiveGesture | null>(null);
  const chargeTimerRef = useRef<number | null>(null);
  const [gestureAim, setGestureAim] = useState<Vec2 | null>(null);
  commandRef.current = onMovementCommand;

  const clearChargeTimer = useCallback(() => {
    if (chargeTimerRef.current !== null) window.clearTimeout(chargeTimerRef.current);
    chargeTimerRef.current = null;
  }, []);

  const cancelGesture = useCallback(() => {
    const gesture = gestureRef.current;
    if (!gesture) return;

    gestureRef.current = null;
    clearChargeTimer();
    setGestureAim(null);
    if (gesture.element.hasPointerCapture(gesture.pointerId)) {
      gesture.element.releasePointerCapture(gesture.pointerId);
    }
    commandRef.current({ type: "stop" });
  }, [clearChargeTimer]);

  const { clearKeyboardMovement } = useKeyboardMovement({
    disabled,
    movementMode: localAstronaut.movement.mode,
    onMovementCommand,
    onKeyboardTakeover: cancelGesture,
    targetRef: arenaRef,
  });

  useEffect(() => {
    if (document.activeElement === document.body) {
      arenaRef.current?.focus({ preventScroll: true });
    }
  }, []);

  useEffect(() => {
    if (disabled) cancelGesture();
  }, [cancelGesture, disabled]);

  useEffect(() => {
    const cancelOnBlur = () => cancelGesture();
    const cancelWhenHidden = () => {
      if (document.visibilityState === "hidden") cancelGesture();
    };
    window.addEventListener("blur", cancelOnBlur);
    document.addEventListener("visibilitychange", cancelWhenHidden);
    return () => {
      window.removeEventListener("blur", cancelOnBlur);
      document.removeEventListener("visibilitychange", cancelWhenHidden);
      cancelGesture();
    };
  }, [cancelGesture]);

  function beginGesture(event: PointerEvent<SVGSVGElement>) {
    if (
      disabled ||
      gestureRef.current ||
      !event.isPrimary ||
      (event.pointerType === "mouse" && event.button !== 0)
    ) return;

    clearKeyboardMovement(false);
    event.preventDefault();
    const element = event.currentTarget;
    element.focus({ preventScroll: true });
    const target = clientToWorld(element, event.clientX, event.clientY);
    const clientPoint = { x: event.clientX, y: event.clientY };
    const localPosition = renderPositions[localPlayerId];
    const astronautClient = worldToClient(element, localPosition);
    const hitRadius = element.closest(".app--large-controls")
      ? MOVEMENT_RULES.largeControlHitRadiusPx
      : MOVEMENT_RULES.astronautHitRadiusPx;
    const beginsOnAstronaut = astronautClient !== null &&
      pointDistance(clientPoint, astronautClient) <= hitRadius;

    element.setPointerCapture(event.pointerId);
    gestureRef.current = {
      element,
      pointerId: event.pointerId,
      mode: beginsOnAstronaut ? "charge-candidate" : "walking",
      originClient: clientPoint,
      latestClient: clientPoint,
    };

    if (!beginsOnAstronaut) {
      commandRef.current({ type: "walk", target });
      return;
    }

    commandRef.current({ type: "stop" });
    chargeTimerRef.current = window.setTimeout(() => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.mode !== "charge-candidate") return;
      gesture.mode = "charging";
      const target = relativeChargeTarget(
        gesture,
        localAstronaut,
      );
      setGestureAim(target);
      commandRef.current({ type: "charge", target });
    }, MOVEMENT_RULES.gestureArmMs);
  }

  function continueGesture(event: PointerEvent<SVGSVGElement>) {
    const gesture = gestureRef.current;
    if (disabled || !gesture || gesture.pointerId !== event.pointerId) return;

    event.preventDefault();
    const clientPoint = { x: event.clientX, y: event.clientY };
    const target = clientToWorld(gesture.element, event.clientX, event.clientY);
    gesture.latestClient = clientPoint;

    if (gesture.mode === "charge-candidate") {
      if (pointDistance(clientPoint, gesture.originClient) <= MOVEMENT_RULES.gestureSlopPx) return;
      clearChargeTimer();
      gesture.mode = "walking";
      commandRef.current({ type: "walk", target });
      return;
    }

    if (gesture.mode === "charging") {
      const chargeTarget = relativeChargeTarget(
        gesture,
        localAstronaut,
      );
      setGestureAim(chargeTarget);
      commandRef.current({ type: "charge", target: chargeTarget });
      return;
    }

    commandRef.current({ type: "walk", target });
  }

  function finishGesture(event: PointerEvent<SVGSVGElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (disabled) {
      cancelGesture();
      return;
    }

    event.preventDefault();
    gesture.latestClient = { x: event.clientX, y: event.clientY };
    const hasDashAim = pointDistance(
      { x: event.clientX, y: event.clientY },
      gesture.originClient,
    ) >= MOVEMENT_RULES.aimDeadZonePx;
    const shouldRelease = gesture.mode === "charging" && hasDashAim;
    const releaseTarget = relativeChargeTarget(
      gesture,
      localAstronaut,
    );

    gestureRef.current = null;
    clearChargeTimer();
    setGestureAim(null);
    if (gesture.element.hasPointerCapture(gesture.pointerId)) {
      gesture.element.releasePointerCapture(gesture.pointerId);
    }
    commandRef.current(
      shouldRelease ? { type: "release", target: releaseTarget } : { type: "stop" },
    );
  }

  function losePointerCapture(event: PointerEvent<SVGSVGElement>) {
    if (gestureRef.current?.pointerId === event.pointerId) cancelGesture();
  }

  function cancelPointer(event: PointerEvent<SVGSVGElement>) {
    if (gestureRef.current?.pointerId === event.pointerId) cancelGesture();
  }

  return (
    <svg
      ref={arenaRef}
      className="world"
      viewBox={`0 0 ${WORLD.width} ${WORLD.height}`}
      role="application"
      tabIndex={0}
      aria-roledescription="game arena"
      aria-label="Tetherbound game arena. Use W A S D or the arrow keys to move. Tap a movement key, then press and hold that same key to charge; release it to burst. Press Escape to cancel keyboard movement or Tab to leave the arena controls. Drag to move with a pointer. Hold the astronaut, drag to aim, and release to burst."
      aria-keyshortcuts="W A S D ArrowUp ArrowDown ArrowLeft ArrowRight"
      aria-disabled={disabled}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={beginGesture}
      onPointerMove={continueGesture}
      onPointerUp={finishGesture}
      onPointerCancel={cancelPointer}
      onLostPointerCapture={losePointerCapture}
    >
      <defs>
        <pattern id="world-grid" width="5" height="5" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.22" fill="#76909b" opacity=".22" />
        </pattern>
      </defs>
      <rect width="100" height="160" fill="#111b22" />
      <rect width="100" height="160" fill="url(#world-grid)" />

      <Network state={state} playerId="rival" />
      <Network state={state} playerId="player" />

      {state.salvage.filter((deposit) => !deposit.collected).map((deposit) => (
        <rect
          key={deposit.id}
          className="world__salvage"
          x={deposit.position.x - 1.7}
          y={deposit.position.y - 1.7}
          width="3.4"
          height="3.4"
          rx=".4"
          transform={`rotate(45 ${deposit.position.x} ${deposit.position.y})`}
        />
      ))}

      <ChargeFeedback
        astronaut={localAstronaut}
        position={renderPositions[localPlayerId]}
        playerId={localPlayerId}
        gestureAim={gestureAim}
      />

      <Astronaut
        astronaut={state.players.rival.astronaut}
        position={renderPositions.rival}
        playerId="rival"
      />
      <Astronaut
        astronaut={state.players.player.astronaut}
        position={renderPositions.player}
        playerId="player"
      />
    </svg>
  );
}

function Network({ state, playerId }: { state: GameState; playerId: PlayerId }) {
  const player = state.players[playerId];
  const anchors = state.anchors.filter((anchor) => anchor.owner === playerId && anchor.powered);
  // The lookup lets each anchor draw a cable to its stored parent node by id.
  const nodes = new Map<string, Vec2>([
    [baseId(playerId), player.basePosition],
    ...anchors.map((anchor) => [anchor.id, anchor.position] as [string, Vec2]),
  ]);

  return (
    <g className={`world__network world__network--${playerId}`}>
      <circle
        className="world__safe-zone"
        cx={player.basePosition.x}
        cy={player.basePosition.y}
        r={GAME_RULES.safeZoneRadius}
      />
      {anchors.map((anchor) => {
        const parent = nodes.get(anchor.parentId);
        return (
          <g key={anchor.id}>
            {parent && (
              <line
                className="world__cable"
                x1={parent.x}
                y1={parent.y}
                x2={anchor.position.x}
                y2={anchor.position.y}
              />
            )}
            <circle
              className="world__safe-zone"
              cx={anchor.position.x}
              cy={anchor.position.y}
              r={GAME_RULES.safeZoneRadius}
            />
            <circle className="world__anchor" cx={anchor.position.x} cy={anchor.position.y} r="2" />
          </g>
        );
      })}
      <circle className="world__base-ring" cx={player.basePosition.x} cy={player.basePosition.y} r="5" />
      <circle className="world__base-core" cx={player.basePosition.x} cy={player.basePosition.y} r="2.5" />
    </g>
  );
}

function ChargeFeedback({
  astronaut,
  position,
  playerId,
  gestureAim,
}: {
  astronaut: AstronautState;
  position: Vec2;
  playerId: PlayerId;
  gestureAim: Vec2 | null;
}) {
  const movement = astronaut.movement;
  const charging = movement.mode === "charging" || gestureAim !== null;
  if (!charging) return null;

  const progress = Math.min(1, movement.chargeSeconds / MOVEMENT_RULES.fullChargeSeconds);
  const target = gestureAim ?? movement.target ?? (
    movement.mode === "charging"
      ? {
          x: position.x + movement.direction.x * MOVEMENT_RULES.aimVectorDistance,
          y: position.y + movement.direction.y * MOVEMENT_RULES.aimVectorDistance,
        }
      : null
  );
  const hasAim = target !== null && pointDistance(target, position) > 0.1;
  const isFull = progress >= 1;

  return (
    <g className={`world__charge-feedback world__charge-feedback--${playerId}`} aria-hidden="true">
      {hasAim && target && (
        <>
          <line className="world__charge-aim" x1={position.x} y1={position.y}
            x2={target.x} y2={target.y} />
          <circle className="world__charge-target" cx={target.x} cy={target.y} r="1.35" />
        </>
      )}
      <g transform={`translate(${position.x} ${position.y})`}>
        <circle className="world__charge-track" r="5.25" />
        <circle className="world__charge-progress" r="5.25" pathLength="1"
          strokeDasharray={`${progress} 1`} transform="rotate(-90)" />
        {isFull && <circle className="world__charge-flash" r="6.2" />}
      </g>
    </g>
  );
}

function Astronaut({
  astronaut,
  position,
  playerId,
}: {
  astronaut: AstronautState;
  position: Vec2;
  playerId: PlayerId;
}) {
  const movement = astronaut.movement;
  const speed = Math.hypot(movement.velocity.x, movement.velocity.y);
  const moving = movement.mode !== "burst" && speed > 0.01;
  const movementBlend = Math.min(1, speed / MOVEMENT_RULES.walkMaximumSpeed);
  const directionLength = Math.hypot(movement.direction.x, movement.direction.y);
  const direction = directionLength > 0
    ? { x: movement.direction.x / directionLength, y: movement.direction.y / directionLength }
    : { x: 0, y: -1 };
  const sway = moving
    ? Math.sin(movement.gaitPhase) * MOVEMENT_RULES.visualSwayDistance * movementBlend
    : 0;
  const bob = moving
    ? (1 - Math.cos(movement.gaitPhase * 2)) * 0.5 *
      MOVEMENT_RULES.visualBobDistance * movementBlend
    : 0;
  const lean = moving
    ? Math.sin(movement.gaitPhase) * MOVEMENT_RULES.visualLeanDegrees * movementBlend
    : 0;
  const swayX = -direction.y * sway + direction.x * bob;
  const swayY = direction.x * sway + direction.y * bob;

  return (
    <g className={`world__astronaut world__astronaut--${playerId}`}
      transform={`translate(${position.x} ${position.y})`}>
      <g className="world__astronaut-body"
        transform={`translate(${swayX} ${swayY}) rotate(${lean})`}>
        <circle r="3" />
        <rect x="-1.6" y="-.9" width="3.2" height="1.8" rx=".9" />
      </g>
    </g>
  );
}

function clientToWorld(element: SVGSVGElement, clientX: number, clientY: number): Vec2 {
  return clampWorldPoint(clientToWorldUnclamped(element, clientX, clientY));
}

function clientToWorldUnclamped(
  element: SVGSVGElement,
  clientX: number,
  clientY: number,
): Vec2 {
  const matrix = element.getScreenCTM();
  if (matrix) {
    try {
      const point = element.createSVGPoint();
      point.x = clientX;
      point.y = clientY;
      const world = point.matrixTransform(matrix.inverse());
      return { x: world.x, y: world.y };
    } catch {
      // A hidden or zero-sized SVG can briefly have a non-invertible transform.
    }
  }

  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
  return {
    x: ((clientX - rect.left) / rect.width) * WORLD.width,
    y: ((clientY - rect.top) / rect.height) * WORLD.height,
  };
}

function worldToClient(element: SVGSVGElement, position: Vec2): Vec2 | null {
  const matrix = element.getScreenCTM();
  if (!matrix) return null;
  const point = element.createSVGPoint();
  point.x = position.x;
  point.y = position.y;
  const client = point.matrixTransform(matrix);
  return { x: client.x, y: client.y };
}

function pointDistance(a: Vec2, b: Vec2) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function relativeChargeTarget(gesture: ActiveGesture, astronaut: AstronautState): Vec2 {
  const origin = clientToWorldUnclamped(
    gesture.element,
    gesture.originClient.x,
    gesture.originClient.y,
  );
  const latest = clientToWorldUnclamped(
    gesture.element,
    gesture.latestClient.x,
    gesture.latestClient.y,
  );
  const drag = {
    x: latest.x - origin.x,
    y: latest.y - origin.y,
  };
  const dragLength = Math.hypot(drag.x, drag.y);
  const direction = dragLength < 0.5
    ? astronaut.movement.direction
    : { x: drag.x / dragLength, y: drag.y / dragLength };
  // Aim points may sit just outside the arena. The server uses their direction
  // and still clamps the astronaut itself, avoiding a zero vector at an edge.
  return {
    x: astronaut.position.x + direction.x * MOVEMENT_RULES.aimVectorDistance,
    y: astronaut.position.y + direction.y * MOVEMENT_RULES.aimVectorDistance,
  };
}

function clampWorldPoint(point: Vec2): Vec2 {
  return {
    x: Math.min(WORLD.width, Math.max(0, point.x)),
    y: Math.min(WORLD.height, Math.max(0, point.y)),
  };
}
