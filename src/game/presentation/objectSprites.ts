import { publicAssetUrl } from "../assetUrl";
import type { PlayerId } from "../types";

interface TeamObjectSpriteSet {
  readonly homeBase: string;
  readonly tether: string;
  readonly breakPoint: string;
}

const ROOT = publicAssetUrl("game-objects/runtime");

export const DROPPED_MATERIAL_SPRITE = `${ROOT}/dropped-material.webp`;

export const OBJECT_SPRITES = {
  player: spriteSet("blue"),
  rival: spriteSet("red"),
  player3: spriteSet("green"),
  player4: spriteSet("yellow-gold"),
} as const satisfies Readonly<Record<PlayerId, TeamObjectSpriteSet>>;

function spriteSet(team: string): TeamObjectSpriteSet {
  return {
    homeBase: `${ROOT}/home-base-${team}.webp`,
    tether: `${ROOT}/tether-${team}.webp`,
    breakPoint: `${ROOT}/break-point-${team}.webp`,
  };
}
