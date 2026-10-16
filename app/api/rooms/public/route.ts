import { listPublicRooms } from "@/sites-server/roomService";
import { roomDatabase, roomServiceResponse } from "../_http";

export async function GET() {
  return roomServiceResponse(() => listPublicRooms(roomDatabase()));
}
