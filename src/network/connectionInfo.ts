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

export function resolveRoomServerUrl(
  location: Pick<Location, "protocol" | "hostname"> &
    Partial<Pick<Location, "host" | "pathname">>,
  configuredUrl?: string,
) {
  if (configuredUrl) return configuredUrl;
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  if (isLoopbackHostname(location.hostname)) {
    const hostname = location.hostname === "::1" ? "[::1]" : location.hostname;
    return `${protocol}//${hostname}:8788/ws`;
  }

  const host = location.host ?? location.hostname;
  return `${protocol}//${host}${roomServerPath(location.pathname ?? "/")}`;
}

export function isLoopbackHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function roomServerPath(pathname: string) {
  if (pathname.endsWith("/")) return `${pathname}ws`;

  const lastSlash = pathname.lastIndexOf("/");
  const finalSegment = pathname.slice(lastSlash + 1);
  if (finalSegment.includes(".")) {
    return `${pathname.slice(0, lastSlash + 1)}ws`;
  }
  return `${pathname}/ws`;
}
