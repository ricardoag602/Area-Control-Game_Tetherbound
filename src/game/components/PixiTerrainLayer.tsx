import { memo, useEffect, useRef, type RefObject } from "react";
import {
  Application,
  Assets,
  BlurFilter,
  Container,
  Graphics,
  Sprite,
  type Texture,
} from "pixi.js";
import { WORLD } from "../constants";
import type { CameraViewBox } from "../presentation/camera";
import {
  collectTerrainLightZones,
  getTerrainLightTopologyKey,
  TERRAIN_TEAM_COLORS,
} from "../presentation/terrainLighting";
import {
  ACTIVE_TERRAIN_THEME,
  type TerrainVisualTheme,
} from "../presentation/terrainTheme";
import {
  PRESENTATION_FRAME_PRIORITY,
  subscribePresentationFrame,
} from "../presentation/presentationClock";
import type { GameState } from "../types";

const MAX_RENDER_RESOLUTION = 1.5;

interface PixiTerrainLayerProps {
  state: GameState;
  cameraRef: RefObject<CameraViewBox>;
  theme?: TerrainVisualTheme;
  onInitialRender?: () => void;
  onLoadError?: (error: unknown) => void;
}

interface TerrainScene {
  app: Application;
  world: Container;
  revealMask: Graphics;
  teamTint: Graphics;
  glow: Graphics;
  glowCore: Graphics;
  pads: Graphics;
  viewportWidth: number;
  viewportHeight: number;
  resolution: number;
}

/**
 * GPU-backed terrain presentation. Simulation and input remain in the SVG
 * layers above it. Pixi keeps the source texture as daylight, applies a dusk
 * veil everywhere else, and softly tints powered reveals with their team.
 */
export const PixiTerrainLayer = memo(function PixiTerrainLayer({
  state,
  cameraRef,
  theme = ACTIVE_TERRAIN_THEME,
  onInitialRender,
  onLoadError,
}: PixiTerrainLayerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<TerrainScene | null>(null);
  const renderedCameraRef = useRef<CameraViewBox | null>(null);
  const initialRenderCallbackRef = useRef(onInitialRender);
  const latestStateRef = useRef(state);
  initialRenderCallbackRef.current = onInitialRender;
  latestStateRef.current = state;
  const terrainLightingKey = getTerrainLightTopologyKey(state);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    const app = new Application();

    const initialize = async () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      await app.init({
        width,
        height,
        antialias: true,
        autoDensity: true,
        autoStart: false,
        backgroundColor: theme.backgroundColor,
        resolution: Math.min(MAX_RENDER_RESOLUTION, window.devicePixelRatio || 1),
      });
      if (cancelled) {
        app.destroy({ removeView: true }, { children: true });
        return;
      }

      const canvas = app.canvas as HTMLCanvasElement;
      canvas.className = "pixi-terrain-layer__canvas";
      canvas.setAttribute("aria-hidden", "true");
      host.appendChild(canvas);

      const terrainTexture = await Assets.load<Texture>(theme.textureUrl);
      if (cancelled) {
        app.destroy({ removeView: true }, { children: true });
        return;
      }

      const world = new Container();
      const daylightTerrain = terrainSprite(terrainTexture);

      const revealMask = new Graphics();
      revealMask.filters = [new BlurFilter({
        strength: theme.illumination.featherWorldUnits,
        quality: 1,
      })];

      // The source map stays untouched. This translucent veil is the night
      // treatment, and the inverse mask punches natural, feathered light into it.
      const duskVeil = new Graphics()
        .rect(0, 0, WORLD.width, WORLD.height)
        .fill({ color: theme.dusk.color, alpha: theme.dusk.opacity });
      duskVeil.setMask({ mask: revealMask, inverse: true, channel: "alpha" });

      const teamTint = new Graphics();
      teamTint.blendMode = "screen";
      teamTint.filters = [new BlurFilter({
        strength: theme.illumination.teamTintBlurWorldUnits,
        quality: 1,
      })];

      const glow = new Graphics();
      glow.blendMode = "screen";
      glow.filters = [new BlurFilter({
        strength: theme.illumination.outerGlowBlurWorldUnits,
        quality: 1,
      })];
      const glowCore = new Graphics();
      glowCore.blendMode = "screen";
      const pads = new Graphics();

      world.addChild(
        daylightTerrain,
        duskVeil,
        teamTint,
        glow,
        revealMask,
        pads,
        glowCore,
      );
      app.stage.addChild(world);

      const scene = {
        app,
        world,
        revealMask,
        teamTint,
        glow,
        glowCore,
        pads,
        viewportWidth: width,
        viewportHeight: height,
        resolution: Math.min(MAX_RENDER_RESOLUTION, window.devicePixelRatio || 1),
      };
      sceneRef.current = scene;
      updateTerrainLighting(scene, latestStateRef.current, theme);
      resizeAndPosition(scene, host, cameraRef.current);
      renderedCameraRef.current = { ...cameraRef.current };

      resizeObserver = new ResizeObserver(() => {
        const current = sceneRef.current;
        if (current) {
          resizeAndPosition(current, host, cameraRef.current);
          renderedCameraRef.current = { ...cameraRef.current };
        }
      });
      resizeObserver.observe(host);
    };

    void settleTerrainInitialization(
      initialize,
      () => initialRenderCallbackRef.current?.(),
      (error) => {
        console.error("Unable to initialize Pixi terrain", error);
        onLoadError?.(error);
      },
      () => cancelled,
    );

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      sceneRef.current = null;
      renderedCameraRef.current = null;
      if (app.renderer) {
        app.destroy({ removeView: true }, { children: true });
      }
    };
  }, [cameraRef, onLoadError, theme]);

  useEffect(() => subscribePresentationFrame(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!scene || sameCamera(renderedCameraRef.current, camera)) return;
    positionAndRender(scene, camera);
    renderedCameraRef.current = { ...camera };
  }, PRESENTATION_FRAME_PRIORITY.scene), [cameraRef]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    updateTerrainLighting(scene, latestStateRef.current, theme);
    scene.app.render();
  }, [terrainLightingKey, theme]);

  return <div ref={hostRef} className="pixi-terrain-layer" aria-hidden="true" />;
});

export async function settleTerrainInitialization(
  initialize: () => Promise<void>,
  onInitialRender: () => void,
  onLoadError: (error: unknown) => void,
  isCancelled: () => boolean = () => false,
) {
  try {
    await initialize();
    if (!isCancelled()) onInitialRender();
  } catch (error) {
    if (!isCancelled()) onLoadError(error);
  }
}

function terrainSprite(texture: Texture) {
  const sprite = new Sprite(texture);
  sprite.width = WORLD.width;
  sprite.height = WORLD.height;
  return sprite;
}

function updateTerrainLighting(
  scene: TerrainScene,
  state: GameState,
  theme: TerrainVisualTheme,
) {
  const zones = collectTerrainLightZones(state);
  scene.revealMask.clear();
  scene.teamTint.clear();
  scene.glow.clear();
  scene.glowCore.clear();
  scene.pads.clear();

  for (const zone of zones) {
    const color = TERRAIN_TEAM_COLORS[zone.owner];
    scene.revealMask
      .circle(zone.position.x, zone.position.y, zone.radius)
      .fill({ color: 0xffffff });
    scene.teamTint
      .circle(zone.position.x, zone.position.y, zone.radius - 0.8)
      .fill({ color, alpha: theme.illumination.teamTintOpacity });
    scene.glow
      .circle(zone.position.x, zone.position.y, zone.radius + 0.9)
      .stroke({
        color,
        width: theme.illumination.outerGlowWidth,
        alpha: theme.illumination.outerGlowOpacity,
      });
    scene.glowCore
      .circle(zone.position.x, zone.position.y, zone.radius)
      .stroke({
        color,
        width: theme.illumination.rimWidth,
        alpha: theme.illumination.rimOpacity,
      });
    if (zone.kind === "anchor") {
      // A compact bloom and crisp core make the powered anchor itself read as
      // the source of the larger terrain reveal. These reuse the existing
      // batched Graphics and blur pass rather than adding per-anchor lights.
      scene.glow
        .circle(zone.position.x, zone.position.y, 5.2)
        .fill({ color, alpha: 0.24 });
      scene.glowCore
        .circle(zone.position.x, zone.position.y, 4.7)
        .stroke({ color, width: 0.8, alpha: 0.78 });
    }
  }

  for (const playerId of state.activePlayerIds) {
    const position = state.players[playerId].basePosition;
    const color = TERRAIN_TEAM_COLORS[playerId];
    scene.pads
      .circle(position.x, position.y, 7.4)
      .fill({ color: 0x071218, alpha: 0.9 })
      .stroke({ color, width: 0.75, alpha: 0.8 })
      .circle(position.x, position.y, 5.7)
      .stroke({ color: 0xcdeff4, width: 0.32, alpha: 0.46 });
    for (let spoke = 0; spoke < 8; spoke += 1) {
      const angle = spoke * Math.PI / 4;
      scene.pads
        .moveTo(
          position.x + Math.cos(angle) * 5.9,
          position.y + Math.sin(angle) * 5.9,
        )
        .lineTo(
          position.x + Math.cos(angle) * 7,
          position.y + Math.sin(angle) * 7,
        )
        .stroke({ color, width: 0.42, alpha: 0.68 });
    }
  }
}

function resizeAndPosition(
  scene: TerrainScene,
  host: HTMLDivElement,
  camera: CameraViewBox,
) {
  const width = Math.max(1, host.clientWidth);
  const height = Math.max(1, host.clientHeight);
  const resolution = Math.min(MAX_RENDER_RESOLUTION, window.devicePixelRatio || 1);
  if (
    scene.viewportWidth !== width
    || scene.viewportHeight !== height
    || scene.resolution !== resolution
  ) {
    scene.app.renderer.resize(width, height, resolution);
    scene.viewportWidth = width;
    scene.viewportHeight = height;
    scene.resolution = resolution;
  }
  positionAndRender(scene, camera);
}

function positionAndRender(
  scene: TerrainScene,
  camera: CameraViewBox,
) {
  const width = scene.viewportWidth;
  const height = scene.viewportHeight;
  const scaleX = width / camera.width;
  const scaleY = height / camera.height;
  scene.world.scale.set(scaleX, scaleY);
  scene.world.position.set(-camera.x * scaleX, -camera.y * scaleY);
  scene.app.render();
}

function sameCamera(first: CameraViewBox | null, second: CameraViewBox) {
  return first !== null &&
    first.x === second.x &&
    first.y === second.y &&
    first.width === second.width &&
    first.height === second.height;
}
