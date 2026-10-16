import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialGameState } from "../game/state";
import type { ClientMessage, ServerMessage } from "./protocol";
import { RoomClient, type RoomClientOptions } from "./RoomClient";

interface ApiCall {
  url: string;
  init: RequestInit;
}

type Reply = () => Promise<Response>;

const storage = new Map<string, string>();

beforeEach(() => {
  vi.useFakeTimers();
  storage.clear();
  vi.stubGlobal("window", {
    location: {
      protocol: "https:",
      hostname: "game.example",
      host: "game.example",
      pathname: "/tetherbound/",
    },
    setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
  });
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("RoomClient Sites HTTP lifecycle", () => {
  it("creates a room through the API and persists its resumable session", async () => {
    const api = createApi();
    api.respond([welcomeMessage()]);
    const client = createClient(api);

    client.createRoom("Host", 2);
    await flushPromises();

    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].url).toBe("/api/rooms/create");
    expect(bodyOf(api.calls[0])).toMatchObject({
      type: "create_room",
      name: "Host",
      playerLimit: 2,
    });
    expect(client.getSnapshot()).toMatchObject({
      connection: "connected",
      playerId: "player",
      room: { code: "ABC9Z" },
    });
    expect(JSON.parse(storage.get("tetherbound.room.ABC9Z") ?? "null")).toEqual({
      token: "session-token",
      name: "Host",
    });
  });

  it("stops retrying and reports an unreachable service after bounded failures", async () => {
    const api = createApi();
    api.reject();
    api.reject();
    const client = createClient(api, { maxInitialConnectionAttempts: 2 });

    client.createRoom("Host", 2);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(5);

    expect(api.calls).toHaveLength(2);
    expect(client.getSnapshot().connection).toBe("offline");
    expect(client.getSnapshot().error).toMatch(/could not be reached/i);

    await vi.advanceTimersByTimeAsync(100);
    expect(api.calls).toHaveLength(2);
  });

  it("manually retries the same idempotent create request", async () => {
    const api = createApi();
    api.reject();
    const client = createClient(api, { maxInitialConnectionAttempts: 1 });

    client.createRoom("Host", 2);
    await flushPromises();
    const firstRequest = bodyOf(api.calls[0]) as Extract<ClientMessage, { type: "create_room" }>;
    expect(client.getSnapshot().connection).toBe("offline");

    api.respond([welcomeMessage()]);
    expect(client.retry()).toBe(true);
    await flushPromises();
    const retriedRequest = bodyOf(api.calls[1]) as Extract<ClientMessage, { type: "create_room" }>;

    expect(retriedRequest.requestId).toBe(firstRequest.requestId);
    expect(client.getSnapshot().connection).toBe("connected");
  });

  it("automatically retries a recoverable API error using the same create request", async () => {
    const api = createApi();
    api.respond([{
      type: "error",
      code: "server_unavailable",
      message: "The multiplayer database is unavailable.",
      recoverable: true,
    }], 503);
    api.respond([welcomeMessage()]);
    const client = createClient(api, { maxInitialConnectionAttempts: 2 });

    client.createRoom("Host", 2);
    await flushPromises();
    expect(client.getSnapshot().connection).toBe("connecting");
    await vi.advanceTimersByTimeAsync(5);

    const firstRequest = bodyOf(api.calls[0]) as Extract<ClientMessage, { type: "create_room" }>;
    const retriedRequest = bodyOf(api.calls[1]) as Extract<ClientMessage, { type: "create_room" }>;
    expect(retriedRequest.requestId).toBe(firstRequest.requestId);
    expect(client.getSnapshot().connection).toBe("connected");
    expect(client.getSnapshot().error).toBeNull();
  });

  it("batches commands into serialized sync requests and changes poll cadence while playing", async () => {
    const api = createApi();
    api.respond([welcomeMessage()]);
    const client = createClient(api);

    client.createRoom("Host", 2);
    await flushPromises();
    client.setReady(true);
    client.sendMovementCommand({ type: "walk_direction", direction: { x: 1, y: 0 } });

    api.respond([
      roomStateMessage("playing", 2),
      pongMessage(0),
    ]);
    await vi.advanceTimersByTimeAsync(500);

    expect(api.calls).toHaveLength(2);
    expect(api.calls[1].url).toBe("/api/rooms/ABC9Z/sync");
    expect(new Headers(api.calls[1].init.headers).get("authorization")).toBe(
      "Bearer session-token",
    );
    expect(bodyOf(api.calls[1])).toMatchObject({
      knownRoomRevision: 1,
      knownStateVersion: 0,
      commands: [
        { type: "set_ready", ready: true },
        {
          type: "movement_input",
          seq: 1,
          command: { type: "walk_direction", direction: { x: 1, y: 0 } },
        },
      ],
    });

    api.respond([pongMessage(0)]);
    await vi.advanceTimersByTimeAsync(124);
    expect(api.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.calls).toHaveLength(3);
  });

  it("restores an unacknowledged command batch before retrying a failed sync", async () => {
    const api = createApi();
    api.respond([welcomeMessage()]);
    const client = createClient(api, { maxReconnectAttempts: 2 });

    client.createRoom("Host", 2);
    await flushPromises();
    client.setReady(true);

    api.reject();
    await vi.advanceTimersByTimeAsync(500);
    expect(client.getSnapshot().connection).toBe("reconnecting");

    api.respond([pongMessage(0)]);
    await vi.advanceTimersByTimeAsync(5);

    const firstSync = bodyOf(api.calls[1]) as { commands: ClientMessage[] };
    const retriedSync = bodyOf(api.calls[2]) as { commands: ClientMessage[] };
    expect(firstSync.commands).toEqual([{ type: "set_ready", ready: true }]);
    expect(retriedSync.commands).toEqual(firstSync.commands);
    expect(client.getSnapshot().connection).toBe("connected");
  });

  it("never overlaps polls and sends commands queued during an active request next", async () => {
    const api = createApi();
    api.respond([welcomeMessage()]);
    const client = createClient(api, { requestTimeoutMs: 5_000 });

    client.createRoom("Host", 2);
    await flushPromises();
    client.setReady(true);

    const deferred = api.defer();
    await vi.advanceTimersByTimeAsync(500);
    expect(api.calls).toHaveLength(2);

    client.setReady(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(api.calls).toHaveLength(2);

    deferred.resolve(apiResponse([pongMessage(0)]));
    await flushPromises();
    api.respond([pongMessage(0)]);
    await vi.advanceTimersByTimeAsync(500);

    expect(api.calls).toHaveLength(3);
    expect((bodyOf(api.calls[1]) as { commands: ClientMessage[] }).commands).toEqual([
      { type: "set_ready", ready: true },
    ]);
    expect((bodyOf(api.calls[2]) as { commands: ClientMessage[] }).commands).toEqual([
      { type: "set_ready", ready: false },
    ]);
  });

  it("resumes from tab-scoped sessionStorage through the join endpoint", async () => {
    storage.set("tetherbound.room.ABC9Z", JSON.stringify({
      token: "saved-token",
      name: "Returning Host",
    }));
    const api = createApi();
    api.respond([
      welcomeMessage({ sessionToken: "saved-token", reconnected: true }),
      gameStateMessage(),
    ]);
    const client = createClient(api);

    expect(client.resumeRoom("abc9z")).toBe(true);
    await flushPromises();

    expect(api.calls[0].url).toBe("/api/rooms/ABC9Z/join");
    expect(bodyOf(api.calls[0])).toMatchObject({
      type: "join_room",
      code: "ABC9Z",
      name: "Returning Host",
      sessionToken: "saved-token",
    });
    expect(client.getSnapshot().gameState).not.toBeNull();
    expect(client.getSnapshot().stateVersion).toBe(7);
  });

  it("leaves immediately and sends a best-effort authenticated leave request", async () => {
    const api = createApi();
    api.respond([welcomeMessage()]);
    const client = createClient(api);

    client.createRoom("Host", 2);
    await flushPromises();
    api.respond([]);
    client.leave();
    await flushPromises();

    expect(client.getSnapshot().connection).toBe("idle");
    expect(storage.has("tetherbound.room.ABC9Z")).toBe(false);
    expect(api.calls[1].url).toBe("/api/rooms/ABC9Z/leave");
    expect(new Headers(api.calls[1].init.headers).get("authorization")).toBe(
      "Bearer session-token",
    );
    expect(bodyOf(api.calls[1])).toEqual({ type: "leave_room" });
  });
});

function createClient(api: ReturnType<typeof createApi>, overrides: Partial<RoomClientOptions> = {}) {
  return new RoomClient({
    fetch: api.fetch,
    getApiUrl: () => "/api/rooms",
    requestTimeoutMs: 50,
    maxInitialConnectionAttempts: 3,
    maxReconnectAttempts: 3,
    retryDelays: [5],
    retryJitterMs: 0,
    playingPollIntervalMs: 125,
    idlePollIntervalMs: 500,
    ...overrides,
  });
}

function createApi() {
  const calls: ApiCall[] = [];
  const replies: Reply[] = [];
  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    const reply = replies.shift();
    if (!reply) throw new Error("No fake API response queued");
    return reply();
  }) as typeof globalThis.fetch;

  return {
    calls,
    fetch,
    respond(messages: ServerMessage[], status = 200) {
      replies.push(async () => apiResponse(messages, status));
    },
    reject(error = new TypeError("Network unavailable")) {
      replies.push(async () => Promise.reject(error));
    },
    defer() {
      let resolve!: (response: Response) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<Response>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      replies.push(() => promise);
      return { resolve, reject };
    },
  };
}

function apiResponse(messages: ServerMessage[], status = 200) {
  return new Response(JSON.stringify({ messages, serverTime: Date.now() }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function bodyOf(call: ApiCall) {
  return JSON.parse(String(call.init.body));
}

async function flushPromises() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function welcomeMessage(
  overrides: Partial<Extract<ServerMessage, { type: "welcome" }>> = {},
): Extract<ServerMessage, { type: "welcome" }> {
  return {
    type: "welcome",
    playerId: "player",
    sessionToken: "session-token",
    reconnected: false,
    room: lobbyRoom(),
    ...overrides,
  };
}

function lobbyRoom() {
  return {
    code: "ABC9Z",
    revision: 1,
    playerLimit: 2 as const,
    phase: "lobby" as const,
    players: [{ id: "player" as const, name: "Host", ready: false, connected: true }],
    winner: null,
    finishReason: null,
  };
}

function roomStateMessage(
  phase: "lobby" | "playing" | "finished",
  revision: number,
): Extract<ServerMessage, { type: "room_state" }> {
  return {
    type: "room_state",
    room: { ...lobbyRoom(), phase, revision },
  };
}

function pongMessage(sentAt: number): Extract<ServerMessage, { type: "pong" }> {
  return { type: "pong", sentAt, serverTime: Date.now() };
}

function gameStateMessage(): Extract<ServerMessage, { type: "game_state" }> {
  return {
    type: "game_state",
    state: createInitialGameState("room-client-test", 2),
    stateVersion: 7,
    lastProcessedInput: { player: 0 },
    serverTime: Date.now(),
  };
}
