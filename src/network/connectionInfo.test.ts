import { describe, expect, it } from "vitest";
import {
  createGameAddress,
  createInvitationLink,
  isLoopbackHostname,
  isValidRoomCode,
  normalizeRoomCode,
  resolveRoomServerUrl,
} from "./connectionInfo";

describe("multiplayer connection information", () => {
  it("normalizes room codes for manual entry", () => {
    expect(normalizeRoomCode(" ab-c9z ")).toBe("ABC9Z");
  });

  it("accepts only complete server-generated room codes", () => {
    expect(isValidRoomCode("ABC9Z")).toBe(true);
    expect(isValidRoomCode("ABC9")).toBe(false);
    expect(isValidRoomCode("ABC9ZX")).toBe(false);
    expect(isValidRoomCode("ABO10")).toBe(false);
  });

  it("creates a visible invitation link while preserving unrelated query values", () => {
    const currentUrl = "http://192.168.1.8:5173/play?debug=true&room=OLD99#arena";

    expect(createGameAddress(currentUrl)).toBe(
      "http://192.168.1.8:5173/play?debug=true",
    );
    expect(createInvitationLink(currentUrl, "abc9z")).toBe(
      "http://192.168.1.8:5173/play?debug=true&room=ABC9Z",
    );
  });

  it("resolves the same default or configured WebSocket address shown by the UI", () => {
    expect(resolveRoomServerUrl({ protocol: "http:", hostname: "localhost" })).toBe(
      "ws://localhost:8788",
    );
    expect(resolveRoomServerUrl({ protocol: "https:", hostname: "game.example" })).toBe(
      "wss://game.example:8788",
    );
    expect(resolveRoomServerUrl(
      { protocol: "https:", hostname: "game.example" },
      "wss://rooms.example/socket",
    )).toBe("wss://rooms.example/socket");
  });

  it("identifies addresses that cannot be opened from another device", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
    expect(isLoopbackHostname("192.168.1.8")).toBe(false);
  });
});
