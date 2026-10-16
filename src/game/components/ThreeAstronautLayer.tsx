import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { CameraViewBox } from "../presentation/camera";
import {
  clearThreeBoostChargeSmoke,
  createThreeBoostChargeSmoke,
  disposeThreeBoostChargeSmoke,
  updateThreeBoostChargeSmoke,
  type ThreeBoostChargeSmokeRuntime,
} from "../presentation/threeBoostChargeSmoke";
import {
  clearThreeInteractionEffects,
  createThreeInteractionEffects,
  disposeThreeInteractionEffects,
  updateThreeInteractionEffects,
  type ThreeInteractionEffectsRuntime,
} from "../presentation/threeInteractionEffects";
import {
  collectTerrainLightZones,
  type TerrainLightZone,
} from "../presentation/terrainLighting";
import {
  createThreeAstronautModel,
  disposeThreeAstronautAsset,
  disposeThreeAstronautModel,
  loadThreeAstronautAsset,
  updateThreeAstronautModel,
  type ThreeAstronautRig,
} from "../presentation/threeAstronautModel";
import {
  createThreeGameObjectRuntime,
  disposeThreeGameObjectAssets,
  disposeThreeGameObjectRuntime,
  loadThreeGameObjectAssets,
  updateThreeGameObjectIdleEffects,
  updateThreeGameObjectRuntime,
  type ThreeGameObjectRuntime,
} from "../presentation/threeGameObjectModels";
import {
  createThreeSceneLighting,
  updateThreeSceneLighting,
} from "../presentation/threeSceneLighting";
import type { GameState, PlayerId, Vec2 } from "../types";

interface ThreeAstronautLayerProps {
  state: GameState;
  renderPositions: Readonly<Record<PlayerId, Vec2>>;
  camera: CameraViewBox;
  onReadyChange?: (ready: boolean) => void;
  onObjectReadyChange?: (ready: boolean) => void;
  onLoadError?: (error: unknown) => void;
}

interface LatestFrame {
  state: GameState;
  renderPositions: Readonly<Record<PlayerId, Vec2>>;
  camera: CameraViewBox;
  terrainLightZones: readonly TerrainLightZone[];
}

export default function ThreeAstronautLayer({
  state,
  renderPositions,
  camera,
  onReadyChange,
  onObjectReadyChange,
  onLoadError,
}: ThreeAstronautLayerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terrainLightZones = collectTerrainLightZones(state);
  const latestRef = useRef<LatestFrame>({
    state,
    renderPositions,
    camera,
    terrainLightZones,
  });
  const readyCallbackRef = useRef(onReadyChange);
  const objectReadyCallbackRef = useRef(onObjectReadyChange);
  latestRef.current = { state, renderPositions, camera, terrainLightZones };
  readyCallbackRef.current = onReadyChange;
  objectReadyCallbackRef.current = onObjectReadyChange;
  const playerKey = state.activePlayerIds.join("|");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let animationFrame = 0;
    let cancelled = false;
    let contextLost = false;
    let loadFailureReported = false;
    let resizeDirty = true;
    let renderer: THREE.WebGLRenderer | null = null;
    let boostSmokeRuntime: ThreeBoostChargeSmokeRuntime | null = null;
    let interactionEffectsRuntime: ThreeInteractionEffectsRuntime | null = null;
    let astronautRenderReady = false;
    let astronautAssetsReady = false;
    let objectRenderReady = false;
    let objectAssetsReady = false;
    let previousFrameMs: number | null = null;
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduceMotion = motionPreference.matches;
    const handleMotionPreference = (event: MediaQueryListEvent) => {
      reduceMotion = event.matches;
      if (reduceMotion && interactionEffectsRuntime) {
        clearThreeInteractionEffects(
          interactionEffectsRuntime,
          latestRef.current.state,
        );
      }
    };
    motionPreference.addEventListener("change", handleMotionPreference);
    const handleVisibilityChange = () => {
      previousFrameMs = null;
      if (interactionEffectsRuntime) {
        clearThreeInteractionEffects(
          interactionEffectsRuntime,
          latestRef.current.state,
        );
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const scene = new THREE.Scene();
    const viewCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 180);
    viewCamera.up.set(0, 1, 0);
    const rigs = new Map<PlayerId, ThreeAstronautRig>();
    let objectRuntime: ThreeGameObjectRuntime | null = null;
    let reconciledObjectState: GameState | null = null;
    let reconciledObjectElapsedMs = -1;

    const initial = latestRef.current;
    const sceneLighting = createThreeSceneLighting(
      initial.camera,
      initial.terrainLightZones,
    );
    scene.add(sceneLighting.hemisphere, sceneLighting.key, sceneLighting.fill);

    const resizeObserver = new ResizeObserver(() => {
      resizeDirty = true;
    });
    resizeObserver.observe(host);

    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
        premultipliedAlpha: true,
      });
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
      renderer.shadowMap.enabled = false;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = sceneLighting.exposure;
      renderer.domElement.className = "three-astronaut-layer__canvas";
      renderer.domElement.setAttribute("aria-hidden", "true");
      renderer.domElement.addEventListener("webglcontextlost", handleContextLost);
      renderer.domElement.addEventListener("webglcontextrestored", handleContextRestored);
      host.appendChild(renderer.domElement);
      boostSmokeRuntime = createThreeBoostChargeSmoke(latestRef.current.state.activePlayerIds);
      scene.add(boostSmokeRuntime.mesh);
      interactionEffectsRuntime = createThreeInteractionEffects(latestRef.current.state);
      scene.add(interactionEffectsRuntime.mesh);
    } catch (error) {
      console.error("Unable to initialize 3D astronaut renderer", error);
      reportLoadFailure(error);
      resizeObserver.disconnect();
      motionPreference.removeEventListener("change", handleMotionPreference);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (interactionEffectsRuntime) {
        disposeThreeInteractionEffects(interactionEffectsRuntime);
      }
      if (boostSmokeRuntime) disposeThreeBoostChargeSmoke(boostSmokeRuntime);
      for (const rig of rigs.values()) disposeThreeAstronautModel(rig);
      if (renderer) {
        renderer.domElement.removeEventListener("webglcontextlost", handleContextLost);
        renderer.domElement.removeEventListener("webglcontextrestored", handleContextRestored);
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      }
      return;
    }

    const requestedPlayerIds = [...latestRef.current.state.activePlayerIds];
    void Promise.allSettled(
      requestedPlayerIds.map(async (playerId) => ({
        playerId,
        asset: await loadThreeAstronautAsset(playerId),
      })),
    ).then((results) => {
      const loaded = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : []
      );
      const failed = results.find((result) => result.status === "rejected");
      if (cancelled || failed || loadFailureReported) {
        for (const { asset } of loaded) disposeThreeAstronautAsset(asset);
        if (failed) {
          console.error("Unable to load a 3D astronaut model", failed.reason);
          reportLoadFailure(failed.reason);
        }
        return;
      }

      const pendingRigs: Array<{ playerId: PlayerId; rig: ThreeAstronautRig }> = [];
      try {
        for (const { playerId, asset } of loaded) {
          pendingRigs.push({
            playerId,
            rig: createThreeAstronautModel(playerId, asset),
          });
        }
      } catch (error) {
        const consumedScenes = new Set(pendingRigs.map(({ rig }) => rig.source));
        for (const { rig } of pendingRigs) disposeThreeAstronautModel(rig);
        for (const { asset } of loaded) {
          if (!consumedScenes.has(asset.scene)) disposeThreeAstronautAsset(asset);
        }
        console.error("Unable to create a 3D astronaut model", error);
        reportLoadFailure(error);
        return;
      }

      for (const { playerId, rig } of pendingRigs) {
        rigs.set(playerId, rig);
        scene.add(rig.root);
      }
      astronautAssetsReady = true;
    });

    // Start every required model request together. The outer readiness gate
    // keeps the world concealed until both groups have rendered atomically.
    void loadThreeGameObjectAssets(requestedPlayerIds).then((assets) => {
      if (cancelled || loadFailureReported) {
        disposeThreeGameObjectAssets(assets);
        return;
      }
      try {
        objectRuntime = createThreeGameObjectRuntime(
          assets,
          latestRef.current.state,
          reduceMotion,
        );
        scene.add(objectRuntime.root);
        reconciledObjectState = latestRef.current.state;
        reconciledObjectElapsedMs = latestRef.current.state.elapsedMs;
        objectAssetsReady = true;
      } catch (error) {
        disposeThreeGameObjectAssets(assets);
        console.error("Unable to create 3D game objects", error);
        reportLoadFailure(error);
      }
    }).catch((error) => {
      if (!cancelled) {
        console.error("Unable to load 3D game objects", error);
        reportLoadFailure(error);
      }
    });

    const draw = (timeMs: number) => {
      if (cancelled || !renderer) return;
      const deltaSeconds = previousFrameMs === null
        ? 0
        : Math.min(0.1, Math.max(0, (timeMs - previousFrameMs) / 1000));
      previousFrameMs = timeMs;
      if (document.hidden || contextLost) {
        animationFrame = requestAnimationFrame(draw);
        return;
      }
      const latest = latestRef.current;
      if (resizeDirty) {
        renderer.setSize(
          Math.max(1, host.clientWidth),
          Math.max(1, host.clientHeight),
          false,
        );
        resizeDirty = false;
      }

      positionCamera(viewCamera, latest.camera);
      renderer.toneMappingExposure = updateThreeSceneLighting(
        sceneLighting,
        latest.camera,
        latest.terrainLightZones,
        deltaSeconds,
      );
      for (const playerId of latest.state.activePlayerIds) {
        const rig = rigs.get(playerId);
        if (!rig) continue;
        updateThreeAstronautModel(
          rig,
          latest.state.players[playerId].astronaut,
          latest.renderPositions[playerId],
          deltaSeconds,
          reduceMotion,
        );
      }
      if (boostSmokeRuntime) {
        updateThreeBoostChargeSmoke(
          boostSmokeRuntime,
          latest.state,
          latest.renderPositions,
          deltaSeconds,
          reduceMotion,
        );
      }
      if (objectRuntime) {
        if (
          reconciledObjectState !== latest.state
          || reconciledObjectElapsedMs !== latest.state.elapsedMs
        ) {
          updateThreeGameObjectRuntime(
            objectRuntime,
            latest.state,
            reduceMotion,
            timeMs,
          );
          reconciledObjectState = latest.state;
          reconciledObjectElapsedMs = latest.state.elapsedMs;
        } else {
          updateThreeGameObjectIdleEffects(objectRuntime, timeMs, reduceMotion);
        }
      }
      if (interactionEffectsRuntime) {
        updateThreeInteractionEffects(
          interactionEffectsRuntime,
          latest.state,
          deltaSeconds,
          reduceMotion,
        );
      }
      renderer.render(scene, viewCamera);
      if (astronautAssetsReady && !astronautRenderReady) {
        astronautRenderReady = true;
        readyCallbackRef.current?.(true);
      }
      if (objectAssetsReady && !objectRenderReady) {
        objectRenderReady = true;
        objectReadyCallbackRef.current?.(true);
      }
      if (!cancelled) animationFrame = requestAnimationFrame(draw);
    };

    animationFrame = requestAnimationFrame(draw);

    return () => {
      cancelled = true;
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      motionPreference.removeEventListener("change", handleMotionPreference);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      readyCallbackRef.current?.(false);
      objectReadyCallbackRef.current?.(false);
      if (interactionEffectsRuntime) {
        disposeThreeInteractionEffects(interactionEffectsRuntime);
      }
      if (boostSmokeRuntime) disposeThreeBoostChargeSmoke(boostSmokeRuntime);
      for (const rig of rigs.values()) disposeThreeAstronautModel(rig);
      if (objectRuntime) disposeThreeGameObjectRuntime(objectRuntime);
      if (renderer) {
        renderer.domElement.removeEventListener("webglcontextlost", handleContextLost);
        renderer.domElement.removeEventListener("webglcontextrestored", handleContextRestored);
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      }
    };

    function handleContextLost(event: Event) {
      event.preventDefault();
      contextLost = true;
      astronautRenderReady = false;
      objectRenderReady = false;
      if (boostSmokeRuntime) clearThreeBoostChargeSmoke(boostSmokeRuntime);
      if (interactionEffectsRuntime) {
        clearThreeInteractionEffects(
          interactionEffectsRuntime,
          latestRef.current.state,
        );
      }
      readyCallbackRef.current?.(false);
      objectReadyCallbackRef.current?.(false);
      reportLoadFailure(new Error("The 3D rendering context was lost."));
    }

    function handleContextRestored() {
      contextLost = false;
      astronautRenderReady = false;
      objectRenderReady = false;
      resizeDirty = true;
      if (interactionEffectsRuntime) {
        clearThreeInteractionEffects(
          interactionEffectsRuntime,
          latestRef.current.state,
        );
      }
    }

    function reportLoadFailure(error: unknown) {
      if (cancelled || loadFailureReported) return;
      loadFailureReported = true;
      onLoadError?.(error);
    }
  }, [onLoadError, playerKey]);

  return <div ref={hostRef} className="three-astronaut-layer" aria-hidden="true" />;
}

function positionCamera(camera: THREE.OrthographicCamera, view: CameraViewBox) {
  const centerX = view.x + view.width / 2;
  const centerY = -(view.y + view.height / 2);
  camera.left = -view.width / 2;
  camera.right = view.width / 2;
  camera.top = view.height / 2;
  camera.bottom = -view.height / 2;
  camera.position.set(centerX, centerY, 100);
  camera.lookAt(centerX, centerY, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}
