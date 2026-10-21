import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
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
import {
  PRESENTATION_FRAME_PRIORITY,
  subscribePresentationFrame,
} from "../presentation/presentationClock";
import { MOVEMENT_RULES } from "../movement/movement";
import type { MovementState, Vec2 } from "../types";

export interface FollowCameraPresentation {
  readonly camera: CameraViewBox;
  readonly cameraRef: RefObject<CameraViewBox>;
}

export function useFollowCamera(
  targetRef: RefObject<SVGSVGElement | null>,
  centerRef: RefObject<Vec2>,
  initialCenter: Vec2,
  movement: MovementState,
  chargeIntentActive: boolean,
  oxygenZoomMultiplier = 1,
  cameraMode: "follow" | "overview" = "follow",
  onOverviewSettled?: () => void,
): FollowCameraPresentation {
  const aspectRatioRef = useRef(1);
  const hasMeasuredRef = useRef(false);
  const viewportBufferZoomRef = useRef(1);
  const reduceMotionRef = useRef(prefersReducedMotion());
  const springRef = useRef<CameraZoomSpring>({ zoom: 1, velocity: 0 });
  const chargeStartedAtRef = useRef<number | null>(null);
  const chargeIntentRef = useRef(chargeIntentActive);
  const authoritativeProgressRef = useRef(0);
  const oxygenZoomRef = useRef(oxygenZoomMultiplier);
  const cameraModeRef = useRef(cameraMode);
  const overviewSettledRef = useRef(onOverviewSettled);
  const overviewStartRef = useRef<CameraViewBox | null>(null);
  const overviewStartedAtRef = useRef<number | null>(null);
  const overviewSettledNotifiedRef = useRef(false);
  const [camera] = useState<CameraViewBox>(() => calculateCameraViewBox(
    initialCenter,
    1,
    oxygenZoomMultiplier,
  ));
  const cameraRef = useRef(camera);

  useLayoutEffect(() => {
    chargeIntentRef.current = chargeIntentActive;
    oxygenZoomRef.current = oxygenZoomMultiplier;
    cameraModeRef.current = cameraMode;
    overviewSettledRef.current = onOverviewSettled;
    authoritativeProgressRef.current = movement.mode === "charging"
      ? Math.min(1, movement.chargeSeconds / MOVEMENT_RULES.fullChargeSeconds)
      : 0;
  });

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => {
      reduceMotionRef.current = media.matches;
    };
    updatePreference();
    media.addEventListener("change", updatePreference);
    return () => media.removeEventListener("change", updatePreference);
  }, []);

  useLayoutEffect(() => {
    const element = targetRef.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      aspectRatioRef.current = rect.width / rect.height;
      viewportBufferZoomRef.current = calculateViewportBufferZoom(
        window.innerWidth,
        rect.width,
      );
      hasMeasuredRef.current = true;
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

  useLayoutEffect(() => {
    chargeStartedAtRef.current = chargeIntentActive ? performance.now() : null;
  }, [chargeIntentActive]);

  useLayoutEffect(() => {
    if (cameraMode !== "overview") {
      overviewStartRef.current = null;
      overviewStartedAtRef.current = null;
      overviewSettledNotifiedRef.current = false;
      return;
    }
    overviewStartRef.current = { ...cameraRef.current };
    overviewStartedAtRef.current = null;
    overviewSettledNotifiedRef.current = false;
  }, [cameraMode]);

  useEffect(() => subscribePresentationFrame((frame) => {
    const reduceMotion = reduceMotionRef.current;
    const oxygenZoom = oxygenZoomRef.current;
    let zoom = oxygenZoom;
    if (reduceMotion) {
      springRef.current = { zoom: oxygenZoom, velocity: 0 };
    } else {
      const localProgress = chargeIntentRef.current && chargeStartedAtRef.current !== null
        ? Math.min(
            1,
            (frame.timeMs - chargeStartedAtRef.current) /
              (MOVEMENT_RULES.fullChargeSeconds * 1_000),
          )
        : 0;
      const progress = Math.max(localProgress, authoritativeProgressRef.current);
      const targetZoom = oxygenZoom +
        (chargeIntentRef.current ? chargeZoomTarget(progress) - 1 : 0);
      springRef.current = stepCameraZoomSpring(
        springRef.current,
        targetZoom,
        frame.deltaSeconds,
      );
      zoom = springRef.current.zoom;
    }

    const aspectRatio = aspectRatioRef.current;
    const followView = calculateCameraViewBox(
      centerRef.current,
      aspectRatio,
      zoom * viewportBufferZoomRef.current,
    );
    if (cameraModeRef.current !== "overview" || !hasMeasuredRef.current) {
      copyCamera(cameraRef.current, followView);
      return;
    }

    const targetView = calculateOverviewViewBox(aspectRatio);
    if (reduceMotion) {
      copyCamera(cameraRef.current, targetView);
      notifyOverviewSettled();
      return;
    }
    if (!overviewStartRef.current) overviewStartRef.current = followView;
    if (overviewStartedAtRef.current === null) overviewStartedAtRef.current = frame.timeMs;
    const progress = Math.min(
      1,
      (frame.timeMs - overviewStartedAtRef.current) /
        CAMERA_RULES.matchEndOverviewDurationMs,
    );
    copyCamera(cameraRef.current, interpolateCameraViewBox(
      overviewStartRef.current,
      targetView,
      easeMatchEndOverview(progress),
    ));
    if (progress >= 1) notifyOverviewSettled();
  }, PRESENTATION_FRAME_PRIORITY.camera), [centerRef]);

  return { camera, cameraRef };

  function notifyOverviewSettled() {
    if (overviewSettledNotifiedRef.current) return;
    overviewSettledNotifiedRef.current = true;
    overviewSettledRef.current?.();
  }
}

function copyCamera(target: CameraViewBox, source: CameraViewBox) {
  target.x = source.x;
  target.y = source.y;
  target.width = source.width;
  target.height = source.height;
}

function prefersReducedMotion() {
  return typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
