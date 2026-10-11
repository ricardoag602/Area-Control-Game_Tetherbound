import { describe, expect, it } from "vitest";
import { GAME_RULES, SIMULATION_RULES, WORLD } from "../constants";
import { MOVEMENT_RULES } from "../movement/movement";
import {
  advanceGame,
  advanceMatch,
} from "./match";
import { getEnvironmentModifiers } from "./environment";
import {
  canDeployAnchor,
  deployAnchor,
  isInsideSafeZone,
} from "./tetherNetwork";
import { createInitialGameState } from "../state";
import { sampleWorld } from "../world/map";
import { createWorldTimeline } from "../world/timeline";

describe("Tetherbound simulation", () => {
  it("recognizes the home base as a safe zone", () => {
    const state = createInitialGameState();
    const base = state.players.player.basePosition;

    expect(GAME_RULES.safeZoneRadius).toBeCloseTo(23.5, 10);
    expect(
      GAME_RULES.maximumLinkDistance - GAME_RULES.safeZoneRadius,
    ).toBeGreaterThanOrEqual(GAME_RULES.deliveryRadius);
    expect(isInsideSafeZone(state, "player", state.players.player.basePosition)).toBe(true);
    expect(isInsideSafeZone(state, "player", {
      x: base.x + GAME_RULES.safeZoneRadius,
      y: base.y,
    })).toBe(true);
    expect(isInsideSafeZone(state, "player", {
      x: base.x + GAME_RULES.safeZoneRadius + 0.001,
      y: base.y,
    })).toBe(false);
  });

  it("keeps master event zones inside their matching rendered biomes", () => {
    const state = createInitialGameState("world-contract");

    expect(state.worldTimeline.rules.bounds).toEqual(WORLD);
    expect(state.worldTimeline.rules).toMatchObject({
      minimumIntervalTicks: Math.round(
        2.5 * SIMULATION_RULES.ticksPerSecond,
      ),
      maximumIntervalTicks: Math.round(
        4.6 * SIMULATION_RULES.ticksPerSecond,
      ),
      largeSalvageDropChance: 0.3,
      eventWeights: {
        salvage_drop: 1,
        biome_weather: 0,
      },
    });

    const averageIntervalTicks =
      (state.worldTimeline.rules.minimumIntervalTicks +
        state.worldTimeline.rules.maximumIntervalTicks) / 2;
    const totalActiveWeight =
      state.worldTimeline.rules.eventWeights.salvage_drop +
      state.worldTimeline.rules.eventWeights.biome_weather;
    const salvagePerTick =
      (state.worldTimeline.rules.eventWeights.salvage_drop / totalActiveWeight) /
      averageIntervalTicks;
    const weatherPerTick =
      (state.worldTimeline.rules.eventWeights.biome_weather / totalActiveWeight) /
      averageIntervalTicks;

    const previousAverageIntervalTicks =
      (4 * SIMULATION_RULES.ticksPerSecond +
        Math.floor(20 / 3 * SIMULATION_RULES.ticksPerSecond)) /
      2;
    const previousSalvagePerTick = 1 / previousAverageIntervalTicks;
    expect(salvagePerTick / previousSalvagePerTick).toBeCloseTo(1.5, 2);
    expect(weatherPerTick).toBe(0);
    for (const region of state.worldTimeline.rules.biomeRegions) {
      const inset = 0.001;
      const samples = [
        { x: region.x + region.width / 2, y: region.y + region.height / 2 },
        { x: region.x + inset, y: region.y + inset },
        { x: region.x + region.width - inset, y: region.y + inset },
        { x: region.x + inset, y: region.y + region.height - inset },
        {
          x: region.x + region.width - inset,
          y: region.y + region.height - inset,
        },
      ];
      for (const position of samples) {
        expect(sampleWorld(position)?.biome).toBe(region.biome);
      }
    }
  });

  it("drains oxygen outside the network", () => {
    const state = createInitialGameState();
    state.players.player.astronaut.position = { x: 105, y: 100 };
    const next = advanceGame(
      state,
      { sequence: 1, command: { type: "stop" } },
      1,
    );
    expect(next.players.player.astronaut.oxygen).toBeCloseTo(
      GAME_RULES.oxygenMaximum - GAME_RULES.oxygenDrainPerSecond,
      10,
    );
  });

  it("applies biome oxygen pressure and terrain drag authoritatively", () => {
    const neutral = createInitialGameState("terrain-test");
    neutral.players.player.astronaut.position = { x: 105, y: 100 };
    const water = createInitialGameState("terrain-test");
    water.players.player.astronaut.position = { x: 20, y: 80 };

    const command = {
      sequence: 1,
      command: { type: "walk_direction" as const, direction: { x: 1, y: 0 } },
    };
    const neutralNext = advanceGame(neutral, command, 0.5);
    const waterNext = advanceGame(water, command, 0.5);
    const neutralDistance = neutralNext.players.player.astronaut.position.x - 105;
    const waterDistance = waterNext.players.player.astronaut.position.x - 20;

    expect(waterDistance).toBeLessThan(neutralDistance);
    expect(waterNext.players.player.astronaut.oxygen).toBeCloseTo(
      GAME_RULES.oxygenMaximum - GAME_RULES.oxygenDrainPerSecond * 1.22 * 0.5,
      8,
    );
  });

  it("turns master-timeline supply events into collectible salvage", () => {
    const state = createInitialGameState("drop-integration");
    const initialDepositCount = state.salvage.length;
    state.worldTimeline = createWorldTimeline("drop-integration", {
      rules: {
        ticksPerSecond: 20,
        minimumIntervalTicks: 1,
        maximumIntervalTicks: 1,
        bounds: WORLD,
        biomeRegions: [{
          id: "water-test-zone",
          biome: "water",
          x: 5,
          y: 65,
          width: 30,
          height: 30,
        }],
        eventWeights: { salvage_drop: 1, biome_weather: 0 },
      },
    });

    const next = advanceMatch(state, {}, 1 / 20);

    expect(next.lastWorldEvent?.kind).toBe("salvage_drop");
    expect(next.salvage.length).toBeGreaterThan(initialDepositCount);
    expect(next.worldTimeline.processedThroughTick).toBe(1);
  });

  it("keeps world events identical across large and fixed-step advances", () => {
    const direct = advanceMatch(
      createInitialGameState("chunk-integration"),
      {},
      15,
    );
    let stepped = createInitialGameState("chunk-integration");
    for (let tick = 0; tick < 15 * 20; tick += 1) {
      stepped = advanceMatch(stepped, {}, 1 / 20);
    }

    expect(direct.worldTimeline).toEqual(stepped.worldTimeline);
    expect(direct.activeWeather).toEqual(stepped.activeWeather);
    expect(direct.lastWorldEvent).toEqual(stepped.lastWorldEvent);
    expect(direct.salvage).toEqual(stepped.salvage);
  });

  it("keeps physics identical when a fixed tick arrives in fractional slices", () => {
    const command = {
      sequence: 1,
      command: { type: "walk_direction" as const, direction: { x: 1, y: 0 } },
    };
    const whole = advanceMatch(
      createInitialGameState("fractional-tick"),
      { player: [command] },
      0.05,
    );
    let sliced = advanceMatch(
      createInitialGameState("fractional-tick"),
      { player: [command] },
      0.025,
    );

    expect(sliced.elapsedMs).toBe(0);
    expect(sliced.simulationRemainderMs).toBeCloseTo(25, 8);
    expect(sliced.pendingInputs.player).toEqual([command]);
    sliced = advanceMatch(sliced, {}, 0.025);

    expect(sliced).toEqual(whole);
  });

  it("keeps physics on its own cadence when the event clock is configured differently", () => {
    const command = {
      sequence: 1,
      command: { type: "walk_direction" as const, direction: { x: 1, y: 0 } },
    };
    const standard = createInitialGameState("clock-separation");
    const alternateClock = createInitialGameState("clock-separation");
    alternateClock.worldTimeline = createWorldTimeline("clock-separation", {
      rules: { ticksPerSecond: 10 },
    });

    const standardNext = advanceMatch(standard, { player: [command] }, 0.05);
    const alternateNext = advanceMatch(
      alternateClock,
      { player: [command] },
      0.05,
    );

    expect(alternateNext.players).toEqual(standardNext.players);
    expect(alternateNext.elapsedMs).toBe(standardNext.elapsedMs);
  });

  it("fully catches up a deliberately low-cap event timeline", () => {
    const state = createInitialGameState("deep-catch-up");
    state.elapsedMs = 1_000;
    state.worldTimeline = createWorldTimeline("deep-catch-up", {
      rules: {
        ticksPerSecond: 20,
        minimumIntervalTicks: 1,
        maximumIntervalTicks: 1,
        maximumEventsPerAdvance: 1,
        eventWeights: { salvage_drop: 1, biome_weather: 0 },
      },
    });

    const next = advanceMatch(state, {}, 0.05);

    expect(next.worldTimeline.processedThroughTick).toBe(21);
    expect(next.worldTimeline.nextSequence).toBe(21);
    expect(next.salvage.length).toBeGreaterThanOrEqual(state.salvage.length + 21);
  });

  it("activates generated biome weather, applies it, and expires it on schedule", () => {
    const state = createInitialGameState("weather-integration");
    state.players.player.astronaut.position = { x: 150, y: 100 };
    state.worldTimeline = createWorldTimeline("weather-integration", {
      rules: {
        ticksPerSecond: 20,
        minimumIntervalTicks: 1,
        maximumIntervalTicks: 1,
        minimumWeatherDurationTicks: 2,
        maximumWeatherDurationTicks: 2,
        biomeRegions: [{
          id: "jungle-test-zone",
          biome: "jungle",
          x: 122,
          y: 65,
          width: 82,
          height: 90,
        }],
        eventWeights: { salvage_drop: 0, biome_weather: 1 },
      },
    });

    const activated = advanceMatch(state, {}, 0.05);
    const weather = activated.activeWeather[0];
    expect(weather).toMatchObject({
      kind: "biome_weather",
      biome: "jungle",
      effect: "bug_swarm",
    });
    const modifiers = getEnvironmentModifiers(
      activated,
      activated.players.player.astronaut.position,
    );
    expect(modifiers.oxygenDrainMultiplier).toBeGreaterThan(1.12);

    activated.worldTimeline.nextEventTick = 1_000;
    const oxygenBeforeWeatherTick = activated.players.player.astronaut.oxygen;
    const affected = advanceMatch(activated, {}, 0.05);
    expect(affected.players.player.astronaut.oxygen).toBeCloseTo(
      oxygenBeforeWeatherTick -
        GAME_RULES.oxygenDrainPerSecond * modifiers.oxygenDrainMultiplier * 0.05,
      8,
    );
    const expired = advanceMatch(affected, {}, 0.05);
    expect(expired.activeWeather.some((event) => event.id === weather.id)).toBe(false);
  });

  it("applies taiga weather to safe-zone oxygen recovery", () => {
    const state = createInitialGameState("recovery-weather");
    const taigaPosition = { x: 150, y: 220 };
    state.players.player.basePosition = taigaPosition;
    state.players.player.astronaut.position = taigaPosition;
    state.players.player.astronaut.oxygen = 50;
    state.activeWeather = [{
      id: "snow-test",
      sequence: 0,
      scheduledTick: 0,
      eventSeed: 1,
      category: "environment",
      kind: "biome_weather",
      regionId: "taiga-test-zone",
      biome: "taiga",
      effect: "snow_squall",
      intensity: 3,
      durationTicks: 100,
    }];

    const next = advanceMatch(state, {}, 0.05);

    expect(next.players.player.astronaut.oxygen).toBeCloseTo(
      50 + GAME_RULES.oxygenRecoveryPerSecond * 0.9 * 0.85 * 0.05,
      8,
    );
  });

  it("expires biome weather on its exact authoritative end tick", () => {
    const state = createInitialGameState("weather-expiry");
    state.activeWeather = [{
      id: "weather-test",
      sequence: 0,
      scheduledTick: 0,
      eventSeed: 1,
      category: "environment",
      kind: "biome_weather",
      regionId: "water-event-zone",
      biome: "water",
      effect: "rough_current",
      intensity: 2,
      durationTicks: 1,
    }];

    const next = advanceMatch(state, {}, 1 / 20);

    expect(next.activeWeather).toEqual([]);
  });

  it("deploys an anchor only within connection range", () => {
    const state = createInitialGameState();
    const base = state.players.player.basePosition;
    expect(GAME_RULES.maximumLinkDistance).toBe(84);
    state.players.player.astronaut.position = {
      x: base.x + GAME_RULES.maximumLinkDistance,
      y: base.y,
    };
    expect(canDeployAnchor(state, "player")).toBe(true);

    const deployed = deployAnchor(state, "player");
    expect(deployed.anchors.filter((anchor) => anchor.owner === "player")).toHaveLength(1);
    expect(deployed.anchors[0].parentId).toBe("player-base");
    expect(deployed.players.player.astronaut.tetherKits).toBe(1);

    const outsideRange = createInitialGameState();
    outsideRange.players.player.astronaut.position = {
      x: outsideRange.players.player.basePosition.x +
        GAME_RULES.maximumLinkDistance + 0.001,
      y: outsideRange.players.player.basePosition.y,
    };
    expect(canDeployAnchor(outsideRange, "player")).toBe(false);
    expect(deployAnchor(outsideRange, "player")).toBe(outsideRange);
  });

  it("chains a maximum-length link through a powered anchor", () => {
    const state = createInitialGameState();
    state.anchors = [{
      id: "long-link-parent",
      owner: "player",
      position: { x: 105, y: 250 },
      parentId: "player-base",
      powered: true,
      disruptedUntilMs: null,
      protectedUntilMs: null,
      overloadProgress: 0,
      repairProgress: 0,
    }];
    state.players.player.astronaut.position = { x: 105, y: 166 };

    const deployed = deployAnchor(state, "player");

    expect(deployed.anchors).toHaveLength(2);
    expect(deployed.anchors[1].parentId).toBe("long-link-parent");
  });

  it("allows every collected tether kit to become an anchor without a cap", () => {
    const state = createInitialGameState();
    state.anchors = Array.from({ length: 12 }, (_, index) => ({
      id: `uncapped-anchor-${index + 1}`,
      owner: "player" as const,
      position: { x: 20 + index * 8, y: 175 },
      parentId: index === 0
        ? "player-base"
        : `uncapped-anchor-${index}`,
      powered: true,
      disruptedUntilMs: null,
      protectedUntilMs: null,
      overloadProgress: 0,
      repairProgress: 0,
    }));
    state.players.player.astronaut.position = { x: 20 + 12 * 8, y: 175 };
    state.players.player.astronaut.tetherKits = 1;

    expect(canDeployAnchor(state, "player")).toBe(true);
    const deployed = deployAnchor(state, "player");
    expect(deployed.anchors.filter((anchor) => anchor.owner === "player"))
      .toHaveLength(13);
    expect(deployed.players.player.astronaut.tetherKits).toBe(0);
  });

  it("respawns at the base when oxygen is exhausted", () => {
    const state = createInitialGameState();
    state.players.player.astronaut.position = { x: 10, y: 80 };
    state.players.player.astronaut.oxygen = 1;
    state.players.player.astronaut.carriedSalvage = 2;

    const next = advanceGame(
      state,
      {
        sequence: 1,
        command: { type: "charge", target: { x: 30, y: 80 } },
      },
      1,
    );
    expect(next.players.player.astronaut.position).toEqual(state.players.player.basePosition);
    expect(next.players.player.astronaut.carriedSalvage).toBe(0);
    expect(next.players.player.astronaut.respawns).toBe(1);
    expect(next.players.player.astronaut.movement).toMatchObject({
      mode: "idle",
      chargeSeconds: 0,
      burstDistanceRemaining: 0,
    });
  });

  it("awards a contested salvage deposit to the closest astronaut", () => {
    const state = createInitialGameState();
    state.salvage = [
      { id: "contested", position: { x: 50, y: 80 }, collected: false },
    ];
    state.players.player.astronaut.position = { x: 47, y: 80 };
    state.players.rival.astronaut.position = { x: 49, y: 80 };

    const next = advanceMatch(
      state,
      { player: [], rival: [] },
      0,
    );

    expect(next.salvage[0].collected).toBe(true);
    expect(next.players.player.astronaut.carriedSalvage).toBe(0);
    expect(next.players.rival.astronaut.carriedSalvage).toBe(1);
  });

  it("alternates exact-distance salvage ties between player slots", () => {
    const state = createInitialGameState();
    state.salvage = [
      { id: "tie-one", position: { x: 49.5, y: 80 }, collected: false },
      { id: "tie-two", position: { x: 50.5, y: 80 }, collected: false },
    ];
    state.players.player.astronaut.position = { x: 50, y: 80 };
    state.players.rival.astronaut.position = { x: 50, y: 80 };

    const next = advanceMatch(
      state,
      { player: [], rival: [] },
      0,
    );

    expect(next.salvage.every((deposit) => deposit.collected)).toBe(true);
    expect(next.players.player.astronaut.carriedSalvage).toBe(1);
    expect(next.players.rival.astronaut.carriedSalvage).toBe(1);
  });

  it("collects a six-item load while leaving a seventh deposit available", () => {
    const state = createInitialGameState();
    const pickupPosition = { x: 105, y: 175 };
    state.players.player.astronaut.position = pickupPosition;
    state.players.rival.astronaut.position = { x: 180, y: 175 };
    state.salvage = Array.from(
      { length: GAME_RULES.salvageCarryLimit + 1 },
      (_, index) => ({
        id: `capacity-${index + 1}`,
        position: { ...pickupPosition },
        collected: false,
      }),
    );

    const next = advanceMatch(state, {}, 0);

    expect(next.players.player.astronaut.carriedSalvage).toBe(
      GAME_RULES.salvageCarryLimit,
    );
    expect(next.salvage.filter((deposit) => deposit.collected)).toHaveLength(
      GAME_RULES.salvageCarryLimit,
    );
    expect(next.salvage.filter((deposit) => !deposit.collected)).toHaveLength(1);
  });

  it("still delivers newly collected salvage at a powered node", () => {
    const state = createInitialGameState();
    const base = state.players.player.basePosition;
    state.players.player.astronaut.position = { ...base };
    state.salvage = [{ id: "delivery", position: { ...base }, collected: false }];

    const next = advanceGame(
      state,
      { sequence: 1, command: { type: "stop" } },
      0,
    );

    expect(next.salvage[0].collected).toBe(true);
    expect(next.players.player.astronaut.carriedSalvage).toBe(0);
    expect(next.players.player.astronaut.bankedSalvage).toBe(1);
  });

  it("collects and fabricates a recovery tether anywhere in the visible home zone", () => {
    const state = createInitialGameState();
    const astronaut = state.players.player.astronaut;
    astronaut.tetherKits = 0;
    astronaut.bankedSalvage = 2;
    astronaut.position = {
      x: state.players.player.basePosition.x + GAME_RULES.safeZoneRadius,
      y: state.players.player.basePosition.y,
    };
    state.salvage = [{
      id: "zero-tether-recovery",
      position: { ...astronaut.position },
      collected: false,
    }];

    const next = advanceMatch(state, {}, 0);

    expect(next.salvage[0].collected).toBe(true);
    expect(next.players.player.astronaut).toMatchObject({
      carriedSalvage: 0,
      bankedSalvage: 0,
      tetherKits: 1,
    });
  });

  it("keeps remote anchor delivery inside its smaller hand-in radius", () => {
    const state = createInitialGameState();
    const anchorPosition = { x: 105, y: 306 };
    state.anchors = [{
      id: "player-anchor-delivery-test",
      owner: "player",
      position: anchorPosition,
      parentId: "player-base",
      powered: true,
      disruptedUntilMs: null,
      protectedUntilMs: null,
      overloadProgress: 0,
      repairProgress: 0,
    }];
    state.players.player.astronaut.carriedSalvage = 1;
    state.players.player.astronaut.position = {
      x: anchorPosition.x + GAME_RULES.deliveryRadius + 0.01,
      y: anchorPosition.y,
    };

    const outsideDeliveryRing = advanceMatch(state, {}, 0);

    expect(outsideDeliveryRing.players.player.astronaut).toMatchObject({
      carriedSalvage: 1,
      bankedSalvage: 0,
    });

    outsideDeliveryRing.players.player.astronaut.position = {
      x: anchorPosition.x + GAME_RULES.deliveryRadius,
      y: anchorPosition.y,
    };
    const onDeliveryRing = advanceMatch(outsideDeliveryRing, {}, 0);

    expect(onDeliveryRing.players.player.astronaut).toMatchObject({
      carriedSalvage: 0,
      bankedSalvage: 1,
    });
  });

  it("collects salvage swept through by a burst without collecting nearby misses", () => {
    let state = createInitialGameState();
    state.players.player.astronaut.position = { x: 105, y: 175 };
    state.players.player.astronaut.oxygen = GAME_RULES.oxygenMaximum;
    state.salvage = [
      { id: "on-path", position: { x: 115, y: 175 }, collected: false },
      {
        id: "outside-radius",
        position: { x: 115, y: 175 + GAME_RULES.collectionRadius + 0.01 },
        collected: false,
      },
    ];

    state = advanceGame(
      state,
      {
        sequence: 1,
        command: { type: "charge", target: { x: WORLD.width, y: 175 } },
      },
      MOVEMENT_RULES.fullChargeSeconds,
    );
    const chargeEndX = state.players.player.astronaut.position.x;
    const burst = advanceGame(
      state,
      {
        sequence: 2,
        command: { type: "release", target: { x: WORLD.width, y: 175 } },
      },
      Math.ceil(
        MOVEMENT_RULES.maximumBurstDistance /
          MOVEMENT_RULES.burstSpeed *
          SIMULATION_RULES.ticksPerSecond,
      ) / SIMULATION_RULES.ticksPerSecond,
    );

    expect(burst.players.player.astronaut.position.x).toBeCloseTo(
      chargeEndX + MOVEMENT_RULES.maximumBurstDistance,
      6,
    );
    expect(burst.salvage.find((deposit) => deposit.id === "on-path")?.collected).toBe(true);
    expect(
      burst.salvage.find((deposit) => deposit.id === "outside-radius")?.collected,
    ).toBe(false);
    expect(burst.players.player.astronaut.carriedSalvage).toBe(1);
  });
});
