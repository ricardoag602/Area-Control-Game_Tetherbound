import { joinRoom } from "@/sites-server/roomService";
import {
  readClientMessage,
  roomDatabase,
  roomServiceResponse,
} from "../../_http";

type RouteContext = { params: Promise<{ code: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  return roomServiceResponse(async () => {
    const [{ code }, message] = await Promise.all([
      params,
      readClientMessage(request, "join_room"),
    ]);
    return joinRoom(roomDatabase(), { ...message, code });
  });
}
