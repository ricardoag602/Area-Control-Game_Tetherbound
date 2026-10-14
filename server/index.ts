import { createServer } from "node:http";
import { RoomServer } from "./RoomServer";

const port = readPort(process.env.PORT ?? process.env.TETHERBOUND_WS_PORT);
const host = process.env.TETHERBOUND_HOST ?? "0.0.0.0";
const webSocketPath = normalizePath(process.env.TETHERBOUND_WS_PATH ?? "/ws");
const healthPath = normalizePath(process.env.TETHERBOUND_HEALTH_PATH ?? "/healthz");
const allowedOrigins = (process.env.TETHERBOUND_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const httpServer = createServer((request, response) => {
  const requestPath = new URL(request.url ?? "/", "http://localhost").pathname;
  if ((request.method === "GET" || request.method === "HEAD") && requestPath === healthPath) {
    const body = JSON.stringify({ status: "ok", rooms: roomServer.rooms.size });
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    });
    response.end(request.method === "HEAD" ? undefined : body);
    return;
  }

  response.writeHead(404, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify({ error: "not_found" }));
});
const roomServer = new RoomServer({ httpServer, path: webSocketPath, allowedOrigins });

httpServer.listen(port, host, () => {
  const address = httpServer.address();
  const activePort = typeof address === "object" && address ? address.port : port;
  console.log(`Tetherbound room server listening on http://${host}:${activePort}${webSocketPath}`);
  console.log(`Health check available at http://${host}:${activePort}${healthPath}`);
});

async function shutdown() {
  await roomServer.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function normalizePath(value: string) {
  return `/${value}`.replace(/\/+/g, "/");
}

function readPort(value: string | undefined) {
  const parsed = Number(value ?? 8788);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error(`Invalid room server port: ${value}`);
  }
  return parsed;
}
