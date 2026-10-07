import { useSyncExternalStore } from "react";
import type { RoomClient } from "./RoomClient";

export function useRoomClient(client: RoomClient) {
  return useSyncExternalStore(client.subscribe, client.getSnapshot);
}
