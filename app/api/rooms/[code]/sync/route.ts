import { syncRoom, type SyncRoomBody } from "@/sites-server/roomService";
import {
  bearerToken,
  readJsonBody,
  roomDatabase,
  roomServiceResponse,
} from "../../_http";

type RouteContext = { params: Promise<{ code: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  return roomServiceResponse(async () => {
    const [{ code }, body] = await Promise.all([
      params,
      readJsonBody<SyncRoomBody>(request),
    ]);
    return syncRoom(roomDatabase(), code, bearerToken(request), body);
  });
}
