import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  CAMERA_RULES,
  calculateCameraViewBox,
  calculateOverviewViewBox,
  calculateViewportBufferZoom,
  chargeZoomTarget,
  easeMatchEndOverview,
  interpolateCameraViewBox,
  stepCameraZoomSpring,
  type CameraViewBox,
  type CameraZoomSpring,
} from "../presentation/camera";
import { MOVEMENT_RULES } from "../movement/movement";
import type { MovementState, Vec2 } from "../types";

export function useFollowCamera(
  targetRef: RefObject<SVGSVGElement | null>,
  center: Vec2,
  movement: MovementState,
  chargeIntentActive: boolean,
  oxygenZoomMultiplier = 1,
  cameraMode: "follow" | "overview" = "follow",
  onOverviewSettled?: () => void,
) {
  const [aspectRatio, setAspectRatio] = useState(1);
  const [hasMeasured, setHasMeasured] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [viewportBufferZoom, setViewportBufferZoom] = useState(1);
  const [overviewView, setOverviewView] = useState<CameraViewBox | null>(null);
  const [reduceMotion, setReduceMotion] = useState(prefersReducedMotion);
  const springRef = useRef<CameraZoomSpring>({ zoom: 1, velocity: 0 });
  const chargeStartedAt = useRef<number | null>(null);
  const chargeIntentRef = useRef(chargeIntentActive);
  const authoritativeProgressRef = useRef(0);
  const oxygenZoomRef = useRef(oxygenZoomMultiplier);
  const overviewSettledRef = useRef(onOverviewSettled);
  const centerRef = useRef(center);
  useLayoutEffect(() => {
    centerRef.current = center;
    chargeIntentRef.current = chargeIntentActive;
    oxygenZoomRef.current = oxygenZoomMultiplier;
    overviewSettledRef.current = onOverviewSettled;
    authoritativeProgressRef.current = movement.mode === "charging"
      ? Math.min(1, movement.chargeSeconds / MOVEMENT_RULES.fullChargeSeconds)
      : 0;
  });

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReduceMotion(media.matches);
    updatePreference();
    media.addEventListener("change", updatePreference);
    return () => media.removeEventListener("change", updatePreference);
  }, []);

  // Layout measurement happens before paint so the first visible frame already
  // uses the arena's real portrait/desktop aspect ratio.
  useLayoutEffect(() => {
    const element = targetRef.current;
    if (!element) return;

    const measure = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const nextAspect = rect.width / rect.height;
        setAspectRatio((current) =>
          Math.abs(current - nextAspect) > 0.0001 ? nextAspect : current,
        );
        const nextBufferZoom = calculateViewportBufferZoom(
          window.innerWidth,
          rect.width,
        );
        setViewportBufferZoom((current) =>
          Math.abs(current - nextBufferZoom) > 0.0001
            ? nextBufferZoom
            : current,
        );
        setHasMeasured(true);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [targetRef]);

  useEffect(() => {
    if (chargeIntentActive) {
      chargeStartedAt.current = performance.now();
    } else {
      chargeStartedAt.current = null;
    }
  }, [chargeIntentActive]);

  // Wake the animation only while charge progress or the spring is changing.
  // Local input intent starts and releases the effect immediately; server
  // progress then reconciles it without making camera feel depend on latency.
  useEffect(() => {
    if (reduceMotion) {
      springRef.current = { zoom: oxygenZoomMultiplier, velocity: 0 };
      setZoom(oxygenZoomMultiplier);
      return;
    }

    let frameId = 0;
    let previousTime = performance.now();
    const frame = (time: number) => {
      const elapsedSeconds = Math.max(0, (time - previousTime) / 1_000);
      previousTime = time;
      const localProgress = chargeIntentRef.current && chargeStartedAt.current !== null
        ? Math.min(
            1,
            (time - chargeStartedAt.current) /
              (MOVEMENT_RULES.fullChargeSeconds * 1_000),
          )
        : 0;
      const progress = Math.max(
        localProgress,
        authoritativeProgressRef.current,
      );
      const targetZoom = oxygenZoomRef.current +
        (chargeIntentRef.current ? chargeZoomTarget(progress) - 1 : 0);
      const spring = stepCameraZoomSpring(
        springRef.current,
        targetZoom,
        elapsedSeconds,
      );
      springRef.current = spring;
      setZoom((current) =>
        Math.abs(current - spring.zoom) > 0.00001 ? spring.zoom : current,
      );

      const progressStillChanging =
        chargeIntentRef.current && localProgress < 1;
      const springUnsettled =
        Math.abs(targetZoom - spring.zoom) > CAMERA_RULES.springSettleDistance ||
        Math.abs(spring.velocity) > CAMERA_RULES.springSettleVelocity;
      if (progressStillChanging || springUnsettled) {
        frameId = requestAnimationFrame(frame);
      }
    };

    frameId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameId);
  }, [
    chargeIntentActive,
    movement.chargeSeconds,
    movement.mode,
    oxygenZoomMultiplier,
    reduceMotion,
  ]);

  useEffect(() => {
    if (cameraMode !== "overview") {
      setOverviewView(null);
      return;
    }
    if (!hasMeasured) return;

    const startView = calculateCameraViewBox(
      centerRef.current,
      aspectRatio,
      (reduceMotion ? oxygenZoomMultiplier : springRef.current.zoom) *
        viewportBufferZoom,
    );
    const targetView = calculateOverviewViewBox(aspectRatio);

    if (reduceMotion) {
      setOverviewView(targetView);
      overviewSettledRef.current?.();
      return;
    }

    let frameId = 0;
    let startedAt: number | null = null;
    const frame = (time: number) => {
      if (startedAt === null) startedAt = time;
      const progress = Math.min(
        1,
        (time - startedAt) / CAMERA_RULES.matchEndOverviewDurationMs,
      );
      setOverviewView(interpolateCameraViewBox(
        startView,
        targetView,
        easeMatchEndOverview(progress),
      ));
      if (progress < 1) {
        frameId = requestAnimationFrame(frame);
      } else {
        overviewSettledRef.current?.();
      }
    };

    setOverviewView(startView);
    frameId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameId);
  }, [
    aspectRatio,
    cameraMode,
    hasMeasured,
    oxygenZoomMultiplier,
    reduceMotion,
    viewportBufferZoom,
  ]);

  const followView = calculateCameraViewBox(
    center,
    aspectRatio,
    (reduceMotion ? oxygenZoomMultiplier : zoom) * viewportBufferZoom,
  );
  return cameraMode === "overview" && overviewView
    ? overviewView
    : followView;
}

function prefersReducedMotion() {
  return typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
