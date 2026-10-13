import * as THREE from "three";
import type { CameraViewBox } from "./camera";
import {
  getTerrainIlluminationFactor,
  type TerrainLightZone,
} from "./terrainLighting";
import {
  ACTIVE_TERRAIN_THEME,
  type TerrainVisualTheme,
} from "./terrainTheme";

export interface ThreeSceneLighting {
  readonly hemisphere: THREE.HemisphereLight;
  readonly key: THREE.DirectionalLight;
  readonly fill: THREE.DirectionalLight;
  exposure: number;
}

export function createThreeSceneLighting(
  camera: CameraViewBox,
  zones: readonly TerrainLightZone[],
  theme: TerrainVisualTheme = ACTIVE_TERRAIN_THEME,
): ThreeSceneLighting {
  const target = calculateThreeSceneLightTarget(camera, zones, theme);
  const config = theme.modelLighting;
  const hemisphere = new THREE.HemisphereLight(
    config.skyColor,
    config.groundColor,
    target.hemisphereIntensity,
  );
  const key = new THREE.DirectionalLight(
    config.keyColor,
    target.keyIntensity,
  );
  key.position.set(...config.keyPosition);
  key.castShadow = false;
  const fill = new THREE.DirectionalLight(
    config.fillColor,
    target.fillIntensity,
  );
  fill.position.set(...config.fillPosition);
  fill.castShadow = false;
  return { hemisphere, key, fill, exposure: target.exposure };
}

export function updateThreeSceneLighting(
  lighting: ThreeSceneLighting,
  camera: CameraViewBox,
  zones: readonly TerrainLightZone[],
  deltaSeconds: number,
  theme: TerrainVisualTheme = ACTIVE_TERRAIN_THEME,
) {
  const target = calculateThreeSceneLightTarget(camera, zones, theme);
  const blend = deltaSeconds <= 0
    ? 1
    : 1 - Math.exp(-theme.modelLighting.transitionRate * deltaSeconds);
  lighting.hemisphere.intensity = THREE.MathUtils.lerp(
    lighting.hemisphere.intensity,
    target.hemisphereIntensity,
    blend,
  );
  lighting.key.intensity = THREE.MathUtils.lerp(
    lighting.key.intensity,
    target.keyIntensity,
    blend,
  );
  lighting.fill.intensity = THREE.MathUtils.lerp(
    lighting.fill.intensity,
    target.fillIntensity,
    blend,
  );
  lighting.exposure = THREE.MathUtils.lerp(
    lighting.exposure,
    target.exposure,
    blend,
  );
  return lighting.exposure;
}

export function calculateThreeSceneLightTarget(
  camera: CameraViewBox,
  zones: readonly TerrainLightZone[],
  theme: TerrainVisualTheme = ACTIVE_TERRAIN_THEME,
) {
  const center = {
    x: camera.x + camera.width / 2,
    y: camera.y + camera.height / 2,
  };
  const illumination = getTerrainIlluminationFactor(
    zones,
    center,
    theme.illumination.featherWorldUnits,
  );
  const config = theme.modelLighting;
  const intensityMultiplier = THREE.MathUtils.lerp(
    config.duskIntensityMultiplier,
    1,
    illumination,
  );
  return {
    illumination,
    hemisphereIntensity: config.hemisphereIntensity * intensityMultiplier,
    keyIntensity: config.keyIntensity * intensityMultiplier,
    fillIntensity: config.fillIntensity * intensityMultiplier,
    exposure: THREE.MathUtils.lerp(
      config.duskExposure,
      config.daylightExposure,
      illumination,
    ),
  };
}
