import { createRoom } from "@/sites-server/roomService";
import {
  readClientMessage,
  roomDatabase,
  roomServiceResponse,
} from "../_http";

export async function POST(request: Request) {
  return roomServiceResponse(async () => {
    const message = await readClientMessage(request, "create_room");
    return createRoom(roomDatabase(), message);
  });
}
