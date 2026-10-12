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
}

/**
 * Swap textureUrl to replace the daylight map. The dusk veil and every
 * powered-zone reveal are generated dynamically from this same source image.
 */
export const ACTIVE_TERRAIN_THEME: TerrainVisualTheme = {
  id: "exoplanet-four-biomes",
  textureUrl: "/assets/tetherbound-exoplanet-terrain-v2.png",
  backgroundColor: 0x050a10,
  dusk: {
    // Cool neutral overcast light: closer to a cloudy 4pm than nighttime.
    color: 0x283640,
    opacity: 0.62,
  },
  illumination: {
    featherWorldUnits: 6.2,
    teamTintOpacity: 0.05,
    teamTintBlurWorldUnits: 3.2,
    outerGlowWidth: 4.8,
    outerGlowBlurWorldUnits: 5.2,
    outerGlowOpacity: 0.14,
    rimWidth: 0.3,
    rimOpacity: 0.18,
  },
};
