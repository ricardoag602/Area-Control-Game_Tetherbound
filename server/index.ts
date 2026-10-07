import { RoomServer } from "./RoomServer";

const port = Number(process.env.TETHERBOUND_WS_PORT ?? 8788);
const server = new RoomServer({ port });

server.webSocketServer.on("listening", () => {
  console.log(`Tetherbound room server listening on ws://0.0.0.0:${port}`);
});

async function shutdown() {
  await server.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
