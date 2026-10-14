import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "./protocol";
import { RoomClient, type RoomClientOptions } from "./RoomClient";

class FakeSocket extends EventTarget {
  readyState = 0;
  readonly sent: string[] = [];

  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }

  receive(message: ServerMessage) {
    const event = new Event("message") as Event & { data: string };
    Object.defineProperty(event, "data", { value: JSON.stringify(message) });
    this.dispatchEvent(event);
  }

  send(value: string) {
    this.sent.push(value);
  }

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }
}

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
    setInterval: (...args: Parameters<typeof setInterval>) => setInterval(...args),
    clearInterval: (timer: ReturnType<typeof setInterval>) => clearInterval(timer),
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

describe("RoomClient connection lifecycle", () => {
  it("stops retrying and reports an unreachable server when sockets never open", () => {
    const { client, sockets } = createClient({ maxInitialConnectionAttempts: 2 });

    client.createRoom("Host", 2);
    vi.advanceTimersByTime(25);

    expect(sockets).toHaveLength(2);
    expect(client.getSnapshot().connection).toBe("offline");
    expect(client.getSnapshot().error).toMatch(/could not be reached/i);

    vi.advanceTimersByTime(100);
    expect(sockets).toHaveLength(2);
  });

  it("allows a manual retry while preserving the idempotent room request", () => {
    const { client, sockets } = createClient({ maxInitialConnectionAttempts: 1 });

    client.createRoom("Host", 2);
    sockets[0].open();
    const firstRequest = JSON.parse(sockets[0].sent[0]) as { requestId: string };
    vi.advanceTimersByTime(10);
    expect(client.getSnapshot().connection).toBe("offline");

    expect(client.retry()).toBe(true);
    sockets[1].open();
    const retriedRequest = JSON.parse(sockets[1].sent[0]) as { requestId: string };

    expect(retriedRequest.requestId).toBe(firstRequest.requestId);
    expect(client.getSnapshot().connection).toBe("connecting");
    expect(client.getSnapshot().error).toBeNull();
  });

  it("cancels connection deadlines after the room welcomes the player", () => {
    const { client, sockets } = createClient({ maxInitialConnectionAttempts: 1 });

    client.createRoom("Host", 2);
    sockets[0].open();
    sockets[0].receive(welcomeMessage());
    vi.advanceTimersByTime(100);

    expect(client.getSnapshot().connection).toBe("connected");
    expect(client.getSnapshot().room?.code).toBe("ABC9Z");
    expect(sockets).toHaveLength(1);
  });

  it("rejoins an established room with its saved session after a disconnect", () => {
    const { client, sockets } = createClient();

    client.createRoom("Host", 2);
    sockets[0].open();
    const createRequest = JSON.parse(sockets[0].sent[0]) as { requestId: string };
    sockets[0].receive(welcomeMessage());
    sockets[0].close();
    vi.advanceTimersByTime(5);
    sockets[1].open();

    expect(JSON.parse(sockets[1].sent[0])).toEqual({
      type: "join_room",
      requestId: createRequest.requestId,
      code: "ABC9Z",
      name: "Host",
      sessionToken: "session-token",
    });
  });

  it("cancels pending attempts when the player leaves", () => {
    const { client, sockets } = createClient();

    client.createRoom("Host", 2);
    client.leave();
    vi.advanceTimersByTime(100);

    expect(client.getSnapshot().connection).toBe("idle");
    expect(sockets).toHaveLength(1);
  });
});

function createClient(overrides: Partial<RoomClientOptions> = {}) {
  const sockets: FakeSocket[] = [];
  const client = new RoomClient({
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    getServerUrl: () => "wss://rooms.example/ws",
    socketOpenTimeoutMs: 10,
    handshakeTimeoutMs: 10,
    maxInitialConnectionAttempts: 3,
    maxReconnectAttempts: 3,
    retryDelays: [5],
    retryJitterMs: 0,
    ...overrides,
  });
  return { client, sockets };
}

function welcomeMessage(): Extract<ServerMessage, { type: "welcome" }> {
  return {
    type: "welcome",
    playerId: "player",
    sessionToken: "session-token",
    reconnected: false,
    room: {
      code: "ABC9Z",
      revision: 1,
      playerLimit: 2,
      phase: "lobby",
      players: [{ id: "player", name: "Host", ready: false, connected: true }],
      winner: null,
      finishReason: null,
    },
  };
}
