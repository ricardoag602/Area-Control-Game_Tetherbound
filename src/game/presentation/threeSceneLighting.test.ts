import { describe, expect, it } from "vitest";
import { GAME_RULES } from "../constants";
import type { CameraViewBox } from "./camera";
import type { TerrainLightZone } from "./terrainLighting";
import {
  calculateThreeSceneLightTarget,
  createThreeSceneLighting,
  updateThreeSceneLighting,
} from "./threeSceneLighting";
import { ACTIVE_TERRAIN_THEME } from "./terrainTheme";

const camera: CameraViewBox = { x: 0, y: 0, width: 100, height: 100 };
const zone: TerrainLightZone = {
  id: "base-player",
  owner: "player",
  kind: "base",
  position: { x: 50, y: 50 },
  radius: GAME_RULES.safeZoneRadius,
};

describe("Three scene terrain lighting", () => {
  it("uses one hemisphere and two shadowless directional lights", () => {
    const lighting = createThreeSceneLighting(camera, [zone]);

    expect(lighting.hemisphere.isHemisphereLight).toBe(true);
    expect(lighting.key.isDirectionalLight).toBe(true);
    expect(lighting.fill.isDirectionalLight).toBe(true);
    expect(lighting.key.castShadow).toBe(false);
    expect(lighting.fill.castShadow).toBe(false);
    expect(lighting.hemisphere.intensity).toBe(
      ACTIVE_TERRAIN_THEME.modelLighting.hemisphereIntensity,
    );
  });

  it("dims models with the same powered-zone transition as the terrain", () => {
    const daylight = calculateThreeSceneLightTarget(camera, [zone]);
    const dusk = calculateThreeSceneLightTarget(camera, []);

    expect(daylight.illumination).toBe(1);
    expect(dusk.illumination).toBe(0);
    expect(dusk.keyIntensity).toBeLessThan(daylight.keyIntensity);
    expect(dusk.exposure).toBeLessThan(daylight.exposure);
  });

  it("smooths lighting changes instead of popping at zone edges", () => {
    const lighting = createThreeSceneLighting(camera, [zone]);
    const daylightIntensity = lighting.key.intensity;
    updateThreeSceneLighting(lighting, camera, [], 1 / 60);

    expect(lighting.key.intensity).toBeLessThan(daylightIntensity);
    expect(lighting.key.intensity).toBeGreaterThan(
      daylightIntensity * ACTIVE_TERRAIN_THEME.modelLighting.duskIntensityMultiplier,
    );
  });
});
