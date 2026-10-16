import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * A room is deliberately stored as one versioned document. Every gameplay
 * mutation can then use a single compare-and-swap update, which keeps two
 * concurrent polling requests from advancing the authoritative simulation
 * independently.
 */
export const rooms = sqliteTable(
  "rooms",
  {
    code: text("code").primaryKey(),
    version: integer("version").notNull().default(1),
    document: text("document").notNull(),
    updatedAt: integer("updated_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [index("rooms_expires_at_idx").on(table.expiresAt)],
);

/**
 * Creation requests need a global idempotency key because their room code is
 * not known to the client yet. Join/action idempotency lives inside the room
 * document and is serialized by the room CAS.
 */
export const createRequests = sqliteTable(
  "create_requests",
  {
    requestId: text("request_id").primaryKey(),
    roomCode: text("room_code")
      .notNull()
      .references(() => rooms.code, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("create_requests_room_code_idx").on(table.roomCode)],
);
