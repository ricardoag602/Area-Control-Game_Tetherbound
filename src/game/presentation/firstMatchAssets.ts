import { ASTRONAUT_SPRITES } from "./astronautSprites";
import {
  DROPPED_MATERIAL_SPRITE,
  OBJECT_SPRITES,
} from "./objectSprites";
import { ACTIVE_TERRAIN_THEME } from "./terrainTheme";
import { preloadThreeAstronautAsset } from "./threeAstronautModel";
import { preloadThreeGameObjectAssets } from "./threeGameObjectModels";
import type { PlayerId } from "../types";

interface NetworkInformationLike {
  readonly saveData?: boolean;
  readonly effectiveType?: string;
}

type NavigatorWithConnection = Navigator & {
  readonly connection?: NetworkInformationLike;
};

export const COMMON_FIRST_MATCH_PLAYERS = ["player", "rival"] as const;
const activePreloads = new Map<string, HTMLImageElement>();

export const FIRST_MATCH_IMAGE_URLS = [
  ACTIVE_TERRAIN_THEME.textureUrl,
  ...COMMON_FIRST_MATCH_PLAYERS.flatMap((playerId) =>
    Object.values(ASTRONAUT_SPRITES[playerId])
  ),
  ...COMMON_FIRST_MATCH_PLAYERS.map((playerId) =>
    OBJECT_SPRITES[playerId].homeBase
  ),
  DROPPED_MATERIAL_SPRITE,
] as const;

export function allowsFirstMatchPreload(
  connection: NetworkInformationLike | undefined,
) {
  return connection?.saveData !== true
    && connection?.effectiveType !== "slow-2g"
    && connection?.effectiveType !== "2g";
}

/**
 * Warms both the terrain images and cached raw 3D model bytes while the
 * player is still on the menu. The match readiness gate also waits for these
 * assets, so a fast click never exposes compatibility sprites in flight.
 */
export function scheduleFirstMatchAssetPreload() {
  if (
    typeof window === "undefined"
    || typeof Image === "undefined"
    || !allowsFirstMatchPreload(
      (window.navigator as NavigatorWithConnection).connection,
    )
  ) {
    return () => undefined;
  }

  const start = () => {
    preloadThreeGameplayAssets(COMMON_FIRST_MATCH_PLAYERS);
    for (const url of FIRST_MATCH_IMAGE_URLS) preloadImage(url);
  };

  if (typeof window.requestIdleCallback === "function") {
    const idleCallback = window.requestIdleCallback(start, { timeout: 1_500 });
    return () => window.cancelIdleCallback(idleCallback);
  }

  const timer = window.setTimeout(start, 800);
  return () => window.clearTimeout(timer);
}

export function preloadThreeGameplayAssets(playerIds: readonly PlayerId[]) {
  for (const playerId of playerIds) preloadThreeAstronautAsset(playerId);
  preloadThreeGameObjectAssets(playerIds);
}

function preloadImage(url: string) {
  if (activePreloads.has(url)) return;
  const image = new Image();
  activePreloads.set(url, image);
  image.decoding = "async";
  image.fetchPriority = "low";
  const release = () => activePreloads.delete(url);
  image.addEventListener("load", release, { once: true });
  image.addEventListener("error", release, { once: true });
  image.src = url;
}
