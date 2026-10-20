import { useCallback, useEffect, useRef, useState } from "react";
import {
  advanceBotController,
  createBotControllerState,
  type BotControllerState,
} from "../ai/bot";
import { SIMULATION_RULES } from "../constants";
import { applyPlayerCommands, type PlayerCommand } from "../simulation/playerController";
import { createInitialGameState } from "../state";
import type { MovementCommand } from "../types";

const MAXIMUM_BACKLOG_BATCHES = 4;

export function consumeSimulationBacklog(
  accumulatedSeconds: number,
  elapsedSeconds: number,
  fixedStepSeconds: number,
  maximumSteps: number,
) {
  const safeStep = Math.max(Number.EPSILON, fixedStepSeconds);
  const safeMaximumSteps = Math.max(1, Math.floor(maximumSteps));
  const maximumBacklogSeconds =
    safeStep * safeMaximumSteps * MAXIMUM_BACKLOG_BATCHES;
  const backlogSeconds = Math.min(
    maximumBacklogSeconds,
    Math.max(0, accumulatedSeconds) + Math.max(0, elapsedSeconds),
  );
  const stepCount = Math.min(
    safeMaximumSteps,
    Math.floor((backlogSeconds + 0.000001) / safeStep),
  );
  return {
    stepCount,
    remainingSeconds: Math.max(0, backlogSeconds - stepCount * safeStep),
  };
}

export function useLocalMatch({ paused = false }: { paused?: boolean } = {}) {
  const [match, setMatch] = useState<{
    game: ReturnType<typeof createInitialGameState>;
    bot: BotControllerState;
  }>(() => ({
    game: createInitialGameState(),
    bot: createBotControllerState(),
  }));
  const state = match.game;
  const movementCommands = useRef<MovementCommand[]>([]);
  const deployRequested = useRef(false);

  useEffect(() => {
    if (paused) return;

    let frameId = 0;
    let previousTime = performance.now();
    let accumulatorSeconds = 0;
    const fixedStepSeconds = 1 / SIMULATION_RULES.ticksPerSecond;

    const frame = (time: number) => {
      const elapsedSeconds = Math.max(0, (time - previousTime) / 1000);
      previousTime = time;
      const backlog = consumeSimulationBacklog(
        accumulatorSeconds,
        elapsedSeconds,
        fixedStepSeconds,
        SIMULATION_RULES.maximumCatchUpSteps,
      );
      const { stepCount } = backlog;
      accumulatorSeconds = backlog.remainingSeconds;
      if (stepCount === 0) {
        frameId = requestAnimationFrame(frame);
        return;
      }

      const playerCommand: PlayerCommand = {
        movementCommands: movementCommands.current,
        deployAnchor: deployRequested.current,
      };
      movementCommands.current = [];
      deployRequested.current = false;
      setMatch((current) => {
        let next = current.game;
        let bot = current.bot;
        for (let step = 0; step < stepCount; step += 1) {
          const botStep = advanceBotController(next, "rival", bot);
          bot = botStep.controller;
          next = applyPlayerCommands(
            next,
            {
              player: step === 0
                ? playerCommand
                : { movementCommands: [], deployAnchor: false },
              rival: botStep.command,
            },
            fixedStepSeconds,
          );
        }
        if (next === current.game && bot === current.bot) return current;
        return { game: next, bot };
      });
      frameId = requestAnimationFrame(frame);
    };

    frameId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameId);
  }, [paused]);

  const sendMovementCommand = useCallback((command: MovementCommand) => {
    // Commands are consumed together on the next simulation frame in event order.
    movementCommands.current.push(command);
  }, []);

  const deploy = useCallback(() => {
    deployRequested.current = true;
  }, []);

  return { state, sendMovementCommand, deploy };
}
