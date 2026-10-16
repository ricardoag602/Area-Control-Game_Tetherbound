import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { GAME_RULES, WORLD } from "../constants";
import { normalizeOxygen } from "../presentation/oxygen";
import {
  buildChargeRadarPath,
  calculateChargeRadar,
  chargeRadarEndpoint,
} from "../presentation/chargeRadar";
import {
  ASTRONAUT_SPRITES,
  getAstronautSpriteFrame,
} from "../presentation/astronautSprites";
import type { CameraViewBox } from "../presentation/camera";
import { DROPPED_MATERIAL_SPRITE } from "../presentation/objectSprites";
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
import type { TutorialStepId } from "../tutorial/guidedSetup";
import { useFollowCamera } from "../hooks/useFollowCamera";
import { useSmoothedPositions } from "../hooks/useSmoothedPositions";
import { PixiTerrainLayer } from "./PixiTerrainLayer";
import { TetherCableLayer, TetherNetworkLayer } from "./TetherNetworkLayer";

const ThreeAstronautLayer = lazy(() => import("./ThreeAstronautLayer"));
const THREE_LAYER_FALLBACK_DELAY_MS = 4_000;
const THREE_LAYER_IDLE_TIMEOUT_MS = 800;

interface ArenaRendererProps {
  state: GameState;
  localPlayerId: PlayerId;
  onMovementCommand: (command: MovementCommand) => void;
  disabled?: boolean;
  interpolatePositions?: boolean;
  oxygenZoomMultiplier?: number;
  cameraMode?: "follow" | "overview";
  onOverviewSettled?: () => void;
  tutorialStep?: TutorialStepId | null;
  tutorialTarget?: Vec2 | null;
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
  cameraMode = "follow",
  onOverviewSettled,
  tutorialStep = null,
  tutorialTarget = null,
}: ArenaRendererProps) {
  const renderPositions = useSmoothedPositions(state, interpolatePositions);
  const localAstronaut = state.players[localPlayerId].astronaut;
  const localEnvironment = getEnvironmentModifiers(
    state,
    localAstronaut.position,
  );
  const arenaRef = useRef<SVGSVGElement>(null);
  const [terrainReady, setTerrainReady] = useState(false);
  const [threeLayerEnabled, setThreeLayerEnabled] = useState(false);
  const [threeAstronautsReady, setThreeAstronautsReady] = useState(false);
  const [threeObjectsReady, setThreeObjectsReady] = useState(false);
  const [chargeIntentActive, setChargeIntentActive] = useState(false);
  const [oxygenRefillSerial, setOxygenRefillSerial] = useState(0);
  const oxygenWasDepletedRef = useRef(
    localAstronaut.oxygen < GAME_RULES.oxygenMaximum,
  );
  const camera = useFollowCamera(
    arenaRef,
    renderPositions[localPlayerId],
    localAstronaut.movement,
    chargeIntentActive,
    oxygenZoomMultiplier,
    cameraMode,
    onOverviewSettled,
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

  useEffect(() => {
    if (threeLayerEnabled) return;

    const enableThreeLayer = () => setThreeLayerEnabled(true);
    const fallbackTimer = window.setTimeout(
      enableThreeLayer,
      THREE_LAYER_FALLBACK_DELAY_MS,
    );
    if (!terrainReady) return () => window.clearTimeout(fallbackTimer);

    let idleCallback: number | null = null;
    let idleFallbackTimer: number | null = null;
    if (typeof window.requestIdleCallback === "function") {
      idleCallback = window.requestIdleCallback(enableThreeLayer, {
        timeout: THREE_LAYER_IDLE_TIMEOUT_MS,
      });
    } else {
      idleFallbackTimer = window.setTimeout(enableThreeLayer, 120);
    }

    return () => {
      window.clearTimeout(fallbackTimer);
      if (idleCallback !== null) window.cancelIdleCallback(idleCallback);
      if (idleFallbackTimer !== null) window.clearTimeout(idleFallbackTimer);
    };
  }, [terrainReady, threeLayerEnabled]);

  useEffect(() => {
    if (localAstronaut.oxygen < GAME_RULES.oxygenMaximum - 0.001) {
      oxygenWasDepletedRef.current = true;
      setOxygenRefillSerial(0);
      return;
    }
    if (!oxygenWasDepletedRef.current) return;
    oxygenWasDepletedRef.current = false;
    setOxygenRefillSerial((serial) => serial + 1);
  }, [localAstronaut.oxygen, localPlayerId]);

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
    <div className={`world-stage${threeAstronautsReady ? " world-stage--three-astronauts" : ""}${threeObjectsReady ? " world-stage--three-objects" : ""}`}>
      <PixiTerrainLayer
        state={state}
        camera={camera}
        onInitialRender={() => setTerrainReady(true)}
      />
      <svg
        className="world world--player-underlay"
        viewBox={`${camera.x} ${camera.y} ${camera.width} ${camera.height}`}
        aria-hidden="true"
      >
        <TetherCableLayer state={state} localPlayerId={localPlayerId} />
        <OxygenWorldIndicator
          oxygen={localAstronaut.oxygen}
          position={renderPositions[localPlayerId]}
          refillSerial={oxygenRefillSerial}
        />
        {tutorialStep && (
          <TutorialWorldCue
            step={tutorialStep}
            astronautPosition={renderPositions[localPlayerId]}
            facing={localAstronaut.movement.facing}
            target={tutorialTarget}
            camera={camera}
          />
        )}
        <ChargeFeedback
          astronaut={localAstronaut}
          position={renderPositions[localPlayerId]}
          playerId={localPlayerId}
          touchChargePreview={touchChargePreview}
          turnRateMultiplier={localEnvironment.turnRateMultiplier}
        />
      </svg>
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
        <rect className="world__boundary" width={WORLD.width} height={WORLD.height} />

        <TetherNetworkLayer
          state={state}
          renderPositions={renderPositions}
          localPlayerId={localPlayerId}
        />

        {state.salvage.filter((deposit) => !deposit.collected).map((deposit) => (
          <image
            key={deposit.id}
            className="world__salvage-sprite"
            href={DROPPED_MATERIAL_SPRITE}
            x={deposit.position.x - 2.1}
            y={deposit.position.y - 2.1}
            width="4.2"
            height="4.2"
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
          />
        ))}

        {state.activePlayerIds.map((playerId) => (
          <Astronaut
            key={playerId}
            astronaut={state.players[playerId].astronaut}
            position={renderPositions[playerId]}
            playerId={playerId}
          />
        ))}
      </svg>
      {threeLayerEnabled && (
        <Suspense fallback={null}>
          <ThreeAstronautLayer
            state={state}
            renderPositions={renderPositions}
            camera={camera}
            onReadyChange={setThreeAstronautsReady}
            onObjectReadyChange={setThreeObjectsReady}
          />
        </Suspense>
      )}
    </div>
  );
}

function TutorialWorldCue({
  step,
  astronautPosition,
  facing,
  target,
  camera,
}: {
  step: TutorialStepId;
  astronautPosition: Vec2;
  facing: Vec2;
  target: Vec2 | null;
  camera: CameraViewBox;
}) {
  const followsTarget = step === "salvage" || step === "bank" || step === "break";
  if (followsTarget && !target) return null;

  const targetCue = target ? clampTutorialTargetToCamera(target, camera) : null;
  const position = targetCue?.position ?? astronautPosition;
  const offscreen = targetCue?.offscreen ?? false;
  const heading = Math.atan2(facing.y, facing.x) * 180 / Math.PI;
  const targetHeading = target
    ? Math.atan2(target.y - position.y, target.x - position.x) * 180 / Math.PI
    : 0;

  return (
    <g
      className={`world__tutorial-cue world__tutorial-cue--${step}${offscreen ? " world__tutorial-cue--offscreen" : ""}`}
      transform={`translate(${position.x} ${position.y})`}
      aria-hidden="true"
    >
      <circle className="world__tutorial-cue-halo" r="8.5" />
      <circle className="world__tutorial-cue-ring" r="6.7" />
      {offscreen && (
        <path
          className="world__tutorial-cue-symbol world__tutorial-cue-symbol--filled"
          d="M-5-4 5 0-5 4-2 0Z"
          transform={`rotate(${targetHeading})`}
        />
      )}
      {!offscreen && step === "move" && (
        <path className="world__tutorial-cue-symbol" d="M0-12V-7M0 12V7M-12 0H-7M12 0H7M0-12l-2 2M0-12l2 2M0 12l-2-2M0 12l2-2M-12 0l2-2M-12 0l2 2M12 0l-2-2M12 0l-2 2" />
      )}
      {!offscreen && step === "boost" && (
        <g transform={`rotate(${heading})`}>
          <path className="world__tutorial-cue-symbol" d="M-2.5 0H12M7-4l5 4-5 4" />
          <path className="world__tutorial-cue-trail" d="M-5-3H-11M-5 0H-14M-5 3H-11" />
        </g>
      )}
      {!offscreen && step === "deploy" && (
        <path className="world__tutorial-cue-symbol" d="M0-4V4M-4 0H4M-3.7-3.7 3.7 3.7M3.7-3.7-3.7 3.7" />
      )}
      {!offscreen && step === "salvage" && (
        <path className="world__tutorial-cue-symbol world__tutorial-cue-symbol--filled" d="m0-4.8 4.3 4.3L0 5.2-4.3-.5 0-4.8Z" />
      )}
      {!offscreen && step === "bank" && (
        <path className="world__tutorial-cue-symbol" d="M-10 0H4M0-4l4 4-4 4M7-5v10" />
      )}
      {!offscreen && step === "break" && (
        <path className="world__tutorial-cue-symbol" d="M-9-4h4l4 4-4 4h-4M9-4H5L1 0l4 4h4M-2-6 0-10M2 6 0 10" />
      )}
    </g>
  );
}

function clampTutorialTargetToCamera(
  target: Vec2,
  camera: CameraViewBox,
): { position: Vec2; offscreen: boolean } {
  const margin = Math.min(10, camera.width / 4, camera.height / 4);
  const minimumX = camera.x + margin;
  const maximumX = camera.x + camera.width - margin;
  const minimumY = camera.y + margin;
  const maximumY = camera.y + camera.height - margin;
  const position = {
    x: Math.min(maximumX, Math.max(minimumX, target.x)),
    y: Math.min(maximumY, Math.max(minimumY, target.y)),
  };
  return {
    position,
    offscreen: position.x !== target.x || position.y !== target.y,
  };
}

function OxygenWorldIndicator({
  oxygen,
  position,
  refillSerial,
}: {
  oxygen: number;
  position: Vec2;
  refillSerial: number;
}) {
  const normalized = normalizeOxygen(oxygen, GAME_RULES.oxygenMaximum);
  const depleted = normalized < 0.999;
  const completing = !depleted && refillSerial > 0;
  if (!depleted && !completing) return null;
  const meterWidth = 6.8;
  const fillWidth = meterWidth * normalized;

  return (
    <g
      key={completing ? `oxygen-refill-${refillSerial}` : "oxygen-active"}
      className={`world__oxygen-meter${completing ? " world__oxygen-meter--refilled" : ""}${normalized <= 0.3 ? " world__oxygen-meter--danger" : ""}`}
      transform={`translate(${position.x} ${position.y + 6.25})`}
      aria-hidden="true"
    >
      <rect
        className="world__oxygen-meter-track"
        x={-meterWidth / 2}
        y="-.44"
        width={meterWidth}
        height=".88"
        rx=".44"
      />
      <rect
        className="world__oxygen-meter-feather"
        x={-meterWidth / 2}
        y="-.46"
        width={fillWidth}
        height=".92"
        rx=".46"
      />
      <rect
        className="world__oxygen-meter-progress"
        x={-meterWidth / 2}
        y="-.3"
        width={fillWidth}
        height=".6"
        rx=".3"
      />
    </g>
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
  const walking = movement.mode === "walking" && speed > 0.01;
  const activeFrame = getAstronautSpriteFrame(movement);
  const sprites = ASTRONAUT_SPRITES[playerId];
  const movementBlend = Math.min(1, speed / MOVEMENT_RULES.walkMaximumSpeed);
  const directionLength = Math.hypot(movement.facing.x, movement.facing.y);
  const direction = directionLength > 0
    ? { x: movement.facing.x / directionLength, y: movement.facing.y / directionLength }
    : { x: 0, y: -1 };
  const headingRadians = Number.isFinite(movement.headingRadians)
    ? movement.headingRadians
    : Math.atan2(direction.y, direction.x);
  // The painted astronaut faces toward the bottom of its source image.
  const headingDegrees = headingRadians * 180 / Math.PI - 90;
  const sway = walking
    ? Math.sin(movement.gaitPhase) * MOVEMENT_RULES.visualSwayDistance * movementBlend
    : 0;
  const bob = walking
    ? (1 - Math.cos(movement.gaitPhase * 2)) * 0.5 *
      MOVEMENT_RULES.visualBobDistance * movementBlend
    : 0;
  const lean = walking
    ? Math.sin(movement.gaitPhase) * MOVEMENT_RULES.visualLeanDegrees * movementBlend
    : 0;
  return (
    <g className={`world__astronaut world__astronaut--${playerId}`}
      transform={`translate(${position.x} ${position.y})`}>
      <g className="world__astronaut-facing" transform={`rotate(${headingDegrees})`}>
        <g className="world__astronaut-body"
          transform={`translate(${sway} ${-bob}) rotate(${lean})`}>
          {Object.entries(sprites).map(([frame, href]) => (
            <image
              key={frame}
              className={`world__astronaut-sprite world__astronaut-sprite--${frame}${
                activeFrame === frame ? " world__astronaut-sprite--active" : ""
              }`}
              href={href}
              x="-6"
              y="-6"
              width="12"
              height="12"
              preserveAspectRatio="xMidYMid meet"
              aria-hidden="true"
            />
          ))}
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
