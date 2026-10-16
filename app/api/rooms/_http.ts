import { env } from "cloudflare:workers";
import { parseClientMessage, type ClientMessage } from "@/src/network/protocol";
import {
  RoomServiceError,
  type D1DatabaseLike,
} from "@/sites-server/roomService";

const NO_STORE_HEADERS = { "cache-control": "no-store" };

export function roomDatabase(): D1DatabaseLike {
  if (!env.DB) {
    throw new RoomServiceError(
      "server_unavailable",
      "The multiplayer database is unavailable.",
      true,
      503,
    );
  }

  return env.DB as unknown as D1DatabaseLike;
}

export async function readClientMessage<T extends ClientMessage["type"]>(
  request: Request,
  expectedType: T,
): Promise<Extract<ClientMessage, { type: T }>> {
  const raw = await request.text();
  const message = parseClientMessage(raw);
  if (!message || message.type !== expectedType) throw invalidMessage();
  return message as Extract<ClientMessage, { type: T }>;
}

export async function readJsonBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw invalidMessage();
  }
}

export function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  const token = match?.[1]?.trim();
  if (!token) {
    throw new RoomServiceError(
      "session_expired",
      "This room session is no longer available. Join the room again.",
      false,
      401,
    );
  }
  return token;
}

export async function roomServiceResponse<T extends object>(
  operation: () => Promise<T>,
): Promise<Response> {
  try {
    return Response.json(await operation(), { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof RoomServiceError) {
      return Response.json(
        { messages: [error.toErrorMessage()], serverTime: Date.now() },
        { status: error.httpStatus, headers: NO_STORE_HEADERS },
      );
    }

    console.error("Tetherbound room service failed", error);
    return Response.json(
      {
        messages: [
          {
            type: "error",
            code: "server_error",
            message: "The room service could not complete that request.",
            recoverable: true,
          },
        ],
        serverTime: Date.now(),
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

function invalidMessage() {
  return new RoomServiceError(
    "invalid_message",
    "The room service could not read that request.",
    true,
    400,
  );
}
