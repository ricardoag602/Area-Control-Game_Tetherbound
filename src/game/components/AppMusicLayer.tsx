import { useEffect, useLayoutEffect, useRef } from "react";
import {
  createGameMusicRuntime,
  disposeGameMusicRuntime,
  updateGameMusic,
  type GameMusicPresentation,
  type GameMusicRuntime,
} from "../audio/gameMusic";
import { normalizeAudioVolume } from "../audio/gameAudio";

interface AppMusicLayerProps {
  enabled: boolean;
  presentation: GameMusicPresentation;
  volume: number;
}

interface AppMusicRuntime {
  readonly context: AudioContext;
  readonly music: GameMusicRuntime;
  readonly volumeGain: GainNode;
  appliedVolume: number;
}

interface AudioContextWindow extends Window {
  webkitAudioContext?: typeof AudioContext;
}

/**
 * Owns one music context for the full app lifetime. Keeping this layer above
 * the view switch lets the ambient menu arrangement flow into the match and
 * gives the final cadence time to ring after the match screen unmounts.
 */
export function AppMusicLayer({ enabled, presentation, volume }: AppMusicLayerProps) {
  const runtimeRef = useRef<AppMusicRuntime | null>(null);
  const latestRef = useRef({ enabled, presentation, volume });
  const disposeCurrentRef = useRef<() => void>(() => undefined);

  useLayoutEffect(() => {
    latestRef.current = { enabled, presentation, volume };
  }, [enabled, presentation, volume]);

  useEffect(() => {
    let disposed = false;

    const disposeCurrent = () => {
      const current = runtimeRef.current;
      if (!current) return;
      runtimeRef.current = null;
      disposeGameMusicRuntime(current.music);
      current.volumeGain.disconnect();
      if (current.context.state !== "closed") {
        void current.context.close().catch(() => undefined);
      }
    };
    disposeCurrentRef.current = disposeCurrent;

    const tick = () => {
      const current = runtimeRef.current;
      const latest = latestRef.current;
      if (
        !current
        || !latest.enabled
        || document.hidden
        || current.context.state !== "running"
      ) {
        return;
      }
      setMusicRuntimeVolume(current, latest.volume);
      updateGameMusic(current.music, current.context, latest.presentation);
    };

    const resumeFromGesture = () => {
      const latest = latestRef.current;
      if (disposed || !latest.enabled || document.hidden) return;

      let current = runtimeRef.current;
      if (!current) {
        const ContextClass = audioContextConstructor();
        if (!ContextClass) return;
        try {
          const context = new ContextClass({ latencyHint: "playback" });
          const activeSources = new Set<AudioScheduledSourceNode>();
          const initialVolume = normalizeAudioVolume(latest.volume);
          const volumeGain = context.createGain();
          volumeGain.gain.value = initialVolume;
          volumeGain.connect(context.destination);
          const music = createGameMusicRuntime(
            context,
            volumeGain,
            activeSources,
          );
          current = {
            context,
            music,
            volumeGain,
            appliedVolume: initialVolume,
          };
          runtimeRef.current = current;
        } catch (error) {
          console.warn("Unable to initialize soundtrack", error);
          return;
        }
      }

      const resumed = current;
      const afterResume = () => {
        if (
          disposed
          || runtimeRef.current !== resumed
          || !latestRef.current.enabled
          || document.hidden
          || resumed.context.state !== "running"
        ) {
          return;
        }
        setMusicRuntimeVolume(resumed, latestRef.current.volume);
        updateGameMusic(
          resumed.music,
          resumed.context,
          latestRef.current.presentation,
        );
      };

      if (resumed.context.state === "suspended") {
        void resumed.context.resume().then(afterResume).catch(() => undefined);
      } else {
        afterResume();
      }
    };

    const handleVisibilityChange = () => {
      const current = runtimeRef.current;
      if (!current) return;
      if (document.hidden && current.context.state === "running") {
        void current.context.suspend().catch(() => undefined);
      } else if (!document.hidden) {
        // Once the soundtrack has been unlocked by a gesture, browsers allow
        // it to resume after a background-tab suspension in most cases.
        resumeFromGesture();
      }
    };

    window.addEventListener("pointerdown", resumeFromGesture, true);
    window.addEventListener("keydown", resumeFromGesture, true);
    // Bubble-phase events see a just-enabled Audio toggle after React has
    // committed it, while capture-phase events unlock every other first input.
    window.addEventListener("click", resumeFromGesture);
    window.addEventListener("keyup", resumeFromGesture);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const scheduler = window.setInterval(tick, 120);

    return () => {
      disposed = true;
      window.clearInterval(scheduler);
      window.removeEventListener("pointerdown", resumeFromGesture, true);
      window.removeEventListener("keydown", resumeFromGesture, true);
      window.removeEventListener("click", resumeFromGesture);
      window.removeEventListener("keyup", resumeFromGesture);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      disposeCurrent();
      disposeCurrentRef.current = () => undefined;
    };
  }, []);

  useEffect(() => {
    if (!enabled) disposeCurrentRef.current();
  }, [enabled]);

  useEffect(() => {
    const current = runtimeRef.current;
    if (current) setMusicRuntimeVolume(current, volume);
  }, [volume]);

  return null;
}

function setMusicRuntimeVolume(runtime: AppMusicRuntime, volume: number) {
  const normalized = normalizeAudioVolume(volume);
  if (Math.abs(normalized - runtime.appliedVolume) <= 0.0001) return;
  const now = runtime.context.currentTime;
  runtime.volumeGain.gain.cancelScheduledValues(now);
  runtime.volumeGain.gain.setTargetAtTime(normalized, now, 0.035);
  runtime.appliedVolume = normalized;
}

function audioContextConstructor() {
  if (typeof window === "undefined") return null;
  const audioWindow = window as AudioContextWindow;
  return window.AudioContext ?? audioWindow.webkitAudioContext ?? null;
}
