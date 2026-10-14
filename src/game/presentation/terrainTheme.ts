import { publicAssetUrl } from "../assetUrl";

/**
 * Map art and lighting live together so a new daylight map can opt into the
 * same dusk-and-tether treatment without changing renderer code.
 */
export interface TerrainVisualTheme {
  readonly id: string;
  readonly textureUrl: string;
  readonly backgroundColor: number;
  readonly dusk: {
    readonly color: number;
    readonly opacity: number;
  };
  readonly illumination: {
    readonly featherWorldUnits: number;
    readonly teamTintOpacity: number;
    readonly teamTintBlurWorldUnits: number;
    readonly outerGlowWidth: number;
    readonly outerGlowBlurWorldUnits: number;
    readonly outerGlowOpacity: number;
    readonly rimWidth: number;
    readonly rimOpacity: number;
  };
  readonly modelLighting: {
    readonly skyColor: number;
    readonly groundColor: number;
    readonly keyColor: number;
    readonly fillColor: number;
    readonly hemisphereIntensity: number;
    readonly keyIntensity: number;
    readonly fillIntensity: number;
    readonly duskIntensityMultiplier: number;
    readonly daylightExposure: number;
    readonly duskExposure: number;
    readonly transitionRate: number;
    readonly keyPosition: readonly [number, number, number];
    readonly fillPosition: readonly [number, number, number];
  };
}

/**
 * Swap textureUrl to replace the daylight map. The dusk veil and every
 * powered-zone reveal are generated dynamically from this same source image.
 */
export const ACTIVE_TERRAIN_THEME: TerrainVisualTheme = {
  id: "exoplanet-four-biomes",
  textureUrl: publicAssetUrl("tetherbound-exoplanet-terrain-v2.png"),
  backgroundColor: 0x050a10,
  dusk: {
    // Keep unpowered ground distinctly overcast so the daylight reveals read
    // immediately, even on a small screen.
    color: 0x283640,
    opacity: 0.68,
  },
  illumination: {
    featherWorldUnits: 6.2,
    teamTintOpacity: 0.08,
    teamTintBlurWorldUnits: 3.2,
    outerGlowWidth: 5.6,
    outerGlowBlurWorldUnits: 5.2,
    outerGlowOpacity: 0.24,
    rimWidth: 0.45,
    rimOpacity: 0.36,
  },
  modelLighting: {
    // A cool ambient source and two shadowless directional lights mirror the
    // painted terrain without per-object lights or real-time shadow maps.
    skyColor: 0xa9c3cc,
    groundColor: 0x16242b,
    keyColor: 0xffd9ad,
    fillColor: 0x6eb6e8,
    hemisphereIntensity: 1.45,
    keyIntensity: 2.4,
    fillIntensity: 0.42,
    duskIntensityMultiplier: 0.68,
    daylightExposure: 1.03,
    duskExposure: 0.79,
    transitionRate: 4,
    keyPosition: [-45, 55, 80],
    fillPosition: [35, -25, 55],
  },
};
