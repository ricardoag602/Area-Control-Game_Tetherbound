import { useEffect, useLayoutEffect, useRef } from "react";
import {
  createGameAudioRuntime,
  disposeGameAudio,
  resetGameAudioBaseline,
  resumeGameAudio,
  suspendGameAudio,
  updateGameAudio,
  type GameAudioRuntime,
} from "../audio/gameAudio";
import {
  PRESENTATION_FRAME_PRIORITY,
  subscribePresentationFrame,
} from "../presentation/presentationClock";
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
  const processedStateRef = useRef<GameState | null>(null);
  useLayoutEffect(() => {
    latestRef.current = { state, enabled, disabled };
  }, [disabled, enabled, state]);

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
        processedStateRef.current = latest.state;
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
        processedStateRef.current = latestRef.current.state;
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
    // Audio follows the latest authoritative snapshot after the visual layers
    // have rendered. This keeps audio graph reconciliation out of React's
    // commit path and coalesces multiple snapshots that arrive in one frame.
    const unsubscribeFrame = subscribePresentationFrame(() => {
      const runtime = runtimeRef.current;
      const latest = latestRef.current;
      if (
        !runtime
        || blockedRef.current
        || !latest.enabled
        || latest.disabled
        || document.hidden
        || runtime.context.state !== "running"
        || processedStateRef.current === latest.state
      ) {
        return;
      }
      updateGameAudio(runtime, latest.state);
      processedStateRef.current = latest.state;
    }, PRESENTATION_FRAME_PRIORITY.overlay + 100);

    return () => {
      cancelled = true;
      unsubscribeFrame();
      window.removeEventListener("pointerdown", resumeCurrentRuntime, true);
      window.removeEventListener("keydown", resumeCurrentRuntime, true);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      disposeGameAudio(runtimeRef.current);
      runtimeRef.current = null;
      processedStateRef.current = null;
    };
  }, [localPlayerId]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    const latest = latestRef.current;
    const blocked = !latest.enabled || latest.disabled || document.hidden;
    if (!runtime) {
      blockedRef.current = blocked;
      return;
    }

    if (!latest.enabled) {
      disposeGameAudio(runtime);
      runtimeRef.current = null;
      processedStateRef.current = null;
      blockedRef.current = true;
      return;
    }

    if (blocked) {
      resetGameAudioBaseline(runtime, latest.state);
      processedStateRef.current = latest.state;
      suspendGameAudio(runtime);
      blockedRef.current = true;
      return;
    }

    if (blockedRef.current) {
      resetGameAudioBaseline(runtime, latest.state);
      processedStateRef.current = latest.state;
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
        processedStateRef.current = latestRef.current.state;
      });
    }
  }, [disabled, enabled]);

  return null;
}
