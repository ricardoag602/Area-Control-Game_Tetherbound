import { useEffect, useRef } from "react";
import {
  createGameAudioRuntime,
  disposeGameAudio,
  resetGameAudioBaseline,
  resumeGameAudio,
  suspendGameAudio,
  updateGameAudio,
  type GameAudioRuntime,
} from "../audio/gameAudio";
import type { GameState, PlayerId } from "../types";

interface GameAudioLayerProps {
  state: GameState;
  localPlayerId: PlayerId;
  enabled: boolean;
  disabled?: boolean;
}

interface LatestAudioFrame {
  state: GameState;
  enabled: boolean;
  disabled: boolean;
}

/**
 * Owns the browser-only audio lifetime for one match. The AudioContext is
 * deliberately created from a trusted input handler rather than during render
 * so mobile autoplay policies can unlock it without preloading silent audio.
 */
export function GameAudioLayer({
  state,
  localPlayerId,
  enabled,
  disabled = false,
}: GameAudioLayerProps) {
  const runtimeRef = useRef<GameAudioRuntime | null>(null);
  const latestRef = useRef<LatestAudioFrame>({ state, enabled, disabled });
  const blockedRef = useRef(disabled || !enabled);
  latestRef.current = { state, enabled, disabled };

  useEffect(() => {
    let cancelled = false;

    const resumeCurrentRuntime = () => {
      const latest = latestRef.current;
      if (!latest.enabled || latest.disabled || document.hidden) return;

      let runtime = runtimeRef.current;
      if (!runtime) {
        runtime = createGameAudioRuntime(latest.state, localPlayerId);
        if (!runtime) return;
        runtimeRef.current = runtime;
        updateGameAudio(runtime, latest.state);
      } else if (runtime.context.state === "running" && !blockedRef.current) {
        return;
      }

      const resumedRuntime = runtime;
      resetGameAudioBaseline(resumedRuntime, latest.state);
      blockedRef.current = false;
      void resumeGameAudio(resumedRuntime).then(() => {
        if (
          cancelled
          || runtimeRef.current !== resumedRuntime
          || !latestRef.current.enabled
          || latestRef.current.disabled
          || document.hidden
        ) {
          return;
        }
        // Refresh continuous biome, charge, and network layers without
        // replaying events that occurred while audio was suspended.
        resetGameAudioBaseline(resumedRuntime, latestRef.current.state);
        updateGameAudio(resumedRuntime, latestRef.current.state);
      });
    };

    const handleVisibilityChange = () => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      resetGameAudioBaseline(runtime, latestRef.current.state);
      blockedRef.current =
        document.hidden || !latestRef.current.enabled || latestRef.current.disabled;
      if (blockedRef.current) {
        suspendGameAudio(runtime);
      } else {
        resumeCurrentRuntime();
      }
    };

    window.addEventListener("pointerdown", resumeCurrentRuntime, true);
    window.addEventListener("keydown", resumeCurrentRuntime, true);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.removeEventListener("pointerdown", resumeCurrentRuntime, true);
      window.removeEventListener("keydown", resumeCurrentRuntime, true);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      disposeGameAudio(runtimeRef.current);
      runtimeRef.current = null;
    };
  }, [localPlayerId]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    const blocked = !enabled || disabled || document.hidden;
    if (!runtime) {
      blockedRef.current = blocked;
      return;
    }

    if (!enabled) {
      disposeGameAudio(runtime);
      runtimeRef.current = null;
      blockedRef.current = true;
      return;
    }

    if (blocked) {
      resetGameAudioBaseline(runtime, state);
      suspendGameAudio(runtime);
      blockedRef.current = true;
      return;
    }

    if (blockedRef.current) {
      resetGameAudioBaseline(runtime, state);
      blockedRef.current = false;
      void resumeGameAudio(runtime).then(() => {
        if (
          runtimeRef.current !== runtime
          || !latestRef.current.enabled
          || latestRef.current.disabled
          || document.hidden
        ) {
          return;
        }
        resetGameAudioBaseline(runtime, latestRef.current.state);
        updateGameAudio(runtime, latestRef.current.state);
      });
      return;
    }

    updateGameAudio(runtime, state);
  }, [disabled, enabled, state]);

  return null;
}
