import { useCallback, useEffect, useRef, useState } from "react";
import { advanceGame, deployAnchor } from "./simulation";
import { createInitialGameState } from "./state";
import type { Vec2 } from "./types";

export function useLocalMatch() {
  const [state, setState] = useState(createInitialGameState);
  const moveTarget = useRef<Vec2 | null>(null);

  useEffect(() => {
    let frameId = 0;
    let previousTime = performance.now();

    const frame = (time: number) => {
      // Cap long frame gaps so a paused tab cannot create one huge simulation jump.
      const deltaSeconds = Math.min((time - previousTime) / 1000, 0.05);
      previousTime = time;
      setState((current) => advanceGame(current, { moveTarget: moveTarget.current }, deltaSeconds));
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
    setState((current) => deployAnchor(current, "player"));
  }, []);

  return { state, setMoveTarget, deploy };
}
