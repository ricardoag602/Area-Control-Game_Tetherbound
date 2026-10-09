import { WORLD_REGIONS, type BiomeRegion } from "../world";

/**
 * Intentionally simple SVG terrain. It consumes the same region data as the
 * simulation, so a future GPU renderer can replace this component without
 * changing any biome rules.
 */
export function BiomeLayer({ compact = false }: { compact?: boolean }) {
  return (
    <g className={compact ? "biome-layer biome-layer--compact" : "biome-layer"}>
      {[...WORLD_REGIONS].reverse().map((region) => (
        <BiomeShape key={region.id} region={region} />
      ))}
    </g>
  );
}

function BiomeShape({ region }: { region: BiomeRegion }) {
  const className = `biome-region biome-region--${region.biome}`;
  if (region.shape === "rectangle") {
    return (
      <rect
        className={className}
        data-region={region.id}
        x={region.x}
        y={region.y}
        width={region.width}
        height={region.height}
      />
    );
  }

  return (
    <polygon
      className={className}
      data-region={region.id}
      points={region.vertices.map((point) => `${point.x},${point.y}`).join(" ")}
    />
  );
}
