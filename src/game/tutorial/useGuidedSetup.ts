import { useEffect, useRef, useState } from "react";
import type { GameState, PlayerId } from "../types";
import {
  GUIDED_SETUP_STEPS,
  advanceGuidedSetup,
  createGuidedSetupProgress,
  type GuidedSetupProgress,
} from "./guidedSetup";

/**
 * Observes every authoritative snapshot without forcing a second game render
 * for each movement tick. React state changes only when the guide presentation
 * actually advances, completes, or is disabled.
 */
export function useGuidedSetup(
  state: GameState,
  playerId: PlayerId,
  enabled: boolean,
) {
  const progressRef = useRef<GuidedSetupProgress | null>(null);
  if (progressRef.current === null) {
    progressRef.current = createGuidedSetupProgress(state, playerId, enabled);
  }
  const [visibleProgress, setVisibleProgress] = useState<GuidedSetupProgress>(
    () => progressRef.current!,
  );
  const lifecycleRef = useRef({
    enabled,
    elapsedMs: state.elapsedMs,
    matchPhase: state.matchPhase,
    playerId,
  });

  useEffect(() => {
    const lifecycle = lifecycleRef.current;
    const identityChanged = lifecycle.enabled !== enabled ||
      lifecycle.playerId !== playerId;
    const newSetupStarted = state.matchPhase === "setup" && (
      lifecycle.matchPhase !== "setup" ||
      state.elapsedMs + 500 < lifecycle.elapsedMs
    );
    lifecycleRef.current = {
      enabled,
      elapsedMs: state.elapsedMs,
      matchPhase: state.matchPhase,
      playerId,
    };

    if (identityChanged || newSetupStarted) {
      const reset = createGuidedSetupProgress(state, playerId, enabled);
      progressRef.current = reset;
      setVisibleProgress(reset);
      return;
    }

    const previous = progressRef.current!;
    const next = advanceGuidedSetup(previous, state, playerId);
    progressRef.current = next;
    if (!hasSamePresentation(previous, next)) setVisibleProgress(next);
  }, [enabled, playerId, state]);

  return { progress: visibleProgress };
}

function hasSamePresentation(
  left: GuidedSetupProgress,
  right: GuidedSetupProgress,
) {
  return left.status === right.status &&
    left.materialsCollected === right.materialsCollected &&
    left.materialsAvailable === right.materialsAvailable &&
    GUIDED_SETUP_STEPS.every(
      (step) => left.completed[step] === right.completed[step],
    );
}
