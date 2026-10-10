import { useCallback, useEffect, useRef } from "react";
import { MOVEMENT_RULES } from "../movement/movement";
import { canArmBoostCharge } from "./chargeActivation";
import type {
  MovementCommand,
  MovementMode,
  TankInput,
} from "../types";
import {
  getTankInput,
  isKeyboardBoostDoubleTap,
  isKeyboardBoostTap,
  isGameplayKeyboardBlockedTarget,
  isKeyboardMovementCode,
  isTankBoostCode,
  type KeyboardMovementCode,
  type KeyboardTap,
  type TankBoostCode,
} from "./keyboardMovement";

interface KeyboardMovementOptions {
  disabled: boolean;
  movementMode: MovementMode;
  onMovementCommand: (command: MovementCommand) => void;
  onKeyboardTakeover: () => void;
  onChargeIntentChange: (active: boolean) => void;
}

interface KeyboardBoostGesture {
  triggerCode: TankBoostCode;
  throttle: -1 | 1;
  phase: "candidate" | "charging";
}

const NEUTRAL_INPUT: TankInput = { throttle: 0, steering: 0 };

/**
 * Owns match-wide desktop tank controls without coupling keyboard events to
 * the renderer. W/S drive along the authoritative facing while A/D steer it.
 */
export function useKeyboardMovement({
  disabled,
  movementMode,
  onMovementCommand,
  onKeyboardTakeover,
  onChargeIntentChange,
}: KeyboardMovementOptions) {
  const pressedCodes = useRef(new Set<string>());
  const pressedAt = useRef(new Map<KeyboardMovementCode, number>());
  const lastTap = useRef<KeyboardTap | null>(null);
  const boostGesture = useRef<KeyboardBoostGesture | null>(null);
  const boostArmTimer = useRef<number | null>(null);
  const pressedDuringCommittedBoost = useRef(new Set<KeyboardMovementCode>());
  const requireNeutralForBoost = useRef(false);
  const resumeAfterBoost = useRef(false);
  const commandRef = useRef(onMovementCommand);
  const takeoverRef = useRef(onKeyboardTakeover);
  const chargeIntentRef = useRef(onChargeIntentChange);
  const disabledRef = useRef(disabled);
  const movementModeRef = useRef(movementMode);
  const lastInput = useRef<TankInput>(NEUTRAL_INPUT);
  const previousMode = useRef(movementMode);
  commandRef.current = onMovementCommand;
  takeoverRef.current = onKeyboardTakeover;
  chargeIntentRef.current = onChargeIntentChange;
  disabledRef.current = disabled;
  movementModeRef.current = movementMode;

  const clearBoostArmTimer = useCallback(() => {
    if (boostArmTimer.current !== null) window.clearTimeout(boostArmTimer.current);
    boostArmTimer.current = null;
  }, []);

  const emitCurrentInput = useCallback((force = false) => {
    if (disabledRef.current) return;
    const input = getTankInput(pressedCodes.current);
    const boost = boostGesture.current;

    if (boost?.phase === "charging") {
      if (input.throttle !== boost.throttle) {
        clearBoostArmTimer();
        boostGesture.current = null;
        lastTap.current = null;
        lastInput.current = input;
        requireNeutralForBoost.current = pressedCodes.current.size > 0;
        resumeAfterBoost.current = false;
        chargeIntentRef.current(false);
        commandRef.current({ type: "stop" });
        if (!isNeutralInput(input)) {
          commandRef.current({ type: "tank_drive", ...input });
        }
        return;
      }
      if (!force && sameInput(input, lastInput.current)) return;
      lastInput.current = input;
      commandRef.current({
        type: "tank_charge",
        throttle: boost.throttle,
        steering: input.steering,
      });
      return;
    }

    if (!force && sameInput(input, lastInput.current)) return;
    lastInput.current = input;
    commandRef.current(
      isNeutralInput(input)
        ? { type: "stop" }
        : { type: "tank_drive", ...input },
    );
  }, [clearBoostArmTimer]);

  const clearKeyboardMovement = useCallback((sendStop = true) => {
    const wasActive = pressedCodes.current.size > 0 ||
      !isNeutralInput(lastInput.current) ||
      boostGesture.current !== null;
    clearBoostArmTimer();
    pressedCodes.current.clear();
    pressedAt.current.clear();
    pressedDuringCommittedBoost.current.clear();
    lastTap.current = null;
    boostGesture.current = null;
    chargeIntentRef.current(false);
    requireNeutralForBoost.current = false;
    resumeAfterBoost.current = false;
    lastInput.current = NEUTRAL_INPUT;
    if (sendStop && wasActive) commandRef.current({ type: "stop" });
  }, [clearBoostArmTimer]);

  useEffect(() => {
    function armKeyboardBoost(triggerCode: TankBoostCode) {
      const throttle = boostThrottle(triggerCode);
      boostGesture.current = {
        triggerCode,
        throttle,
        phase: "candidate",
      };
      clearBoostArmTimer();
      boostArmTimer.current = window.setTimeout(() => {
        boostArmTimer.current = null;
        const boost = boostGesture.current;
        if (
          !boost ||
          boost.phase !== "candidate" ||
          !pressedCodes.current.has(boost.triggerCode) ||
          disabledRef.current ||
          !canArmBoostCharge(movementModeRef.current)
        ) {
          boostGesture.current = null;
          return;
        }

        const input = getTankInput(pressedCodes.current);
        if (input.throttle !== boost.throttle) {
          boostGesture.current = null;
          lastTap.current = null;
          requireNeutralForBoost.current = pressedCodes.current.size > 0;
          return;
        }

        boost.phase = "charging";
        lastTap.current = null;
        lastInput.current = input;
        requireNeutralForBoost.current = true;
        chargeIntentRef.current(true);
        commandRef.current({
          type: "tank_charge",
          throttle: boost.throttle,
          steering: input.steering,
        });
      }, MOVEMENT_RULES.gestureArmMs);
    }

    function handleKeyDown(event: KeyboardEvent) {
      const blockedTarget = isGameplayKeyboardBlockedTarget(event.target);
      if (event.code === "Escape" && !blockedTarget) {
        if (pressedCodes.current.size > 0 || boostGesture.current || lastTap.current) {
          event.preventDefault();
          clearKeyboardMovement(true);
        }
        return;
      }

      if (
        disabledRef.current ||
        !isKeyboardMovementCode(event.code) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.isComposing ||
        blockedTarget
      ) return;

      event.preventDefault();
      if (event.repeat || pressedCodes.current.has(event.code)) return;

      const now = performance.now();
      const canStartBoost =
        isTankBoostCode(event.code) &&
        !requireNeutralForBoost.current &&
        canArmBoostCharge(movementModeRef.current) &&
        isKeyboardBoostDoubleTap(lastTap.current, event.code, now);
      // Steering may change between the thrust tap and second press. A
      // different thrust key intentionally breaks the sequence.
      if (isTankBoostCode(event.code)) lastTap.current = null;
      takeoverRef.current();
      pressedCodes.current.add(event.code);
      pressedAt.current.set(event.code, now);
      if (!canArmBoostCharge(movementModeRef.current)) {
        pressedDuringCommittedBoost.current.add(event.code);
      }
      emitCurrentInput();
      if (canStartBoost) armKeyboardBoost(event.code);
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (!isKeyboardMovementCode(event.code)) return;
      if (!pressedCodes.current.has(event.code)) return;

      event.preventDefault();
      const releasedAt = performance.now();
      const boost = boostGesture.current;
      const isBoostTrigger = boost?.triggerCode === event.code;
      const keyPressedAt = pressedAt.current.get(event.code);
      const beganDuringCommittedBoost =
        pressedDuringCommittedBoost.current.delete(event.code);
      pressedCodes.current.delete(event.code);
      pressedAt.current.delete(event.code);

      if (isBoostTrigger && boost) {
        clearBoostArmTimer();
        boostGesture.current = null;
        lastTap.current = null;
        chargeIntentRef.current(false);

        if (boost.phase === "charging") {
          const remainingInput = getTankInput(pressedCodes.current);
          commandRef.current({ type: "tank_release" });
          lastInput.current = remainingInput;
          resumeAfterBoost.current = !isNeutralInput(remainingInput);
          requireNeutralForBoost.current = pressedCodes.current.size > 0;
          if (!isNeutralInput(remainingInput)) {
            commandRef.current({ type: "tank_drive", ...remainingInput });
          }
          return;
        }

        // Releasing before the arm delay keeps the second press as an ordinary
        // tank-control tap instead of swallowing it.
        if (pressedCodes.current.size === 0) requireNeutralForBoost.current = false;
        emitCurrentInput();
        return;
      }

      if (boost) {
        // A steering key only adjusts the authoritative turn during charging.
        emitCurrentInput();
        return;
      }

      // A tap made during the committed launch queues ordinary movement after
      // landing. Releasing that tap before landing must not erase the queue or
      // become the first half of a future double-tap boost.
      if (
        beganDuringCommittedBoost &&
        !canArmBoostCharge(movementModeRef.current)
      ) {
        const remainingInput = getTankInput(pressedCodes.current);
        if (!isNeutralInput(remainingInput)) emitCurrentInput();
        if (requireNeutralForBoost.current && pressedCodes.current.size === 0) {
          requireNeutralForBoost.current = false;
        }
        return;
      }

      if (
        isTankBoostCode(event.code) &&
        !beganDuringCommittedBoost &&
        !requireNeutralForBoost.current &&
        canArmBoostCharge(movementModeRef.current) &&
        keyPressedAt !== undefined &&
        isKeyboardBoostTap(keyPressedAt, releasedAt)
      ) {
        lastTap.current = {
          code: event.code,
          pressedAt: keyPressedAt,
          releasedAt,
        };
      }

      if (requireNeutralForBoost.current && pressedCodes.current.size === 0) {
        requireNeutralForBoost.current = false;
      }
      emitCurrentInput();
    }

    function stopKeyboardMovement() {
      clearKeyboardMovement(true);
    }

    function stopWhenHidden() {
      if (document.visibilityState === "hidden") stopKeyboardMovement();
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", stopKeyboardMovement);
    document.addEventListener("visibilitychange", stopWhenHidden);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", stopKeyboardMovement);
      document.removeEventListener("visibilitychange", stopWhenHidden);
      // Strict Mode mounts effects twice in development; cleanup must not
      // inject a gameplay command during that probe cycle.
      clearKeyboardMovement(false);
    };
  }, [
    clearBoostArmTimer,
    clearKeyboardMovement,
    emitCurrentInput,
  ]);

  useEffect(() => {
    if (disabled) clearKeyboardMovement(true);
  }, [clearKeyboardMovement, disabled]);

  useEffect(() => {
    const priorMode = previousMode.current;
    previousMode.current = movementMode;
    if (!canArmBoostCharge(movementMode)) lastTap.current = null;
    const finishedCommittedMovement =
      movementMode !== "burst" &&
      movementMode !== "charging" &&
      (priorMode === "burst" ||
        (resumeAfterBoost.current && priorMode === "charging"));
    if (finishedCommittedMovement && pressedCodes.current.size > 0) {
      emitCurrentInput(true);
    }
    if (finishedCommittedMovement) {
      pressedDuringCommittedBoost.current.clear();
      resumeAfterBoost.current = false;
    }
  }, [emitCurrentInput, movementMode]);

  return { clearKeyboardMovement };
}

function boostThrottle(code: TankBoostCode): -1 | 1 {
  return (getTankInput([code]).throttle || 1) as -1 | 1;
}

function sameInput(a: TankInput, b: TankInput | null | undefined) {
  return b !== null && b !== undefined &&
    a.throttle === b.throttle && a.steering === b.steering;
}

function isNeutralInput(input: TankInput | null | undefined) {
  return input === null || input === undefined ||
    (input.throttle === 0 && input.steering === 0);
}
