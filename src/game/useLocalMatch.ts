import { useCallback, useEffect, useRef, useState } from "react";
import { getBotCommand } from "./bot";
import { applyPlayerCommands, type PlayerCommand } from "./playerController";
import { createInitialGameState } from "./state";
import type { Vec2 } from "./types";

export function useLocalMatch() {
  const [state, setState] = useState(createInitialGameState);
  const moveTarget = useRef<Vec2 | null>(null);
  const deployRequested = useRef(false);

  useEffect(() => {
    let frameId = 0;
    let previousTime = performance.now();

    const frame = (time: number) => {
      // Cap long frame gaps so a paused tab cannot create one huge simulation jump.
      const deltaSeconds = Math.min((time - previousTime) / 1000, 0.05);
      previousTime = time;
      const playerCommand: PlayerCommand = {
        moveTarget: moveTarget.current,
        deployAnchor: deployRequested.current,
      };
      deployRequested.current = false;
      setState((current) => applyPlayerCommands(
        current,
        {
          player: playerCommand,
          rival: getBotCommand(current, "rival"),
        },
        deltaSeconds,
      ));
      frameId = requestAnimationFrame(frame);
    };

    frameId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameId);
  }, []);

  const setMoveTarget = useCallback((target: Vec2 | null) => {
    // A ref holds rapidly changing pointer input without re-rendering on every move.
    moveTarget.current = target;
  }, []);

  const deploy = useCallback(() => {
    deployRequested.current = true;
  }, []);

  return { state, setMoveTarget, deploy };
}
