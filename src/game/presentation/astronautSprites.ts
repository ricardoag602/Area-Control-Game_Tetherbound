import type { MovementState, PlayerId } from "../types";

export type AstronautSpriteFrame = "idle" | "walk-left" | "walk-right";

type AstronautSpriteSet = Readonly<Record<AstronautSpriteFrame, string>>;

export const ASTRONAUT_SPRITES = {
  player: spriteSet("player-1-blue"),
  rival: spriteSet("player-2-red"),
  player3: spriteSet("player-3-green"),
  player4: spriteSet("player-4-yellow-gold"),
} as const satisfies Readonly<Record<PlayerId, AstronautSpriteSet>>;

/**
 * Three unique pictures form the requested five-beat loop. The final idle beat
 * flows directly into the first idle beat when gaitPhase wraps back to zero.
 */
export const ASTRONAUT_WALK_SEQUENCE = [
  "idle",
  "walk-left",
  "idle",
  "walk-right",
  "idle",
] as const satisfies readonly AstronautSpriteFrame[];

const TAU = Math.PI * 2;

export function getAstronautSpriteFrame(
  movement: Pick<MovementState, "mode" | "velocity" | "gaitPhase">,
): AstronautSpriteFrame {
  const speed = Math.hypot(movement.velocity.x, movement.velocity.y);
  if (
    movement.mode !== "walking" ||
    speed <= 0.01 ||
    !Number.isFinite(movement.gaitPhase)
  ) {
    return "idle";
  }

  const normalizedPhase = ((movement.gaitPhase % TAU) + TAU) % TAU;
  const frameIndex = Math.min(
    ASTRONAUT_WALK_SEQUENCE.length - 1,
    Math.floor(
      normalizedPhase / TAU * ASTRONAUT_WALK_SEQUENCE.length,
    ),
  );
  return ASTRONAUT_WALK_SEQUENCE[frameIndex];
}

function spriteSet(fileStem: string): AstronautSpriteSet {
  const root = "/assets/astronauts/runtime";
  return {
    idle: `${root}/${fileStem}.png`,
    "walk-left": `${root}/${fileStem}-walk-left.png`,
    "walk-right": `${root}/${fileStem}-walk-right.png`,
  };
}
