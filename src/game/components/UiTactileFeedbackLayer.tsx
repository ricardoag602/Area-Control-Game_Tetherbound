import { useEffect, useLayoutEffect, useRef } from "react";
import { normalizeAudioVolume } from "../audio/gameAudio";

interface UiTactileFeedbackLayerProps {
  enabled: boolean;
  volume: number;
}

interface AudioContextWindow extends Window {
  webkitAudioContext?: typeof AudioContext;
}

const INTERACTIVE_SELECTOR = [
  "button",
  "summary",
  'input[type="checkbox"]',
  'input[type="radio"]',
  '[role="button"]',
  '[role="switch"]',
].join(",");

const TACTILE_DISABLED_SELECTOR = '[data-tactile-feedback="off"]';
const CLICK_MIX_SCALE = 0.7 * 0.9;

/** Returns true when a click should receive shared tactile UI feedback. */
export function isTactileFeedbackTarget(target: EventTarget | null) {
  if (!target || typeof (target as Element).closest !== "function") return false;
  const control = (target as Element).closest<HTMLElement>(INTERACTIVE_SELECTOR);
  if (!control || control.closest(TACTILE_DISABLED_SELECTOR)) return false;
  if ("disabled" in control && Boolean(control.disabled)) return false;
  return control.getAttribute("aria-disabled") !== "true";
}

/**
 * Adds one consistent, subtle click and haptic pulse to app controls. The
 * listener runs in the bubble phase so toggling Audio on can unlock its click
 * using the newly committed preference.
 */
export function UiTactileFeedbackLayer({
  enabled,
  volume,
}: UiTactileFeedbackLayerProps) {
  const latestRef = useRef({ enabled, volume });

  useLayoutEffect(() => {
    latestRef.current = { enabled, volume };
  }, [enabled, volume]);

  useEffect(() => {
    let context: AudioContext | null = null;
    let disposed = false;
    const activeSources = new Set<OscillatorNode>();

    const scheduleClick = (audioContext: AudioContext, clickVolume: number) => {
      if (disposed || audioContext.state !== "running") return;
      const normalizedVolume = normalizeAudioVolume(clickVolume);
      if (normalizedVolume <= 0) return;

      const time = audioContext.currentTime + 0.004;
      const oscillator = audioContext.createOscillator();
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(510, time);
      oscillator.frequency.exponentialRampToValueAtTime(285, time + 0.035);

      const envelope = audioContext.createGain();
      const peak = 0.026 * normalizedVolume * CLICK_MIX_SCALE;
      envelope.gain.setValueAtTime(0.0001, time);
      envelope.gain.exponentialRampToValueAtTime(peak, time + 0.002);
      envelope.gain.exponentialRampToValueAtTime(0.0001, time + 0.048);

      oscillator.connect(envelope).connect(audioContext.destination);
      activeSources.add(oscillator);
      oscillator.addEventListener("ended", () => {
        activeSources.delete(oscillator);
        oscillator.disconnect();
        envelope.disconnect();
      }, { once: true });
      oscillator.start(time);
      oscillator.stop(time + 0.055);
    };

    const playClick = () => {
      const latest = latestRef.current;
      const normalizedVolume = normalizeAudioVolume(latest.volume);
      if (!latest.enabled || normalizedVolume <= 0 || document.hidden) return;

      if (!context) {
        const ContextClass = audioContextConstructor();
        if (!ContextClass) return;
        try {
          context = new ContextClass({ latencyHint: "interactive" });
        } catch {
          context = null;
          return;
        }
      }

      const current = context;
      if (current.state === "suspended") {
        void current.resume().then(() => {
          if (!disposed && latestRef.current.enabled) {
            scheduleClick(current, latestRef.current.volume);
          }
        }).catch(() => undefined);
      } else {
        scheduleClick(current, latest.volume);
      }
    };

    const handleClick = (event: MouseEvent) => {
      if (!isTactileFeedbackTarget(event.target)) return;
      pulseHaptic();
      playClick();
    };

    const handleVisibilityChange = () => {
      if (!document.hidden || !context || context.state !== "running") return;
      void context.suspend().catch(() => undefined);
    };

    window.addEventListener("click", handleClick);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposed = true;
      window.removeEventListener("click", handleClick);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      for (const source of activeSources) {
        try {
          source.stop();
        } catch {
          // A click that already ended is safe to ignore during cleanup.
        }
      }
      activeSources.clear();
      if (context && context.state !== "closed") {
        void context.close().catch(() => undefined);
      }
      context = null;
    };
  }, []);

  return null;
}

function pulseHaptic() {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(7);
  } catch {
    // Unsupported vibration policies are intentionally silent.
  }
}

function audioContextConstructor() {
  if (typeof window === "undefined") return null;
  const audioWindow = window as AudioContextWindow;
  return window.AudioContext ?? audioWindow.webkitAudioContext ?? null;
}
