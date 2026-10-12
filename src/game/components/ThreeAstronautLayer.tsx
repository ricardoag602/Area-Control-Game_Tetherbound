import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { CameraViewBox } from "../presentation/camera";
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
  updateThreeGameObjectRuntime,
  type ThreeGameObjectRuntime,
} from "../presentation/threeGameObjectModels";
import type { GameState, PlayerId, Vec2 } from "../types";

interface ThreeAstronautLayerProps {
  state: GameState;
  renderPositions: Readonly<Record<PlayerId, Vec2>>;
  camera: CameraViewBox;
  onReadyChange?: (ready: boolean) => void;
  onObjectReadyChange?: (ready: boolean) => void;
}

interface LatestFrame {
  state: GameState;
  renderPositions: Readonly<Record<PlayerId, Vec2>>;
  camera: CameraViewBox;
}

export default function ThreeAstronautLayer({
  state,
  renderPositions,
  camera,
  onReadyChange,
  onObjectReadyChange,
}: ThreeAstronautLayerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const latestRef = useRef<LatestFrame>({ state, renderPositions, camera });
  const readyCallbackRef = useRef(onReadyChange);
  const objectReadyCallbackRef = useRef(onObjectReadyChange);
  latestRef.current = { state, renderPositions, camera };
  readyCallbackRef.current = onReadyChange;
  objectReadyCallbackRef.current = onObjectReadyChange;
  const playerKey = state.activePlayerIds.join("|");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let animationFrame = 0;
    let cancelled = false;
    let contextLost = false;
    let resizeDirty = true;
    let renderer: THREE.WebGLRenderer | null = null;
    let astronautRenderReady = false;
    let astronautAssetsReady = false;
    let objectRenderReady = false;
    let objectAssetsReady = false;
    let previousFrameMs: number | null = null;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scene = new THREE.Scene();
    const viewCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 180);
    viewCamera.up.set(0, 1, 0);
    const rigs = new Map<PlayerId, ThreeAstronautRig>();
    let objectRuntime: ThreeGameObjectRuntime | null = null;

    const hemisphere = new THREE.HemisphereLight(0xddf7ff, 0x07111b, 1.85);
    const keyLight = new THREE.DirectionalLight(0xfff2d6, 3.1);
    keyLight.position.set(-45, 55, 80);
    const fillLight = new THREE.DirectionalLight(0x6ebbff, 0.72);
    fillLight.position.set(35, -25, 55);
    scene.add(hemisphere, keyLight, fillLight);

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
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.08;
      renderer.domElement.className = "three-astronaut-layer__canvas";
      renderer.domElement.setAttribute("aria-hidden", "true");
      renderer.domElement.addEventListener("webglcontextlost", handleContextLost);
      renderer.domElement.addEventListener("webglcontextrestored", handleContextRestored);
      host.appendChild(renderer.domElement);
    } catch (error) {
      console.error("Unable to initialize 3D astronaut renderer", error);
      resizeObserver.disconnect();
      for (const rig of rigs.values()) disposeThreeAstronautModel(rig);
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
      if (cancelled || failed) {
        for (const { asset } of loaded) disposeThreeAstronautAsset(asset);
        if (failed) console.error("Unable to load a 3D astronaut model", failed.reason);
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
        return;
      }

      for (const { playerId, rig } of pendingRigs) {
        rigs.set(playerId, rig);
        scene.add(rig.root);
      }
      astronautAssetsReady = true;
    });

    void loadThreeGameObjectAssets(requestedPlayerIds).then((assets) => {
      if (cancelled) {
        disposeThreeGameObjectAssets(assets);
        return;
      }
      try {
        objectRuntime = createThreeGameObjectRuntime(assets, latestRef.current.state);
        scene.add(objectRuntime.root);
        objectAssetsReady = true;
      } catch (error) {
        disposeThreeGameObjectAssets(assets);
        console.error("Unable to create 3D game objects", error);
      }
    }).catch((error) => {
      if (!cancelled) console.error("Unable to load 3D game objects", error);
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
      if (objectRuntime) updateThreeGameObjectRuntime(objectRuntime, latest.state);
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
      readyCallbackRef.current?.(false);
      objectReadyCallbackRef.current?.(false);
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
      readyCallbackRef.current?.(false);
      objectReadyCallbackRef.current?.(false);
    }

    function handleContextRestored() {
      contextLost = false;
      astronautRenderReady = false;
      objectRenderReady = false;
      resizeDirty = true;
    }
  }, [playerKey]);

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
