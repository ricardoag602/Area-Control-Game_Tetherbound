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

export function distanceToSegment(point: Vec2, start: Vec2, end: Vec2) {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (lengthSquared === 0) return distance(point, start);

  const projection = Math.min(
    1,
    Math.max(
      0,
      ((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) /
        lengthSquared,
    ),
  );
  return distance(point, {
    x: start.x + segmentX * projection,
    y: start.y + segmentY * projection,
  });
}
