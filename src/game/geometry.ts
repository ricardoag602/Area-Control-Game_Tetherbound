import type { Vec2 } from "./types";

export function distance(a: Vec2, b: Vec2) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function moveToward(origin: Vec2, target: Vec2, maximumDistance: number): Vec2 {
  const totalDistance = distance(origin, target);
  if (totalDistance === 0 || totalDistance <= maximumDistance) {
    return { ...target };
  }

  const ratio = maximumDistance / totalDistance;
  return {
    x: origin.x + (target.x - origin.x) * ratio,
    y: origin.y + (target.y - origin.y) * ratio,
  };
}

export function clampToWorld(position: Vec2, width: number, height: number): Vec2 {
  return {
    x: Math.min(width, Math.max(0, position.x)),
    y: Math.min(height, Math.max(0, position.y)),
  };
}
