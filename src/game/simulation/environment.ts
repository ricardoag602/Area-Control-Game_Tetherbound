import type { GameState, PlayerId, Vec2 } from "../types";
import { sampleWorld, type BiomeId } from "../world/map";
import type { BiomeWeatherEvent } from "../world/timeline";

export interface EnvironmentModifiers {
  biome: BiomeId;
  speedMultiplier: number;
  turnRateMultiplier: number;
  oxygenDrainMultiplier: number;
  oxygenRecoveryMultiplier: number;
  ambientDrift: { strength: number; cycleSeconds: number } | null;
  driftStrengthMultiplier: number;
}

export function getEnvironmentModifiers(
  state: GameState,
  position: Vec2,
): EnvironmentModifiers {
  const sample = sampleWorld(position);
  const biome = sample?.biome ?? "neutral";
  const effects = sample?.effects ?? {
    movement: { speedMultiplier: 1, turnRateMultiplier: 1, ambientDrift: null },
    oxygen: { drainMultiplier: 1, recoveryMultiplier: 1 },
  };
  let speedMultiplier = effects.movement.speedMultiplier;
  let turnRateMultiplier = effects.movement.turnRateMultiplier;
  let oxygenDrainMultiplier = effects.oxygen.drainMultiplier;
  let oxygenRecoveryMultiplier = effects.oxygen.recoveryMultiplier;
  let driftStrengthMultiplier = 1;
  const weather = strongestWeatherForBiome(state.activeWeather ?? [], biome);

  if (weather) {
    const intensity = weather.intensity;
    switch (weather.effect) {
      case "rough_current":
        speedMultiplier *= 1 - intensity * 0.06;
        turnRateMultiplier *= 1 - intensity * 0.04;
        driftStrengthMultiplier += intensity * 0.35;
        break;
      case "bug_swarm":
        speedMultiplier *= 1 - intensity * 0.04;
        oxygenDrainMultiplier *= 1 + intensity * 0.1;
        break;
      case "dust_storm":
        speedMultiplier *= 1 - intensity * 0.05;
        turnRateMultiplier *= 1 - intensity * 0.05;
        oxygenDrainMultiplier *= 1 + intensity * 0.12;
        break;
      case "snow_squall":
        speedMultiplier *= 1 - intensity * 0.06;
        turnRateMultiplier *= 1 - intensity * 0.08;
        oxygenRecoveryMultiplier *= 1 - intensity * 0.05;
        driftStrengthMultiplier += intensity * 0.2;
        break;
    }
  }

  return {
    biome,
    speedMultiplier,
    turnRateMultiplier,
    oxygenDrainMultiplier,
    oxygenRecoveryMultiplier,
    ambientDrift: effects.movement.ambientDrift,
    driftStrengthMultiplier,
  };
}

export function strongestWeatherForBiome(
  activeWeather: readonly BiomeWeatherEvent[],
  biome: BiomeId,
) {
  return (
    activeWeather
      .filter((event) => event.biome === biome)
      .sort(
        (a, b) => b.intensity - a.intensity || a.sequence - b.sequence,
      )[0] ?? null
  );
}

export function getAmbientDrift(
  state: GameState,
  playerId: PlayerId,
  environment: EnvironmentModifiers,
  deltaSeconds: number,
): Vec2 {
  const drift = environment.ambientDrift;
  if (!drift || deltaSeconds <= 0) return { x: 0, y: 0 };

  // Match-clock-driven waves feel irregular in motion while remaining exactly
  // reproducible on the server, in replays, and after reconnection.
  const playerPhase = playerId === "player" ? 0 : Math.PI;
  const endSeconds = state.elapsedMs / 1_000;
  const startSeconds = Math.max(0, endSeconds - deltaSeconds);
  const angularFrequency = (Math.PI * 2) / drift.cycleSeconds;
  const startPhase = angularFrequency * startSeconds + playerPhase;
  const endPhase = angularFrequency * endSeconds + playerPhase;
  const strength = drift.strength * environment.driftStrengthMultiplier;
  const verticalFrequency = angularFrequency * 0.61;
  const verticalPhase = playerPhase * 0.61;
  return {
    x:
      (strength * (Math.cos(startPhase) - Math.cos(endPhase))) /
      angularFrequency,
    y:
      (strength *
        0.42 *
        (Math.sin(verticalFrequency * endSeconds + verticalPhase) -
          Math.sin(verticalFrequency * startSeconds + verticalPhase))) /
      verticalFrequency,
  };
}
