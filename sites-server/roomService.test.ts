import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "../src/network/protocol";
import {
  createRoom,
  joinRoom,
  leaveRoom,
  RoomServiceError,
  syncRoom,
  type D1DatabaseLike,
  type D1PreparedStatementLike,
  type D1ResultLike,
} from "./roomService";

class SqliteStatement implements D1PreparedStatementLike {
  constructor(
    readonly database: DatabaseSync,
    readonly query: string,
    readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new SqliteStatement(this.database, this.query, values);
  }

  async first<T = Record<string, unknown>>(columnName?: string) {
    const row = this.database.prepare(this.query).get(...this.sqlValues()) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return (columnName ? row[columnName] : row) as T;
  }

  async all<T = Record<string, unknown>>() {
    const results = this.database.prepare(this.query).all(...this.sqlValues()) as T[];
    return { results, success: true, meta: { changes: results.length } };
  }

  async run<T = Record<string, unknown>>() {
    if (/\bRETURNING\b/i.test(this.query)) {
      const results = this.database.prepare(this.query).all(...this.sqlValues()) as T[];
      return { results, success: true, meta: { changes: results.length } };
    }
    const result = this.database.prepare(this.query).run(...this.sqlValues());
    return {
      results: [],
      success: true,
      meta: { changes: Number(result.changes) },
    } satisfies D1ResultLike<T>;
  }

  private sqlValues() {
    return this.values as SQLInputValue[];
  }
}

class SqliteD1 implements D1DatabaseLike {
  readonly database = new DatabaseSync(":memory:");

  constructor() {
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec(`
      CREATE TABLE rooms (
        code TEXT PRIMARY KEY NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        document TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE create_requests (
        request_id TEXT PRIMARY KEY NOT NULL,
        room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
        created_at INTEGER NOT NULL
      );
    `);
  }

  prepare(query: string) {
    return new SqliteStatement(this.database, query);
  }

  async batch<T = Record<string, unknown>>(statements: D1PreparedStatementLike[]) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results: D1ResultLike<T>[] = [];
      for (const statement of statements) {
        results.push(await statement.run<T>());
      }
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.database.close();
  }
}

function message<T extends ServerMessage["type"]>(
  messages: ServerMessage[],
  type: T,
) {
  return messages.find(
    (candidate): candidate is Extract<ServerMessage, { type: T }> =>
      candidate.type === type,
  );
}

describe("D1 room service", () => {
  let db: SqliteD1;
  let now = 1_000_000;

  beforeEach(() => {
    db = new SqliteD1();
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
  });

  it("creates and replays a room creation without duplicating it", async () => {
    const request = {
      type: "create_room",
      requestId: "create-idempotency-request",
      name: "Host",
      playerLimit: 2,
    } as const;

    const first = await createRoom(db, request);
    const replay = await createRoom(db, request);
    const firstWelcome = message(first.messages, "welcome")!;
    const replayWelcome = message(replay.messages, "welcome")!;

    expect(replayWelcome.room.code).toBe(firstWelcome.room.code);
    expect(replayWelcome.playerId).toBe(firstWelcome.playerId);
    expect(replayWelcome.sessionToken).toBe(firstWelcome.sessionToken);
    expect(
      db.database.prepare("SELECT count(*) AS count FROM rooms").get(),
    ).toEqual({ count: 1 });
  });

  it("joins, starts, advances, acknowledges actions, and leaves", async () => {
    const created = await createRoom(db, {
      type: "create_room",
      requestId: "full-journey-create",
      name: "Host",
      playerLimit: 2,
    });
    const hostWelcome = message(created.messages, "welcome")!;
    const joined = await joinRoom(db, {
      type: "join_room",
      requestId: "full-journey-join",
      code: hostWelcome.room.code,
      name: "Guest",
    });
    const guestWelcome = message(joined.messages, "welcome")!;

    await syncRoom(db, hostWelcome.room.code, hostWelcome.sessionToken, {
      knownRoomRevision: hostWelcome.room.revision,
      knownStateVersion: 0,
      sentAt: 10,
      commands: [{ type: "set_ready", ready: true }],
    });
    const started = await syncRoom(
      db,
      hostWelcome.room.code,
      guestWelcome.sessionToken,
      {
        knownRoomRevision: guestWelcome.room.revision,
        knownStateVersion: 0,
        sentAt: 20,
        commands: [{ type: "set_ready", ready: true }],
      },
    );
    const initialState = message(started.messages, "game_state")!;
    expect(message(started.messages, "room_state")?.room.phase).toBe("playing");

    now += 100;
    await syncRoom(db, hostWelcome.room.code, hostWelcome.sessionToken, {
      knownRoomRevision: 0,
      knownStateVersion: initialState.stateVersion,
      commands: [{
        type: "movement_input",
        seq: 1,
        command: { type: "walk_direction", direction: { x: 0, y: -1 } },
      }],
    });
    now += 100;
    const moved = await syncRoom(
      db,
      hostWelcome.room.code,
      guestWelcome.sessionToken,
      { knownRoomRevision: 0, knownStateVersion: initialState.stateVersion },
    );
    const movedState = message(moved.messages, "game_state")!;
    expect(movedState.lastProcessedInput.player).toBe(1);
    expect(
      movedState.state.players.player.astronaut.position.y,
    ).toBeLessThan(initialState.state.players.player.astronaut.position.y);

    const deployed = await syncRoom(
      db,
      hostWelcome.room.code,
      hostWelcome.sessionToken,
      {
        knownRoomRevision: 0,
        knownStateVersion: movedState.stateVersion,
        commands: [{ type: "deploy_anchor", actionId: "deploy-once" }],
      },
    );
    const firstAck = message(deployed.messages, "action_ack")!;
    const replayed = await syncRoom(
      db,
      hostWelcome.room.code,
      hostWelcome.sessionToken,
      {
        knownRoomRevision: 0,
        knownStateVersion: movedState.stateVersion,
        commands: [{ type: "deploy_anchor", actionId: "deploy-once" }],
      },
    );
    expect(message(replayed.messages, "action_ack")).toEqual(firstAck);

    await leaveRoom(db, hostWelcome.room.code, guestWelcome.sessionToken);
    const final = await syncRoom(
      db,
      hostWelcome.room.code,
      hostWelcome.sessionToken,
      { knownRoomRevision: 0, knownStateVersion: 0 },
    );
    expect(message(final.messages, "room_state")?.room.phase).toBe("finished");
    expect(message(final.messages, "room_state")?.room.finishReason).toBe("disconnect");
  });

  it("expires an idle lobby and its creation idempotency record", async () => {
    const created = await createRoom(db, {
      type: "create_room",
      requestId: "idle-expiry-create",
      name: "Host",
      playerLimit: 2,
    });
    const welcome = message(created.messages, "welcome")!;
    now += 15 * 60 * 1000 + 1;

    await expect(
      syncRoom(db, welcome.room.code, welcome.sessionToken, {}),
    ).rejects.toMatchObject<Partial<RoomServiceError>>({
      code: "room_not_found",
      recoverable: false,
      httpStatus: 404,
    });
    expect(
      db.database.prepare("SELECT count(*) AS count FROM rooms").get(),
    ).toEqual({ count: 0 });
    expect(
      db.database.prepare("SELECT count(*) AS count FROM create_requests").get(),
    ).toEqual({ count: 0 });
  });
});
