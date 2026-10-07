import type { PointerEvent } from "react";
import { GAME_RULES, WORLD } from "../constants";
import { baseId } from "../state";
import type { GameState, PlayerId, Vec2 } from "../types";

interface ArenaRendererProps {
  state: GameState;
  onMoveTargetChange: (target: Vec2 | null) => void;
  disabled?: boolean;
}

function worldPoint(event: PointerEvent<SVGSVGElement>): Vec2 {
  const rect = event.currentTarget.getBoundingClientRect();
  // Convert browser pixels into the SVG's fixed 100-by-160 game coordinates.
  return {
    x: ((event.clientX - rect.left) / rect.width) * WORLD.width,
    y: ((event.clientY - rect.top) / rect.height) * WORLD.height,
  };
}

export function ArenaRenderer({ state, onMoveTargetChange, disabled = false }: ArenaRendererProps) {
  function beginMove(event: PointerEvent<SVGSVGElement>) {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    onMoveTargetChange(worldPoint(event));
  }

  function continueMove(event: PointerEvent<SVGSVGElement>) {
    if (disabled) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      onMoveTargetChange(worldPoint(event));
    }
  }

  function stopMove(event: PointerEvent<SVGSVGElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!disabled) onMoveTargetChange(null);
  }

  return (
    <svg
      className="world"
      viewBox={`0 0 ${WORLD.width} ${WORLD.height}`}
      role="img"
      aria-label="Tetherbound arena. Hold and drag to move your astronaut."
      aria-disabled={disabled}
      onPointerDown={beginMove}
      onPointerMove={continueMove}
      onPointerUp={stopMove}
      onPointerCancel={stopMove}
    >
      <defs>
        <pattern id="world-grid" width="5" height="5" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.22" fill="#76909b" opacity=".22" />
        </pattern>
      </defs>
      <rect width="100" height="160" fill="#111b22" />
      <rect width="100" height="160" fill="url(#world-grid)" />

      <Network state={state} playerId="rival" />
      <Network state={state} playerId="player" />

      {state.salvage.filter((deposit) => !deposit.collected).map((deposit) => (
        <rect
          key={deposit.id}
          className="world__salvage"
          x={deposit.position.x - 1.7}
          y={deposit.position.y - 1.7}
          width="3.4"
          height="3.4"
          rx=".4"
          transform={`rotate(45 ${deposit.position.x} ${deposit.position.y})`}
        />
      ))}

      <Astronaut
        position={state.players.rival.astronaut.position}
        playerId="rival"
      />
      <Astronaut
        position={state.players.player.astronaut.position}
        playerId="player"
      />
    </svg>
  );
}

function Network({ state, playerId }: { state: GameState; playerId: PlayerId }) {
  const player = state.players[playerId];
  const anchors = state.anchors.filter((anchor) => anchor.owner === playerId && anchor.powered);
  // The lookup lets each anchor draw a cable to its stored parent node by id.
  const nodes = new Map<string, Vec2>([
    [baseId(playerId), player.basePosition],
    ...anchors.map((anchor) => [anchor.id, anchor.position] as [string, Vec2]),
  ]);

  return (
    <g className={`world__network world__network--${playerId}`}>
      <circle
        className="world__safe-zone"
        cx={player.basePosition.x}
        cy={player.basePosition.y}
        r={GAME_RULES.safeZoneRadius}
      />
      {anchors.map((anchor) => {
        const parent = nodes.get(anchor.parentId);
        return (
          <g key={anchor.id}>
            {parent && (
              <line
                className="world__cable"
                x1={parent.x}
                y1={parent.y}
                x2={anchor.position.x}
                y2={anchor.position.y}
              />
            )}
            <circle
              className="world__safe-zone"
              cx={anchor.position.x}
              cy={anchor.position.y}
              r={GAME_RULES.safeZoneRadius}
            />
            <circle className="world__anchor" cx={anchor.position.x} cy={anchor.position.y} r="2" />
          </g>
        );
      })}
      <circle className="world__base-ring" cx={player.basePosition.x} cy={player.basePosition.y} r="5" />
      <circle className="world__base-core" cx={player.basePosition.x} cy={player.basePosition.y} r="2.5" />
    </g>
  );
}

function Astronaut({ position, playerId }: { position: Vec2; playerId: PlayerId }) {
  return (
    <g className={`world__astronaut world__astronaut--${playerId}`} transform={`translate(${position.x} ${position.y})`}>
      <circle r="3" />
      <rect x="-1.6" y="-.9" width="3.2" height="1.8" rx=".9" />
    </g>
  );
}
