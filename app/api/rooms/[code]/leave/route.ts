import { leaveRoom } from "@/sites-server/roomService";
import {
  bearerToken,
  roomDatabase,
  roomServiceResponse,
} from "../../_http";

type RouteContext = { params: Promise<{ code: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  return roomServiceResponse(async () => {
    const { code } = await params;
    return leaveRoom(roomDatabase(), code, bearerToken(request));
  });
}
