import { useId, useMemo, type CSSProperties } from "react";
import { WORLD } from "../constants";
import { calculateSupplyDropBlip } from "../presentation/supplyDrop";
import { getAnchorPowerState, type AnchorPowerState } from "../simulation/tetherConflict";
import type { TerritoryGrid } from "../world/territory";
import type { Anchor, GameState, PlayerId } from "../types";
import { BiomeLayer } from "./BiomeLayer";

export function Minimap({
  state,
  localPlayerId,
  grid,
}: {
  state: GameState;
  localPlayerId: PlayerId;
  grid: TerritoryGrid;
}) {
  const contestedPatternId = `minimap-contested-${useId().replaceAll(":", "")}`;
  const territoryCells = useMemo(() => grid.cells.map((cell) =>
    cell.owner === "neutral" ? null : (
      <rect
        key={cell.index}
        className={`minimap__cell minimap__cell--${cell.owner}`}
        x={cell.column * grid.cellWidth}
        y={cell.row * grid.cellHeight}
        width={grid.cellWidth + 0.15}
        height={grid.cellHeight + 0.15}
        fill={cell.owner === "contested"
          ? `url(#${contestedPatternId})`
          : undefined}
      />
    )
  ), [contestedPatternId, grid]);
  const localScore = Math.round(grid.score[localPlayerId]);
  const supplyDropBlip = calculateSupplyDropBlip(
    state.lastWorldEvent,
    state.elapsedMs,
    state.worldTimeline.rules.ticksPerSecond,
  );

  return (
    <div
      className="minimap"
      role="img"
      aria-label={`Territory minimap. Your network controls ${localScore} percent.`}
    >
      <svg
        viewBox={`0 0 ${WORLD.width} ${WORLD.height}`}
        aria-hidden="true"
        shapeRendering="crispEdges"
      >
        <defs>
          <pattern
            id={contestedPatternId}
            width="5"
            height="5"
            patternUnits="userSpaceOnUse"
          >
            <rect width="5" height="5" className="minimap__contested-ground" />
            <path className="minimap__contested-line" d="M -1 1 L 4 6 M 1 -1 L 6 4 M -1 4 L 4 -1 M 1 6 L 6 1" />
          </pattern>
        </defs>
        <BiomeLayer compact />
        <g className="minimap__territory">
          {territoryCells}
        </g>
        {state.anchors.map((anchor) => (
          <MinimapAnchor
            key={anchor.id}
            anchor={anchor}
            powerState={getAnchorPowerState(anchor, state.elapsedMs)}
          />
        ))}
        {(["player", "rival"] as const).map((playerId) => {
          const position = state.players[playerId].astronaut.position;
          return (
            <circle
              key={playerId}
              className={`minimap__astronaut minimap__astronaut--${playerId}${
                playerId === localPlayerId ? " minimap__astronaut--local" : ""
              }`}
              cx={position.x}
              cy={position.y}
              r={playerId === localPlayerId ? 4.2 : 3.2}
            />
          );
        })}
        {supplyDropBlip && (
          <g
            key={supplyDropBlip.event.id}
            className="minimap__supply-blip"
            transform={`translate(${supplyDropBlip.event.position.x} ${supplyDropBlip.event.position.y})`}
            style={{ opacity: supplyDropBlip.opacity } as CSSProperties}
          >
            <rect
              className="minimap__supply-blip-ring"
              x={-supplyDropBlip.ringHalfSize}
              y={-supplyDropBlip.ringHalfSize}
              width={supplyDropBlip.ringHalfSize * 2}
              height={supplyDropBlip.ringHalfSize * 2}
            />
            <rect
              className="minimap__supply-blip-core"
              x="-2.6"
              y="-2.6"
              width="5.2"
              height="5.2"
              opacity={supplyDropBlip.coreOpacity}
            />
          </g>
        )}
      </svg>
      <span>MAP</span>
    </div>
  );
}

function MinimapAnchor({
  anchor,
  powerState,
}: {
  anchor: Anchor;
  powerState: AnchorPowerState;
}) {
  const className = `minimap__anchor minimap__anchor--${anchor.owner} minimap__anchor--${powerState}`;

  return (
    <g
      className={className}
      transform={`translate(${anchor.position.x} ${anchor.position.y})`}
    >
      {(powerState === "powered" || powerState === "shielded") && (
        <>
          <rect x="-2.4" y="-2.4" width="4.8" height="4.8" />
          {powerState === "shielded" && <circle className="minimap__anchor-shield" r="4" />}
        </>
      )}
      {powerState === "disrupted" && (
        <>
          <circle r="3.2" />
          <path d="M -2.2 -2.2 L 2.2 2.2 M 2.2 -2.2 L -2.2 2.2" />
        </>
      )}
      {powerState === "severed" && (
        <>
          <rect x="-2.4" y="-2.4" width="4.8" height="4.8" transform="rotate(45)" />
          <path d="M -2.6 0 H -1 M 1 0 H 2.6" />
        </>
      )}
    </g>
  );
}
