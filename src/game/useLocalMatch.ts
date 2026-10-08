import { useCallback, useEffect, useRef, useState } from "react";
import { getBotCommand } from "./bot";
import { SIMULATION_RULES } from "./constants";
import { applyPlayerCommands, type PlayerCommand } from "./playerController";
import { createInitialGameState } from "./state";
import type { MovementCommand } from "./types";

export function useLocalMatch() {
  const [state, setState] = useState(createInitialGameState);
  const movementCommands = useRef<MovementCommand[]>([]);
  const deployRequested = useRef(false);

  useEffect(() => {
    let frameId = 0;
    let previousTime = performance.now();
    let accumulatorSeconds = 0;
    const fixedStepSeconds = 1 / SIMULATION_RULES.ticksPerSecond;
    const maximumCatchUpSeconds =
      fixedStepSeconds * SIMULATION_RULES.maximumCatchUpSteps;

    const frame = (time: number) => {
      const elapsedSeconds = Math.max(0, (time - previousTime) / 1000);
      previousTime = time;
      accumulatorSeconds = Math.min(
        accumulatorSeconds + elapsedSeconds,
        maximumCatchUpSeconds,
      );
      const stepCount = Math.min(
        SIMULATION_RULES.maximumCatchUpSteps,
        Math.floor((accumulatorSeconds + 0.000001) / fixedStepSeconds),
      );
      if (stepCount === 0) {
        frameId = requestAnimationFrame(frame);
        return;
      }
      accumulatorSeconds -= stepCount * fixedStepSeconds;

      const playerCommand: PlayerCommand = {
        movementCommands: movementCommands.current,
        deployAnchor: deployRequested.current,
      };
      movementCommands.current = [];
      deployRequested.current = false;
      setState((current) => {
        let next = current;
        for (let step = 0; step < stepCount; step += 1) {
          next = applyPlayerCommands(
            next,
            {
              player: step === 0
                ? playerCommand
                : { movementCommands: [], deployAnchor: false },
              rival: getBotCommand(next, "rival"),
            },
            fixedStepSeconds,
          );
        }
        return next;
      });
      frameId = requestAnimationFrame(frame);
    };

    frameId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameId);
  }, []);

  const sendMovementCommand = useCallback((command: MovementCommand) => {
    // Commands are consumed together on the next simulation frame in event order.
    movementCommands.current.push(command);
  }, []);

  const deploy = useCallback(() => {
    deployRequested.current = true;
  }, []);

  return { state, sendMovementCommand, deploy };
}
