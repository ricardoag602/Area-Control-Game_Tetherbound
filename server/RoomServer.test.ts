import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { ClientMessage, ServerMessage } from "../src/network/protocol";
import { RoomServer } from "./RoomServer";

const openServers: RoomServer[] = [];
const openSockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of openSockets.splice(0)) socket.terminate();
  for (const server of openServers.splice(0)) await server.close();
});

async function createServer() {
  const server = new RoomServer({ port: 0, host: "127.0.0.1", disconnectGraceMs: 2_000 });
  openServers.push(server);
  await once(server.webSocketServer, "listening");
  return server;
}

async function connect(server: RoomServer) {
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
  openSockets.push(socket);
  await once(socket, "open");
  return socket;
}

function send(socket: WebSocket, message: ClientMessage) {
  socket.send(JSON.stringify(message));
}

function sendRaw(socket: WebSocket, value: unknown) {
  socket.send(typeof value === "string" ? value : JSON.stringify(value));
}

function waitForMessage<T extends ServerMessage>(
  socket: WebSocket,
  predicate: (message: ServerMessage) => message is T,
  timeoutMs = 1_500,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", handleMessage);
      reject(new Error("Timed out waiting for WebSocket message"));
    }, timeoutMs);

    function handleMessage(data: WebSocket.RawData) {
      const message = JSON.parse(data.toString()) as ServerMessage;
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.off("message", handleMessage);
      resolve(message);
    }

    socket.on("message", handleMessage);
  });
}

const isWelcome = (message: ServerMessage): message is Extract<ServerMessage, { type: "welcome" }> =>
  message.type === "welcome";
const isGameState = (message: ServerMessage): message is Extract<ServerMessage, { type: "game_state" }> =>
  message.type === "game_state";
const isError = (message: ServerMessage): message is Extract<ServerMessage, { type: "error" }> =>
  message.type === "error";
const isActionAck = (message: ServerMessage): message is Extract<ServerMessage, { type: "action_ack" }> =>
  message.type === "action_ack";

async function waitUntil(predicate: () => boolean, timeoutMs = 1_500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}

async function createStartedRoom(server: RoomServer) {
  const host = await connect(server);
  const hostWelcomePromise = waitForMessage(host, isWelcome);
  send(host, {
    type: "create_room",
    requestId: "started-create-request",
    name: "Host",
    playerLimit: 2,
  });
  const hostWelcome = await hostWelcomePromise;

  const guest = await connect(server);
  const guestWelcomePromise = waitForMessage(guest, isWelcome);
  send(guest, {
    type: "join_room",
    requestId: "started-join-request",
    code: hostWelcome.room.code,
    name: "Guest",
  });
  const guestWelcome = await guestWelcomePromise;

  const hostInitialPromise = waitForMessage(host, isGameState);
  const guestInitialPromise = waitForMessage(guest, isGameState);
  send(host, { type: "set_ready", ready: true });
  send(guest, { type: "set_ready", ready: true });
  const [hostInitial, guestInitial] = await Promise.all([
    hostInitialPromise,
    guestInitialPromise,
  ]);

  return { host, guest, hostWelcome, guestWelcome, hostInitial, guestInitial };
}

describe("RoomServer", () => {
  it("creates, joins, starts, synchronizes, measures RTT, and resumes a two-player room", async () => {
    const server = await createServer();
    const host = await connect(server);
    const hostWelcomePromise = waitForMessage(host, isWelcome);
    send(host, {
      type: "create_room",
      requestId: "journey-create-request",
      name: "Host",
      playerLimit: 2,
    });
    const hostWelcome = await hostWelcomePromise;

    expect(hostWelcome.playerId).toBe("player");
    expect(hostWelcome.room.code).toMatch(/^[A-Z2-9]{5}$/);

    const guest = await connect(server);
    const guestWelcomePromise = waitForMessage(guest, isWelcome);
    send(guest, {
      type: "join_room",
      requestId: "journey-join-request",
      code: hostWelcome.room.code,
      name: "Guest",
    });
    const guestWelcome = await guestWelcomePromise;

    expect(guestWelcome.playerId).toBe("rival");
    expect(guestWelcome.room.players).toHaveLength(2);

    const hostStarted = waitForMessage(host, isGameState);
    const guestStarted = waitForMessage(guest, isGameState);
    send(host, { type: "set_ready", ready: true });
    send(guest, { type: "set_ready", ready: true });
    const [hostInitial, guestInitial] = await Promise.all([hostStarted, guestStarted]);
    expect(hostInitial.state).toEqual(guestInitial.state);

    const movementOnHost = waitForMessage(host, (message): message is Extract<ServerMessage, { type: "game_state" }> =>
      message.type === "game_state" && message.lastProcessedInput.player === 1 &&
      message.state.players.player.astronaut.position.y < hostInitial.state.players.player.astronaut.position.y,
    );
    const movementOnGuest = waitForMessage(guest, (message): message is Extract<ServerMessage, { type: "game_state" }> =>
      message.type === "game_state" && message.lastProcessedInput.player === 1 &&
      message.state.players.player.astronaut.position.y < guestInitial.state.players.player.astronaut.position.y,
    );
    send(host, { type: "move_target", seq: 1, target: { x: 50, y: 100 } });
    const [hostMoved, guestMoved] = await Promise.all([movementOnHost, movementOnGuest]);
    expect(hostMoved.stateVersion).toBe(guestMoved.stateVersion);

    send(host, { type: "move_target", seq: 2, target: null });
    const actionId = "deploy-once";
    send(host, { type: "deploy_anchor", actionId });
    send(host, { type: "deploy_anchor", actionId });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const authoritativeRoom = server.rooms.get(hostWelcome.room.code);
    expect(authoritativeRoom?.gameState?.anchors.filter((anchor) => anchor.owner === "player")).toHaveLength(1);

    const pingStartedAt = performance.now();
    const sentAt = 1234.5;
    const pongPromise = waitForMessage(host, (message): message is Extract<ServerMessage, { type: "pong" }> =>
      message.type === "pong" && message.sentAt === sentAt,
    );
    send(host, { type: "ping", sentAt });
    expect((await pongPromise).serverTime).toBeGreaterThan(0);
    expect(performance.now() - pingStartedAt).toBeLessThan(500);

    const disconnectedNotice = waitForMessage(host, (message): message is Extract<ServerMessage, { type: "room_state" }> =>
      message.type === "room_state" && message.room.players.some(
        (player) => player.id === "rival" && !player.connected,
      ),
    );
    guest.terminate();
    await disconnectedNotice;

    const resumedGuest = await connect(server);
    const resumedWelcomePromise = waitForMessage(resumedGuest, isWelcome);
    send(resumedGuest, {
      type: "join_room",
      requestId: "journey-resume-request",
      code: hostWelcome.room.code,
      name: "Guest",
      sessionToken: guestWelcome.sessionToken,
    });
    const resumedWelcome = await resumedWelcomePromise;
    expect(resumedWelcome.reconnected).toBe(true);
    expect(resumedWelcome.playerId).toBe("rival");
  });

  it("rejects unknown rooms without creating client state", async () => {
    const server = await createServer();
    const socket = await connect(server);
    const errorPromise = waitForMessage(socket, (message): message is Extract<ServerMessage, { type: "error" }> =>
      message.type === "error",
    );
    send(socket, {
      type: "join_room",
      requestId: "unknown-room-request",
      code: "ZZZZZ",
      name: "Lost",
    });
    const error = await errorPromise;
    expect(error.code).toBe("room_not_found");
    expect(error.recoverable).toBe(false);
  });

  it("rejects malformed JSON and invalid field shapes without losing the connection", async () => {
    const server = await createServer();
    const socket = await connect(server);

    const malformedErrorPromise = waitForMessage(socket, isError);
    sendRaw(socket, "{not-json");
    const malformedError = await malformedErrorPromise;
    expect(malformedError.code).toBe("invalid_message");
    expect(malformedError.recoverable).toBe(true);

    const invalidShapeErrorPromise = waitForMessage(socket, isError);
    sendRaw(socket, {
      type: "join_room",
      requestId: 42,
      code: { unsafe: true },
      name: ["not", "a", "name"],
    });
    const invalidShapeError = await invalidShapeErrorPromise;
    expect(invalidShapeError.code).toBe("invalid_message");
    expect(invalidShapeError.recoverable).toBe(true);

    const welcomePromise = waitForMessage(socket, isWelcome);
    send(socket, {
      type: "create_room",
      requestId: "valid-after-invalid-request",
      name: "Still Connected",
      playerLimit: 2,
    });
    const welcome = await welcomePromise;
    expect(welcome.room.code).toMatch(/^[A-Z2-9]{5}$/);
    expect(socket.readyState).toBe(WebSocket.OPEN);
  });

  it("replays create and join request IDs on new sockets without duplicating room state", async () => {
    const server = await createServer();
    const createRequest = {
      type: "create_room",
      requestId: "idempotent-create-request",
      name: "Host",
      playerLimit: 2,
    } as const satisfies ClientMessage;

    const firstHost = await connect(server);
    const firstHostWelcomePromise = waitForMessage(firstHost, isWelcome);
    send(firstHost, createRequest);
    const firstHostWelcome = await firstHostWelcomePromise;

    const resumedHost = await connect(server);
    const resumedHostWelcomePromise = waitForMessage(resumedHost, isWelcome);
    send(resumedHost, createRequest);
    const resumedHostWelcome = await resumedHostWelcomePromise;
    expect(resumedHostWelcome.room.code).toBe(firstHostWelcome.room.code);
    expect(resumedHostWelcome.playerId).toBe(firstHostWelcome.playerId);
    expect(resumedHostWelcome.sessionToken).toBe(firstHostWelcome.sessionToken);
    expect(resumedHostWelcome.reconnected).toBe(true);
    expect(server.rooms.size).toBe(1);

    const joinRequest = {
      type: "join_room",
      requestId: "idempotent-join-request",
      code: firstHostWelcome.room.code,
      name: "Guest",
    } as const satisfies ClientMessage;
    const firstGuest = await connect(server);
    const firstGuestWelcomePromise = waitForMessage(firstGuest, isWelcome);
    send(firstGuest, joinRequest);
    const firstGuestWelcome = await firstGuestWelcomePromise;

    const resumedGuest = await connect(server);
    const resumedGuestWelcomePromise = waitForMessage(resumedGuest, isWelcome);
    send(resumedGuest, joinRequest);
    const resumedGuestWelcome = await resumedGuestWelcomePromise;
    expect(resumedGuestWelcome.room.code).toBe(firstGuestWelcome.room.code);
    expect(resumedGuestWelcome.playerId).toBe(firstGuestWelcome.playerId);
    expect(resumedGuestWelcome.sessionToken).toBe(firstGuestWelcome.sessionToken);
    expect(resumedGuestWelcome.reconnected).toBe(true);
    expect(server.rooms.get(firstHostWelcome.room.code)?.players.size).toBe(2);
  });

  it("rejects another initial attachment request on a socket already in a room", async () => {
    const server = await createServer();
    const host = await connect(server);
    const welcomePromise = waitForMessage(host, isWelcome);
    send(host, {
      type: "create_room",
      requestId: "attached-create-request",
      name: "Host",
      playerLimit: 2,
    });
    const welcome = await welcomePromise;

    const createErrorPromise = waitForMessage(host, isError);
    send(host, {
      type: "create_room",
      requestId: "duplicate-create-request",
      name: "Duplicate",
      playerLimit: 2,
    });
    const createError = await createErrorPromise;
    expect(createError).toMatchObject({ code: "already_joined", recoverable: true });

    const joinErrorPromise = waitForMessage(host, isError);
    send(host, {
      type: "join_room",
      requestId: "duplicate-join-request",
      code: welcome.room.code,
      name: "Duplicate",
    });
    const joinError = await joinErrorPromise;
    expect(joinError).toMatchObject({ code: "already_joined", recoverable: true });
    expect(host.readyState).toBe(WebSocket.OPEN);
    expect(server.rooms.get(welcome.room.code)?.players.size).toBe(1);
  });

  it("pauses the authoritative match timer until a disconnected player resumes", async () => {
    const server = await createServer();
    const { host, guest, hostWelcome, guestWelcome } = await createStartedRoom(server);

    const disconnectedNoticePromise = waitForMessage(
      host,
      (message): message is Extract<ServerMessage, { type: "room_state" }> =>
        message.type === "room_state" &&
        message.room.players.some((player) => player.id === "rival" && !player.connected),
    );
    guest.terminate();
    await disconnectedNoticePromise;

    const room = server.rooms.get(hostWelcome.room.code);
    expect(room?.gameState).not.toBeNull();
    const pausedAt = room?.gameState?.remainingMs;
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(room?.gameState?.remainingMs).toBe(pausedAt);

    const resumedGuest = await connect(server);
    const resumedWelcomePromise = waitForMessage(resumedGuest, isWelcome);
    send(resumedGuest, {
      type: "join_room",
      requestId: "timer-resume-request",
      code: hostWelcome.room.code,
      name: "Guest",
      sessionToken: guestWelcome.sessionToken,
    });
    expect((await resumedWelcomePromise).reconnected).toBe(true);

    const resumedAt = room?.gameState?.remainingMs ?? 0;
    await waitUntil(() => (room?.gameState?.remainingMs ?? resumedAt) < resumedAt);
  });

  it("acknowledges a deploy action and replays its result without deploying twice", async () => {
    const server = await createServer();
    const { host, hostWelcome } = await createStartedRoom(server);
    const actionId = "acknowledged-deploy";

    const firstAckPromise = waitForMessage(
      host,
      (message): message is Extract<ServerMessage, { type: "action_ack" }> =>
        isActionAck(message) && message.actionId === actionId,
    );
    send(host, { type: "deploy_anchor", actionId });
    const firstAck = await firstAckPromise;
    expect(firstAck).toEqual({ type: "action_ack", actionId, accepted: true });
    expect(
      server.rooms
        .get(hostWelcome.room.code)
        ?.gameState?.anchors.filter((anchor) => anchor.owner === "player"),
    ).toHaveLength(1);

    const repeatedAckPromise = waitForMessage(
      host,
      (message): message is Extract<ServerMessage, { type: "action_ack" }> =>
        isActionAck(message) && message.actionId === actionId,
    );
    send(host, { type: "deploy_anchor", actionId });
    const repeatedAck = await repeatedAckPromise;
    expect(repeatedAck).toEqual(firstAck);
    expect(
      server.rooms
        .get(hostWelcome.room.code)
        ?.gameState?.anchors.filter((anchor) => anchor.owner === "player"),
    ).toHaveLength(1);
  });

  it("requires both finished players to request a rematch, then starts a fresh match", async () => {
    const server = await createServer();
    const { host, guest, hostWelcome, hostInitial } = await createStartedRoom(server);
    const room = server.rooms.get(hostWelcome.room.code);
    if (!room?.gameState) throw new Error("Expected a running match");

    room.gameState.players.player.astronaut.oxygen = 7;
    room.gameState.players.player.astronaut.respawns = 3;
    room.gameState.remainingMs = 1;

    const finishedPromise = waitForMessage(
      host,
      (message): message is Extract<ServerMessage, { type: "room_state" }> =>
        message.type === "room_state" && message.room.phase === "finished",
    );
    const finished = await finishedPromise;
    expect(finished.room.players.every((player) => !player.ready)).toBe(true);

    const hostVotePromise = waitForMessage(
      host,
      (message): message is Extract<ServerMessage, { type: "room_state" }> =>
        message.type === "room_state" &&
        message.room.phase === "finished" &&
        message.room.players.some((player) => player.id === "player" && player.ready),
    );
    send(host, { type: "request_rematch" });
    const hostVote = await hostVotePromise;
    expect(hostVote.room.players.find((player) => player.id === "rival")?.ready).toBe(false);

    const restartedRoomPromise = waitForMessage(
      host,
      (message): message is Extract<ServerMessage, { type: "room_state" }> =>
        message.type === "room_state" && message.room.phase === "playing",
    );
    const hostRematchStatePromise = waitForMessage(host, isGameState);
    const guestRematchStatePromise = waitForMessage(guest, isGameState);
    send(guest, { type: "request_rematch" });
    const [restartedRoom, hostRematchState, guestRematchState] = await Promise.all([
      restartedRoomPromise,
      hostRematchStatePromise,
      guestRematchStatePromise,
    ]);

    expect(restartedRoom.room.players.every((player) => !player.ready)).toBe(true);
    expect(hostRematchState.state).toEqual(guestRematchState.state);
    expect(hostRematchState.state.remainingMs).toBe(hostInitial.state.remainingMs);
    expect(hostRematchState.state.players.player.astronaut.oxygen).toBe(
      hostInitial.state.players.player.astronaut.oxygen,
    );
    expect(hostRematchState.state.players.player.astronaut.respawns).toBe(0);
  });
});
