export const ROOM_CODE_LENGTH = 5;

const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{5}$/;

export function normalizeRoomCode(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, ROOM_CODE_LENGTH);
}

export function isValidRoomCode(value: string) {
  return ROOM_CODE_PATTERN.test(value);
}

export function createGameAddress(currentUrl: string) {
  const url = new URL(currentUrl);
  url.searchParams.delete("room");
  url.hash = "";
  return url.toString();
}

export function createInvitationLink(currentUrl: string, roomCode: string) {
  const url = new URL(createGameAddress(currentUrl));
  url.searchParams.set("room", normalizeRoomCode(roomCode));
  return url.toString();
}

export function resolveRoomApiUrl(
  _location: Pick<Location, "protocol" | "hostname"> &
    Partial<Pick<Location, "host" | "pathname">>,
  configuredUrl?: string,
) {
  return (configuredUrl?.trim() || "/api/rooms").replace(/\/+$/, "");
}

/** Backwards-compatible alias for older UI and test imports. */
export const resolveRoomServerUrl = resolveRoomApiUrl;

export function isLoopbackHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}
