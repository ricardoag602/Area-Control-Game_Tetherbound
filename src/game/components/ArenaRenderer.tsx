import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { WORLD } from "../constants";
import {
  buildChargeRadarPath,
  calculateChargeRadar,
  chargeRadarEndpoint,
} from "../presentation/chargeRadar";
import { MOVEMENT_RULES } from "../movement/movement";
import { getEnvironmentModifiers } from "../simulation/environment";
import {
  getScreenTouchChargeInput,
  getTankChargeInput,
  isTouchBoostDoubleTap,
  isTouchBoostTap,
  usesDirectTouchCharge,
  type TouchBoostTap,
} from "../input/touchCharge";
import {
  canArmBoostCharge,
  canPrepareTouchBoostCharge,
  getTouchBoostChargeActivation,
} from "../input/chargeActivation";
import { useKeyboardMovement } from "../input/useKeyboardMovement";
import type {
  AstronautState,
  GameState,
  MovementCommand,
  PlayerId,
  TankInput,
  Vec2,
} from "../types";
import { useFollowCamera } from "../hooks/useFollowCamera";
import { useSmoothedPositions } from "../hooks/useSmoothedPositions";
import { BiomeLayer } from "./BiomeLayer";
import { TetherNetworkLayer } from "./TetherNetworkLayer";

interface ArenaRendererProps {
  state: GameState;
  localPlayerId: PlayerId;
  onMovementCommand: (command: MovementCommand) => void;
  disabled?: boolean;
  interpolatePositions?: boolean;
  oxygenZoomMultiplier?: number;
}

type GestureMode =
  | "walking"
  | "charge-candidate"
  | "charge-primed"
  | "charging";

interface ActiveGesture {
  element: SVGSVGElement;
  pointerId: number;
  mode: GestureMode;
  pointerType: string;
  chargeControl: "direct" | "tank";
  startedDuringCommittedBoost: boolean;
  pressedAt: number;
  touchBoostSequence: "none" | "second-press";
  originClient: Vec2;
  latestClient: Vec2;
}

export function ArenaRenderer({
  state,
  localPlayerId,
  onMovementCommand,
  disabled = false,
  interpolatePositions = false,
  oxygenZoomMultiplier = 1,
}: ArenaRendererProps) {
  const renderPositions = useSmoothedPositions(state, interpolatePositions);
  const localAstronaut = state.players[localPlayerId].astronaut;
  const localEnvironment = getEnvironmentModifiers(
    state,
    localAstronaut.position,
  );
  const arenaRef = useRef<SVGSVGElement>(null);
  const [chargeIntentActive, setChargeIntentActive] = useState(false);
  const camera = useFollowCamera(
    arenaRef,
    renderPositions[localPlayerId],
    localAstronaut.movement,
    chargeIntentActive,
    oxygenZoomMultiplier,
  );
  const commandRef = useRef(onMovementCommand);
  const localAstronautRef = useRef(localAstronaut);
  const gestureRef = useRef<ActiveGesture | null>(null);
  const chargeTimerRef = useRef<number | null>(null);
  const lastTouchTapRef = useRef<TouchBoostTap | null>(null);
  const lastTouchChargeInputRef = useRef<TankInput | null>(null);
  const [touchChargePreview, setTouchChargePreview] = useState<TankInput | null>(null);
  commandRef.current = onMovementCommand;
  localAstronautRef.current = localAstronaut;

  const clearChargeTimer = useCallback(() => {
    if (chargeTimerRef.current !== null) window.clearTimeout(chargeTimerRef.current);
    chargeTimerRef.current = null;
  }, []);

  const emitPointerCharge = useCallback((
    gesture: ActiveGesture,
    astronaut: AstronautState,
    force = false,
  ) => {
    const tankInput = gesture.chargeControl === "direct"
      ? screenTouchChargeInput(gesture, astronaut)
      : pointerTankChargeInput(gesture, astronaut);
    const previous = lastTouchChargeInputRef.current;
    const changed = !previous ||
      previous.throttle !== tankInput.throttle ||
      previous.steering !== tankInput.steering;
    if (!changed && !force) return;

    lastTouchChargeInputRef.current = tankInput;
    setTouchChargePreview(tankInput);
    commandRef.current({ type: "tank_charge", ...tankInput });
  }, []);

  const clearPointerGesture = useCallback((sendStop: boolean) => {
    const gesture = gestureRef.current;
    if (!gesture) return;

    setChargeIntentActive(false);
    gestureRef.current = null;
    clearChargeTimer();
    lastTouchChargeInputRef.current = null;
    setTouchChargePreview(null);
    if (gesture.element.hasPointerCapture(gesture.pointerId)) {
      gesture.element.releasePointerCapture(gesture.pointerId);
    }
    if (sendStop) commandRef.current({ type: "stop" });
  }, [clearChargeTimer]);

  const cancelGesture = useCallback(() => {
    lastTouchTapRef.current = null;
    clearPointerGesture(true);
  }, [clearPointerGesture]);

  const { clearKeyboardMovement } = useKeyboardMovement({
    disabled,
    movementMode: localAstronaut.movement.mode,
    onMovementCommand,
    onKeyboardTakeover: cancelGesture,
    onChargeIntentChange: setChargeIntentActive,
  });
  const previousRespawns = useRef(localAstronaut.respawns);

  useEffect(() => {
    const respawns = localAstronaut.respawns;
    if (respawns > previousRespawns.current) {
      // The authoritative respawn already stopped movement. Only discard the
      // client-side owners so releasing a pre-respawn hold cannot launch later.
      clearPointerGesture(false);
      clearKeyboardMovement(false);
      lastTouchTapRef.current = null;
      setChargeIntentActive(false);
    }
    previousRespawns.current = respawns;
  }, [
    clearKeyboardMovement,
    clearPointerGesture,
    localAstronaut.respawns,
  ]);

  useEffect(() => {
    if (document.activeElement === document.body) {
      arenaRef.current?.focus({ preventScroll: true });
    }
  }, []);

  useEffect(() => {
    if (disabled) cancelGesture();
  }, [cancelGesture, disabled]);

  useEffect(() => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    if (
      gesture.mode === "charge-primed" &&
      canArmBoostCharge(localAstronaut.movement.mode)
    ) {
      gesture.mode = "charging";
      setChargeIntentActive(true);
      emitPointerCharge(gesture, localAstronaut, true);
      return;
    }
    if (gesture.mode !== "charging") return;
    // Re-evaluate the finger vector as the authoritative heading rotates so
    // touch steering goes neutral on target while retaining desktop physics.
    emitPointerCharge(gesture, localAstronaut, false);
  }, [
    emitPointerCharge,
    localAstronaut,
    localAstronaut.movement.facing.x,
    localAstronaut.movement.facing.y,
  ]);

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
    const pressedAt = performance.now();
    const localPosition = renderPositions[localPlayerId];
    const directTouchCharge = usesDirectTouchCharge(event.pointerType);
    const astronautClient = worldToClient(element, localPosition);
    const hitRadius = element.closest(".app--large-controls")
      ? MOVEMENT_RULES.largeControlHitRadiusPx
      : MOVEMENT_RULES.astronautHitRadiusPx;
    const beginsOnAstronaut = astronautClient !== null &&
      pointDistance(clientPoint, astronautClient) <= hitRadius;
    const canArmCharge = canArmBoostCharge(localAstronaut.movement.mode);
    const canPrepareTouchCharge = directTouchCharge
      ? canPrepareTouchBoostCharge(localAstronaut.movement)
      : canArmCharge;
    const isTouchBoostSecondPress = directTouchCharge &&
      canPrepareTouchCharge &&
      isTouchBoostDoubleTap(
        lastTouchTapRef.current,
        event.pointerType,
        clientPoint,
        pressedAt,
      );
    if (directTouchCharge) lastTouchTapRef.current = null;
    const canCharge = canPrepareTouchCharge &&
      (directTouchCharge ? isTouchBoostSecondPress : beginsOnAstronaut);

    element.setPointerCapture(event.pointerId);
    gestureRef.current = {
      element,
      pointerId: event.pointerId,
      mode: canCharge ? "charge-candidate" : "walking",
      pointerType: event.pointerType,
      chargeControl: directTouchCharge ? "direct" : "tank",
      startedDuringCommittedBoost: !canPrepareTouchCharge,
      pressedAt,
      touchBoostSequence: isTouchBoostSecondPress ? "second-press" : "none",
      originClient: clientPoint,
      latestClient: clientPoint,
    };

    if (!canCharge) {
      commandRef.current({ type: "walk", target });
      return;
    }

    // Only a valid second touch enters this arm window. Its hold then commits
    // to the astronaut-to-finger vector using the shared tank-charge physics.
    commandRef.current(
      directTouchCharge
        ? { type: "walk", target }
        : { type: "tank_drive", throttle: 1, steering: 0 },
    );
    chargeTimerRef.current = window.setTimeout(() => {
      chargeTimerRef.current = null;
      const gesture = gestureRef.current;
      if (!gesture || gesture.mode !== "charge-candidate") return;
      const latestMovement = localAstronautRef.current.movement;
      const touchActivation = gesture.chargeControl === "direct"
        ? getTouchBoostChargeActivation(latestMovement)
        : canArmBoostCharge(latestMovement.mode)
          ? "arm"
          : "blocked";
      if (touchActivation === "prime") {
        gesture.mode = "charge-primed";
        return;
      }
      if (touchActivation === "blocked") {
        gesture.mode = "walking";
        commandRef.current({
          type: "walk",
          target: clientToWorld(
            gesture.element,
            gesture.latestClient.x,
            gesture.latestClient.y,
          ),
        });
        return;
      }
      gesture.mode = "charging";
      setChargeIntentActive(true);
      emitPointerCharge(gesture, localAstronautRef.current, true);
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
      const gestureSlop = gesture.chargeControl === "direct"
        ? MOVEMENT_RULES.touchGestureSlopPx
        : MOVEMENT_RULES.gestureSlopPx;
      if (pointDistance(clientPoint, gesture.originClient) <= gestureSlop) return;
      clearChargeTimer();
      gesture.mode = "walking";
      commandRef.current({ type: "walk", target });
      return;
    }

    if (gesture.mode === "charging") {
      emitPointerCharge(gesture, localAstronautRef.current, false);
      return;
    }

    if (gesture.mode === "charge-primed") return;

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
    const releasedAt = performance.now();
    const shouldRelease = gesture.mode === "charging";
    const preserveQueuedMovement =
      gesture.startedDuringCommittedBoost &&
      !canArmBoostCharge(localAstronautRef.current.movement.mode);
    const releaseCommand: MovementCommand | null = shouldRelease
      ? { type: "tank_release" }
      : preserveQueuedMovement
        ? null
        : { type: "stop" };
    const shouldRememberTouchTap =
      gesture.chargeControl === "direct" &&
      gesture.touchBoostSequence === "none" &&
      !gesture.startedDuringCommittedBoost &&
      canPrepareTouchBoostCharge(localAstronautRef.current.movement) &&
      isTouchBoostTap(
        gesture.pressedAt,
        releasedAt,
        gesture.originClient,
        gesture.latestClient,
      );

    gestureRef.current = null;
    clearChargeTimer();
    lastTouchChargeInputRef.current = null;
    setChargeIntentActive(false);
    setTouchChargePreview(null);
    if (gesture.element.hasPointerCapture(gesture.pointerId)) {
      gesture.element.releasePointerCapture(gesture.pointerId);
    }
    if (shouldRememberTouchTap) {
      lastTouchTapRef.current = {
        pointerType: gesture.pointerType,
        pressedAt: gesture.pressedAt,
        releasedAt,
        position: { ...gesture.latestClient },
      };
    }
    if (releaseCommand) commandRef.current(releaseCommand);
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
      viewBox={`${camera.x} ${camera.y} ${camera.width} ${camera.height}`}
      role="application"
      tabIndex={0}
      aria-roledescription="game arena"
      aria-label="Tetherbound game arena. Keyboard controls stay active throughout the match. Use W and S or the up and down arrows to drive forward and reverse. Use A and D or the left and right arrows to turn. Tap W or S, then press and hold that same key to charge; release it to burst. Press T to deploy a tether and Escape to cancel keyboard movement. Drag to move with a pointer. On a touch screen, tap once, then press and hold nearby to charge toward your finger; release to burst."
      aria-keyshortcuts="W A S D T ArrowUp ArrowDown ArrowLeft ArrowRight"
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
      <rect className="world__void" x={-WORLD.width} y={-WORLD.height}
        width={WORLD.width * 3} height={WORLD.height * 3} />
      <rect className="world__surface" width={WORLD.width} height={WORLD.height} />
      <BiomeLayer />
      <rect width={WORLD.width} height={WORLD.height} fill="url(#world-grid)" />
      <rect className="world__boundary" width={WORLD.width} height={WORLD.height} />

      <TetherNetworkLayer
        state={state}
        renderPositions={renderPositions}
        localPlayerId={localPlayerId}
      />

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
        touchChargePreview={touchChargePreview}
        turnRateMultiplier={localEnvironment.turnRateMultiplier}
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

function ChargeFeedback({
  astronaut,
  position,
  playerId,
  touchChargePreview,
  turnRateMultiplier,
}: {
  astronaut: AstronautState;
  position: Vec2;
  playerId: PlayerId;
  touchChargePreview: TankInput | null;
  turnRateMultiplier: number;
}) {
  const movement = astronaut.movement;
  const charging = movement.mode === "charging" || touchChargePreview !== null;
  if (!charging) return null;

  const progress = Math.min(1, movement.chargeSeconds / MOVEMENT_RULES.fullChargeSeconds);
  const radarMovement = touchChargePreview
    ? {
        ...movement,
        mode: "charging" as const,
        tankThrottle: touchChargePreview.throttle,
        tankSteering: touchChargePreview.steering,
        direction: touchChargePreview.throttle < 0
          ? { x: -movement.facing.x, y: -movement.facing.y }
          : movement.facing,
      }
    : movement;
  const radar = calculateChargeRadar(
    radarMovement,
    turnRateMultiplier,
  );
  const target = chargeRadarEndpoint(position, radar);
  const radarPath = buildChargeRadarPath(position, radar);
  const isFull = progress >= 1;
  const rangeClipped = pointDistance(position, target) <
    radar.burstDistance - 0.001;

  return (
    <g className={`world__charge-feedback world__charge-feedback--${playerId}`} aria-hidden="true">
      <path
        className={`world__charge-radar${radar.canRelease ? "" : " world__charge-radar--arming"}`}
        d={radarPath}
      />
      {radar.canRelease && (
        <>
          <line className="world__charge-aim" x1={position.x} y1={position.y}
            x2={target.x} y2={target.y} />
          <circle
            className={`world__charge-target${rangeClipped ? " world__charge-target--blocked" : ""}`}
            cx={target.x}
            cy={target.y}
            r="1.35"
          />
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
  const directionLength = Math.hypot(movement.facing.x, movement.facing.y);
  const direction = directionLength > 0
    ? { x: movement.facing.x / directionLength, y: movement.facing.y / directionLength }
    : { x: 0, y: -1 };
  const headingRadians = Number.isFinite(movement.headingRadians)
    ? movement.headingRadians
    : Math.atan2(direction.y, direction.x);
  const headingDegrees = headingRadians * 180 / Math.PI + 90;
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
  return (
    <g className={`world__astronaut world__astronaut--${playerId}`}
      transform={`translate(${position.x} ${position.y})`}>
      <g className="world__astronaut-facing" transform={`rotate(${headingDegrees})`}>
        <g className="world__astronaut-body"
          transform={`translate(${sway} ${-bob}) rotate(${lean})`}>
          <circle r="3" />
          <rect x="-1.6" y="-.9" width="3.2" height="1.8" rx=".9" />
          <path className="world__astronaut-nose" d="M 0 -4 L 1 -2.3 L -1 -2.3 Z" />
        </g>
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
  const viewBox = element.viewBox.baseVal;
  if (
    rect.width === 0 ||
    rect.height === 0 ||
    viewBox.width === 0 ||
    viewBox.height === 0
  ) return { x: viewBox.x, y: viewBox.y };
  const scale = Math.min(
    rect.width / viewBox.width,
    rect.height / viewBox.height,
  );
  const renderedWidth = viewBox.width * scale;
  const renderedHeight = viewBox.height * scale;
  const offsetX = (rect.width - renderedWidth) / 2;
  const offsetY = (rect.height - renderedHeight) / 2;
  return {
    x: viewBox.x + (clientX - rect.left - offsetX) / scale,
    y: viewBox.y + (clientY - rect.top - offsetY) / scale,
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

function screenTouchChargeInput(
  gesture: ActiveGesture,
  astronaut: AstronautState,
): TankInput {
  const touchPosition = clientToWorldUnclamped(
    gesture.element,
    gesture.latestClient.x,
    gesture.latestClient.y,
  );
  return getScreenTouchChargeInput(
    astronaut.movement.facing,
    astronaut.position,
    touchPosition,
    astronaut.movement.direction,
  );
}

function pointerTankChargeInput(
  gesture: ActiveGesture,
  astronaut: AstronautState,
): TankInput {
  const target = relativeChargeTarget(gesture, astronaut);
  const hasAim = pointDistance(
    gesture.latestClient,
    gesture.originClient,
  ) >= MOVEMENT_RULES.aimDeadZonePx;
  return getTankChargeInput(
    astronaut.movement.facing,
    {
      x: target.x - astronaut.position.x,
      y: target.y - astronaut.position.y,
    },
    hasAim,
  );
}

function clampWorldPoint(point: Vec2): Vec2 {
  return {
    x: Math.min(WORLD.width, Math.max(0, point.x)),
    y: Math.min(WORLD.height, Math.max(0, point.y)),
  };
}
