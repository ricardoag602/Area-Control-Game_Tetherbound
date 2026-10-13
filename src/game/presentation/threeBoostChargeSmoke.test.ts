import { describe, expect, it, vi } from "vitest";
import { createInitialGameState } from "../state";
import type { PlayerId, Vec2 } from "../types";
import {
  BOOST_CHARGE_SMOKE_RULES,
  calculateBoostChargeSmokePose,
  createBoostChargeSmokeParticle,
  createThreeBoostChargeSmoke,
  disposeThreeBoostChargeSmoke,
  updateThreeBoostChargeSmoke,
} from "./threeBoostChargeSmoke";

describe("boost-charge smoke particles", () => {
  it("spawns behind both forward and reverse boost directions", () => {
    const position = { x: 40, y: 60 };
    const forward = createBoostChargeSmokeParticle(
      "player",
      0,
      position,
      { x: 1, y: 0 },
    )!;
    const reverse = createBoostChargeSmokeParticle(
      "player",
      0,
      position,
      { x: -1, y: 0 },
    )!;

    expect(forward.origin.x).toBeLessThan(position.x);
    expect(forward.velocity.x).toBeLessThan(0);
    expect(reverse.origin.x).toBeGreaterThan(position.x);
    expect(reverse.velocity.x).toBeGreaterThan(0);
  });

  it("grows, zigzags deterministically, and fades away", () => {
    const first = createBoostChargeSmokeParticle(
      "player3",
      12,
      { x: 20, y: 30 },
      { x: 0, y: -1 },
    )!;
    const duplicate = createBoostChargeSmokeParticle(
      "player3",
      12,
      { x: 20, y: 30 },
      { x: 0, y: -1 },
    )!;
    const early = calculateBoostChargeSmokePose(first, first.lifetimeSeconds * 0.15);
    const late = calculateBoostChargeSmokePose(first, first.lifetimeSeconds * 0.8);
    const finished = calculateBoostChargeSmokePose(first, first.lifetimeSeconds);
    const duplicateLate = calculateBoostChargeSmokePose(
      duplicate,
      duplicate.lifetimeSeconds * 0.8,
    );

    expect(duplicate).toEqual(first);
    expect(duplicateLate).toEqual(late);
    expect(late.size).toBeGreaterThan(early.size);
    expect(late.opacity).toBeLessThan(early.opacity);
    expect(finished.opacity).toBe(0);
    const linearLateX = first.origin.x + first.velocity.x * first.lifetimeSeconds * 0.8;
    expect(Math.abs(late.x - linearLateX)).toBeGreaterThan(0.01);
  });

  it("creates one oversized launch cloud and then a distance-spaced flight trail", () => {
    const runtime = createThreeBoostChargeSmoke(["player"]);
    const state = createInitialGameState("smoke-launch", 2);
    const positions = renderPositions(state.activePlayerIds, { x: 40, y: 80 });

    state.players.player.astronaut.movement = {
      ...state.players.player.astronaut.movement,
      mode: "charging",
      direction: { x: 1, y: 0 },
      chargeSeconds: 0.8,
    };
    updateThreeBoostChargeSmoke(runtime, state, positions, 0.016);

    positions.player = { x: 42, y: 80 };
    state.players.player.astronaut.movement = {
      ...state.players.player.astronaut.movement,
      mode: "burst",
      direction: { x: 1, y: 0 },
      burstDistanceRemaining: 33,
      burstDistanceTotal: 35,
    };
    updateThreeBoostChargeSmoke(runtime, state, positions, 0.016);

    const launchParticles = runtime.particles.filter(({ kind }) => kind === "launch");
    expect(launchParticles).toHaveLength(
      BOOST_CHARGE_SMOKE_RULES.launchParticleCount,
    );
    expect(Math.max(...launchParticles.map(({ endSize }) => endSize))).toBeGreaterThan(8);
    expect(launchParticles.every(({ origin }) => origin.x < 40)).toBe(true);
    expect(runtime.particles.some(({ kind }) => kind === "flight")).toBe(true);

    positions.player = { x: 46, y: 80 };
    updateThreeBoostChargeSmoke(runtime, state, positions, 0.05);
    expect(runtime.particles.filter(({ kind }) => kind === "launch")).toHaveLength(
      BOOST_CHARGE_SMOKE_RULES.launchParticleCount,
    );
    expect(runtime.particles.filter(({ kind }) => kind === "flight").length)
      .toBeGreaterThan(1);
    expect(runtime.geometry.drawRange.count).toBe(runtime.particles.length * 6);
  });

  it.each(["idle", "walking"] as const)(
    "keeps trailing through the smoothed landing, then stops in %s mode",
    (landingMode) => {
      const runtime = createThreeBoostChargeSmoke(["player"]);
      const state = createInitialGameState(`smoke-landing-${landingMode}`, 2);
      const positions = renderPositions(state.activePlayerIds, { x: 40, y: 80 });
      state.players.player.astronaut.movement = {
        ...state.players.player.astronaut.movement,
        mode: "charging",
        direction: { x: 1, y: 0 },
        chargeSeconds: 0.8,
      };
      updateThreeBoostChargeSmoke(runtime, state, positions, 0.016);

      state.players.player.astronaut.movement = {
        ...state.players.player.astronaut.movement,
        mode: "burst",
        burstDistanceRemaining: 20,
        burstDistanceTotal: 35,
      };
      positions.player = { x: 44, y: 80 };
      updateThreeBoostChargeSmoke(runtime, state, positions, 0.05);
      const flightBeforeLanding = runtime.particles.filter(
        ({ kind }) => kind === "flight",
      ).length;

      state.players.player.astronaut.movement = {
        ...state.players.player.astronaut.movement,
        mode: landingMode,
        chargeSeconds: 0,
        burstDistanceRemaining: 0,
        burstDistanceTotal: 0,
      };
      positions.player = { x: 46, y: 80 };
      updateThreeBoostChargeSmoke(runtime, state, positions, 0.016);
      const flightAtLanding = runtime.particles.filter(
        ({ kind }) => kind === "flight",
      ).length;
      expect(flightAtLanding).toBeGreaterThan(flightBeforeLanding);

      const particleCountAtLanding = runtime.particles.length;
      updateThreeBoostChargeSmoke(runtime, state, positions, 0.016);
      expect(runtime.particles).toHaveLength(particleCountAtLanding);

      for (let frame = 0; frame < 20; frame += 1) {
        updateThreeBoostChargeSmoke(runtime, state, positions, 0.1);
      }
      expect(runtime.particles).toHaveLength(0);
    },
  );

  it("does not invent a launch cloud when first observed mid-flight", () => {
    const runtime = createThreeBoostChargeSmoke(["player"]);
    const state = createInitialGameState("smoke-mid-flight", 2);
    const positions = renderPositions(state.activePlayerIds, { x: 50, y: 80 });
    state.players.player.astronaut.movement = {
      ...state.players.player.astronaut.movement,
      mode: "burst",
      direction: { x: -1, y: 0 },
      chargeSeconds: 0.8,
      burstDistanceRemaining: 20,
      burstDistanceTotal: 35,
    };

    updateThreeBoostChargeSmoke(runtime, state, positions, 0.016);
    expect(runtime.particles).toHaveLength(0);
    positions.player = { x: 47, y: 80 };
    updateThreeBoostChargeSmoke(runtime, state, positions, 0.05);
    expect(runtime.particles.some(({ kind }) => kind === "launch")).toBe(false);
    const flight = runtime.particles.filter(({ kind }) => kind === "flight");
    expect(flight.length).toBeGreaterThan(0);
    expect(flight.every(({ origin, velocity }) => (
      origin.x > 47 && velocity.x > 0
    ))).toBe(true);
  });

  it("keeps capped long-segment smoke nearest the moving astronaut", () => {
    const runtime = createThreeBoostChargeSmoke(["player"]);
    const state = createInitialGameState("smoke-long-segment", 2);
    const positions = renderPositions(state.activePlayerIds, { x: 40, y: 80 });
    state.players.player.astronaut.movement = {
      ...state.players.player.astronaut.movement,
      mode: "burst",
      direction: { x: 1, y: 0 },
      chargeSeconds: 0.8,
      burstDistanceRemaining: 30,
      burstDistanceTotal: 35,
    };
    updateThreeBoostChargeSmoke(runtime, state, positions, 0.016);

    positions.player = { x: 67, y: 80 };
    updateThreeBoostChargeSmoke(runtime, state, positions, 0.1);
    const flight = runtime.particles.filter(({ kind }) => kind === "flight");
    expect(flight).toHaveLength(BOOST_CHARGE_SMOKE_RULES.maximumSpawnsPerFrame);
    const newestOriginX = Math.max(...flight.map(({ origin }) => origin.x));
    const maximumExpectedGap = BOOST_CHARGE_SMOKE_RULES.flight.spawnOffset * 1.16
      + BOOST_CHARGE_SMOKE_RULES.flightParticleSpacing;
    expect(positions.player.x - newestOriginX).toBeLessThan(maximumExpectedGap);
    expect(runtime.geometry.drawRange.count).toBe(runtime.particles.length * 6);
  });

  it("emits only while charging, enforces its pool cap, and clears for reduced motion", () => {
    const runtime = createThreeBoostChargeSmoke(["player"]);
    const state = createInitialGameState("smoke-runtime", 2);
    const positions = renderPositions(state.activePlayerIds, { x: 50, y: 80 });

    updateThreeBoostChargeSmoke(runtime, state, positions, 0.1);
    expect(runtime.particles).toHaveLength(0);

    state.players.player.astronaut.movement = {
      ...state.players.player.astronaut.movement,
      mode: "charging",
      direction: { x: 1, y: 0 },
      chargeSeconds: 1,
    };
    for (let frame = 0; frame < 80; frame += 1) {
      updateThreeBoostChargeSmoke(runtime, state, positions, 0.1);
    }

    expect(runtime.particles.length).toBeGreaterThan(0);
    expect(runtime.particles.length).toBeLessThanOrEqual(
      BOOST_CHARGE_SMOKE_RULES.maxParticlesPerPlayer,
    );
    expect(runtime.geometry.drawRange.count).toBe(runtime.particles.length * 6);

    updateThreeBoostChargeSmoke(runtime, state, positions, 0.1, true);
    expect(runtime.particles).toHaveLength(0);
    expect(runtime.geometry.drawRange.count).toBe(0);

    const geometryDispose = vi.spyOn(runtime.geometry, "dispose");
    const materialDispose = vi.spyOn(runtime.material, "dispose");
    disposeThreeBoostChargeSmoke(runtime);
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
  });

  it("rejects malformed directions", () => {
    expect(createBoostChargeSmokeParticle(
      "player",
      0,
      { x: 0, y: 0 },
      { x: Number.NaN, y: 0 },
    )).toBeNull();
  });
});

function renderPositions(
  playerIds: readonly PlayerId[],
  localPosition: Vec2,
): Record<PlayerId, Vec2> {
  const positions = {
    player: localPosition,
    rival: { x: 150, y: 80 },
    player3: { x: 50, y: 270 },
    player4: { x: 150, y: 270 },
  };
  for (const playerId of playerIds) {
    positions[playerId] = positions[playerId] ?? localPosition;
  }
  return positions;
}
