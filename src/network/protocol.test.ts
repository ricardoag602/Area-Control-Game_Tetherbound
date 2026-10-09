import { describe, expect, it } from "vitest";
import { WORLD } from "../game/constants";
import { parseClientMessage } from "./protocol";

describe("movement protocol", () => {
  it.each([
    { type: "tank_drive", throttle: 1, steering: -1 },
    { type: "tank_drive", throttle: 0, steering: 1 },
    { type: "tank_charge", throttle: -1, steering: 0 },
    { type: "tank_charge", throttle: 1, steering: 1 },
    { type: "tank_release" },
  ] as const)("accepts authoritative tank command %#", (command) => {
    expect(parseClientMessage(JSON.stringify({
      type: "movement_input",
      seq: 9,
      command,
    }))).toEqual({
      type: "movement_input",
      seq: 9,
      command,
    });
  });

  it.each([
    { type: "tank_drive", throttle: 0, steering: 0 },
    { type: "tank_drive", throttle: 0.5, steering: 1 },
    { type: "tank_drive", throttle: 2, steering: 0 },
    { type: "tank_charge", throttle: 0, steering: 1 },
    { type: "tank_charge", throttle: 1, steering: -2 },
  ])("rejects malformed tank command %#", (command) => {
    expect(parseClientMessage(JSON.stringify({
      type: "movement_input",
      seq: 9,
      command,
    }))).toBeNull();
  });

  it.each(["charge_direction", "release_direction"] as const)(
    "accepts a finite nonzero %s command",
    (commandType) => {
      expect(parseClientMessage(JSON.stringify({
        type: "movement_input",
        seq: 7,
        command: { type: commandType, direction: { x: 1, y: -1 } },
      }))).toEqual({
        type: "movement_input",
        seq: 7,
        command: { type: commandType, direction: { x: 1, y: -1 } },
      });
    },
  );

  it.each([
    { x: 0, y: 0 },
    { x: 1.01, y: 0 },
    { x: 0 },
    { x: "1", y: 0 },
  ])("rejects an invalid keyboard boost direction %#", (direction) => {
    expect(parseClientMessage(JSON.stringify({
      type: "movement_input",
      seq: 8,
      command: { type: "charge_direction", direction },
    }))).toBeNull();
  });

  it("accepts finite keyboard directions and rejects zero or oversized vectors", () => {
    expect(parseClientMessage(JSON.stringify({
      type: "movement_input",
      seq: 1,
      command: { type: "walk_direction", direction: { x: 1, y: -1 } },
    }))).toEqual({
      type: "movement_input",
      seq: 1,
      command: { type: "walk_direction", direction: { x: 1, y: -1 } },
    });

    for (const direction of [{ x: 0, y: 0 }, { x: 2, y: 0 }]) {
      expect(parseClientMessage(JSON.stringify({
        type: "movement_input",
        seq: 1,
        command: { type: "walk_direction", direction },
      }))).toBeNull();
    }
  });

  it("keeps walk targets inside the arena", () => {
    expect(parseClientMessage(JSON.stringify({
      type: "movement_input",
      seq: 1,
      command: { type: "walk", target: { x: -1, y: 80 } },
    }))).toBeNull();

    expect(parseClientMessage(JSON.stringify({
      type: "movement_input",
      seq: 2,
      command: { type: "walk", target: { x: WORLD.width, y: WORLD.height } },
    }))).toEqual({
      type: "movement_input",
      seq: 2,
      command: { type: "walk", target: { x: WORLD.width, y: WORLD.height } },
    });
  });

  it("allows a bounded outside aim so edge bursts retain their direction", () => {
    expect(parseClientMessage(JSON.stringify({
      type: "movement_input",
      seq: 2,
      command: { type: "release", target: { x: -12, y: 80 } },
    }))).toEqual({
      type: "movement_input",
      seq: 2,
      command: { type: "release", target: { x: -12, y: 80 } },
    });

    expect(parseClientMessage(JSON.stringify({
      type: "movement_input",
      seq: 3,
      command: { type: "charge", target: { x: -1_000, y: 80 } },
    }))).toBeNull();
  });
});
