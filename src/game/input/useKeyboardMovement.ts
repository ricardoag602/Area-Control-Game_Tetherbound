import { useCallback, useEffect, useRef, type RefObject } from "react";
import { MOVEMENT_RULES } from "../movement";
import type { MovementCommand, MovementMode, Vec2 } from "../types";
import {
  getKeyboardDirection,
  isKeyboardBoostDoubleTap,
  isKeyboardMovementBlockedTarget,
  isKeyboardMovementCode,
  type KeyboardMovementCode,
  type KeyboardTap,
} from "./keyboardMovement";

interface KeyboardMovementOptions {
  disabled: boolean;
  movementMode: MovementMode;
  onMovementCommand: (command: MovementCommand) => void;
  onKeyboardTakeover: () => void;
  targetRef: RefObject<SVGSVGElement | null>;
}

interface KeyboardBoostGesture {
  triggerCode: KeyboardMovementCode;
  phase: "candidate" | "charging";
  direction: Vec2;
}

/**
 * Owns focused desktop movement keys without coupling keyboard events to
 * rendering. A short tap followed by the same held key becomes a directional
 * charge; pointer input can still take ownership immediately.
 */
export function useKeyboardMovement({
  disabled,
  movementMode,
  onMovementCommand,
  onKeyboardTakeover,
  targetRef,
}: KeyboardMovementOptions) {
  const pressedCodes = useRef(new Set<string>());
  const pressedAt = useRef(new Map<KeyboardMovementCode, number>());
  const lastTap = useRef<KeyboardTap | null>(null);
  const boostGesture = useRef<KeyboardBoostGesture | null>(null);
  const boostArmTimer = useRef<number | null>(null);
  const requireNeutralForBoost = useRef(false);
  const resumeAfterBoost = useRef(false);
  const commandRef = useRef(onMovementCommand);
  const takeoverRef = useRef(onKeyboardTakeover);
  const disabledRef = useRef(disabled);
  const movementModeRef = useRef(movementMode);
  const lastDirection = useRef<Vec2 | null>(null);
  const previousMode = useRef(movementMode);
  commandRef.current = onMovementCommand;
  takeoverRef.current = onKeyboardTakeover;
  disabledRef.current = disabled;
  movementModeRef.current = movementMode;

  const clearBoostArmTimer = useCallback(() => {
    if (boostArmTimer.current !== null) window.clearTimeout(boostArmTimer.current);
    boostArmTimer.current = null;
  }, []);

  const emitCurrentDirection = useCallback((force = false) => {
    if (disabledRef.current) return;
    const direction = getKeyboardDirection(pressedCodes.current);
    const boost = boostGesture.current;

    if (boost?.phase === "charging") {
      if (!direction) {
        clearBoostArmTimer();
        boostGesture.current = null;
        lastTap.current = null;
        lastDirection.current = null;
        requireNeutralForBoost.current = pressedCodes.current.size > 0;
        resumeAfterBoost.current = false;
        commandRef.current({ type: "stop" });
        return;
      }
      if (!force && sameDirection(direction, boost.direction)) return;
      boost.direction = direction;
      lastDirection.current = direction;
      commandRef.current({ type: "charge_direction", direction });
      return;
    }

    if (!force && sameDirection(direction, lastDirection.current)) return;
    lastDirection.current = direction;
    commandRef.current(direction
      ? { type: "walk_direction", direction }
      : { type: "stop" });
  }, [clearBoostArmTimer]);

  const clearKeyboardMovement = useCallback((sendStop = true) => {
    const wasActive = pressedCodes.current.size > 0 ||
      lastDirection.current !== null ||
      boostGesture.current !== null;
    clearBoostArmTimer();
    pressedCodes.current.clear();
    pressedAt.current.clear();
    lastTap.current = null;
    boostGesture.current = null;
    requireNeutralForBoost.current = false;
    resumeAfterBoost.current = false;
    lastDirection.current = null;
    if (sendStop && wasActive) commandRef.current({ type: "stop" });
  }, [clearBoostArmTimer]);

  useEffect(() => {
    function armKeyboardBoost(triggerCode: KeyboardMovementCode, direction: Vec2) {
      boostGesture.current = { triggerCode, phase: "candidate", direction };
      clearBoostArmTimer();
      boostArmTimer.current = window.setTimeout(() => {
        boostArmTimer.current = null;
        const boost = boostGesture.current;
        if (
          !boost ||
          boost.phase !== "candidate" ||
          !pressedCodes.current.has(boost.triggerCode) ||
          disabledRef.current ||
          document.activeElement !== targetRef.current ||
          movementModeRef.current === "burst"
        ) {
          boostGesture.current = null;
          return;
        }

        const chargedDirection = getKeyboardDirection(pressedCodes.current);
        if (!chargedDirection) {
          boostGesture.current = null;
          lastDirection.current = null;
          requireNeutralForBoost.current = pressedCodes.current.size > 0;
          commandRef.current({ type: "stop" });
          return;
        }

        boost.phase = "charging";
        boost.direction = chargedDirection;
        lastTap.current = null;
        lastDirection.current = chargedDirection;
        requireNeutralForBoost.current = true;
        commandRef.current({ type: "charge_direction", direction: chargedDirection });
      }, MOVEMENT_RULES.gestureArmMs);
    }

    function handleKeyDown(event: KeyboardEvent) {
      const arenaHasFocus = document.activeElement === targetRef.current;
      if (event.code === "Escape" && arenaHasFocus) {
        if (pressedCodes.current.size > 0 || boostGesture.current || lastTap.current) {
          event.preventDefault();
          clearKeyboardMovement(true);
        }
        return;
      }

      if (
        disabledRef.current ||
        !arenaHasFocus ||
        !isKeyboardMovementCode(event.code) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.isComposing ||
        isKeyboardMovementBlockedTarget(event.target)
      ) return;

      event.preventDefault();
      if (event.repeat || pressedCodes.current.has(event.code)) return;

      const now = performance.now();
      const canStartBoost =
        !requireNeutralForBoost.current &&
        movementModeRef.current !== "burst" &&
        isKeyboardBoostDoubleTap(lastTap.current, event.code, now);
      // Any intervening movement key breaks the double-tap sequence.
      lastTap.current = null;
      takeoverRef.current();
      pressedCodes.current.add(event.code);
      pressedAt.current.set(event.code, now);
      const direction = getKeyboardDirection(pressedCodes.current);
      emitCurrentDirection();
      if (canStartBoost && direction) armKeyboardBoost(event.code, direction);
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (!isKeyboardMovementCode(event.code)) return;
      if (!pressedCodes.current.has(event.code)) return;

      event.preventDefault();
      const releasedAt = performance.now();
      const boost = boostGesture.current;
      const isBoostTrigger = boost?.triggerCode === event.code;
      const keyPressedAt = pressedAt.current.get(event.code);
      pressedCodes.current.delete(event.code);
      pressedAt.current.delete(event.code);

      if (isBoostTrigger && boost) {
        clearBoostArmTimer();
        boostGesture.current = null;
        lastTap.current = null;

        if (boost.phase === "charging") {
          const remainingDirection = getKeyboardDirection(pressedCodes.current);
          commandRef.current({
            type: "release_direction",
            direction: boost.direction,
          });
          lastDirection.current = remainingDirection;
          resumeAfterBoost.current = remainingDirection !== null;
          requireNeutralForBoost.current = pressedCodes.current.size > 0;
          if (remainingDirection) {
            commandRef.current({ type: "walk_direction", direction: remainingDirection });
          }
          return;
        }

        // Releasing before the arm delay keeps the second press as an ordinary
        // movement tap instead of swallowing it.
        if (pressedCodes.current.size === 0) requireNeutralForBoost.current = false;
        emitCurrentDirection();
        return;
      }

      if (boost) {
        // A non-trigger key only changes the directional charge aim.
        emitCurrentDirection();
        return;
      }

      if (
        !requireNeutralForBoost.current &&
        movementModeRef.current !== "burst" &&
        keyPressedAt !== undefined &&
        releasedAt - keyPressedAt <= MOVEMENT_RULES.keyboardBoostTapMaximumMs
      ) {
        lastTap.current = {
          code: event.code,
          pressedAt: keyPressedAt,
          releasedAt,
        };
      } else {
        lastTap.current = null;
      }

      if (requireNeutralForBoost.current && pressedCodes.current.size === 0) {
        requireNeutralForBoost.current = false;
      }
      emitCurrentDirection();
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
    const target = targetRef.current;
    target?.addEventListener("blur", stopKeyboardMovement);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", stopKeyboardMovement);
      document.removeEventListener("visibilitychange", stopWhenHidden);
      target?.removeEventListener("blur", stopKeyboardMovement);
      // Strict Mode mounts effects twice in development; cleanup must not
      // inject a gameplay command during that probe cycle.
      clearKeyboardMovement(false);
    };
  }, [
    clearBoostArmTimer,
    clearKeyboardMovement,
    emitCurrentDirection,
    targetRef,
  ]);

  useEffect(() => {
    if (disabled) clearKeyboardMovement(true);
  }, [clearKeyboardMovement, disabled]);

  useEffect(() => {
    const priorMode = previousMode.current;
    previousMode.current = movementMode;
    const finishedCommittedMovement =
      movementMode !== "burst" &&
      movementMode !== "charging" &&
      (priorMode === "burst" ||
        (resumeAfterBoost.current && priorMode === "charging"));
    if (finishedCommittedMovement && pressedCodes.current.size > 0) {
      emitCurrentDirection(true);
    }
    if (finishedCommittedMovement) resumeAfterBoost.current = false;
  }, [emitCurrentDirection, movementMode]);

  return { clearKeyboardMovement };
}

function sameDirection(a: Vec2 | null, b: Vec2 | null) {
  if (a === null || b === null) return a === b;
  return Math.abs(a.x - b.x) < 0.000001 && Math.abs(a.y - b.y) < 0.000001;
}
