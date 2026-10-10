import { useMemo } from "react";
import { WORLD } from "../constants";
import type { TerritoryGrid } from "../world/territory";
import type { GameState, PlayerId } from "../types";
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
  const territoryCells = useMemo(() => grid.cells.map((cell) =>
    cell.owner === "neutral" ? null : (
      <rect
        key={cell.index}
        className={`minimap__cell minimap__cell--${cell.owner}`}
        x={cell.column * grid.cellWidth}
        y={cell.row * grid.cellHeight}
        width={grid.cellWidth + 0.15}
        height={grid.cellHeight + 0.15}
      />
    )
  ), [grid]);
  const localScore = Math.round(grid.score[localPlayerId]);

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
        <BiomeLayer compact />
        <g className="minimap__territory">
          {territoryCells}
        </g>
        {state.anchors.filter((anchor) => anchor.powered).map((anchor) => (
          <rect
            key={anchor.id}
            className={`minimap__anchor minimap__anchor--${anchor.owner}`}
            x={anchor.position.x - 2.2}
            y={anchor.position.y - 2.2}
            width="4.4"
            height="4.4"
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
      </svg>
      <span>MAP</span>
    </div>
  );
}
