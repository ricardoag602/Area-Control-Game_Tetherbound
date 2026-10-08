# Tetherbound

**How far from safety will you go for power?**

Tetherbound is a mobile-first, two-player territory game about extending fragile life-support networks across an alien surface.

## Run locally

```sh
npm install
npm run dev
```

The single development command starts:

- The Vite web client on port `5173`
- The authoritative WebSocket room server on port `8788`

The terminal prints both a local URL and a network URL.

## Controls

- Drag anywhere in the arena to walk. Movement accelerates and settles smoothly.
- On desktop, use **WASD** or the **arrow keys** for directional walking, including normalized diagonals.
- To boost with the keyboard, tap a direction, press that same key again, and hold the second press to charge. Release to launch.
- Keyboard and pointer controls hand off automatically to whichever one you use most recently.
- Press and hold your astronaut, then drag to aim a momentum burst.
- The astronaut lunges briefly, then slows during the first second of the hold. Release after the ring flashes at two seconds for maximum distance, or release sooner for a shorter burst.
- Select **Deploy** while connected to your tether network to place an available anchor.

## Test multiplayer

### Two browser tabs

1. Open the local URL in the first tab.
2. Select **Create Multiplayer Room**, enter a name, and create the room.
3. Copy the invitation link or note the five-character room code.
4. In a second tab, open the link or select **Join Multiplayer Room** and enter the code, then join with a different name.
5. Mark both players ready.
6. Move or deploy a tether in either tab and verify the other tab updates.
7. Refresh either tab to verify it reconnects to the same player slot.

### Computer and phone

Open the printed **Network** URL on the computer before creating the room. The resulting invitation link will then contain the computer's LAN address instead of `127.0.0.1`, allowing a phone on the same network to connect.

## Reliability model

- The server owns movement, oxygen, salvage, tethers, timer, and scoring.
- The server simulates rooms and sends full state snapshots at 20 Hz.
- Bot and multiplayer matches share a fixed 20 Hz rules step with bounded catch-up, so charge timing stays consistent across frame-rate dips.
- Movement inputs carry increasing sequence numbers.
- Movement edges are queued in order, so a quick charge and release cannot disappear between server ticks.
- Fast bursts use swept pickup checks, preventing players from skipping through salvage between snapshots.
- Multiplayer positions are visually smoothed without changing the server-owned game state.
- Discrete actions are acknowledged and retried by unique ID, preventing loss or duplicate tether deployment.
- Refreshes resume through an opaque session token stored only in the joining browser session.
- Initial room requests are idempotent, so retrying a lost handshake cannot create duplicate rooms or players.
- Disconnected slots are reserved for 30 seconds, and the match pauses during that recovery window.
- Transport heartbeats remove dead sockets.
- Application ping/pong messages report smoothed round-trip latency in the lobby and match HUD.
- Reconnect attempts use capped exponential backoff with jitter.
- Runtime validation, message-rate limits, bounded action history, and snapshot backpressure protect the server from malformed or slow clients.
- Finished matches show a result screen and support a two-player rematch vote.

## Main modules

- `server/RoomServer.ts` — room lifecycle, authoritative simulation, heartbeat, and reconnect handling
- `src/network/RoomClient.ts` — socket lifecycle, session resume, backoff, and latency tracking
- `src/network/protocol.ts` — shared network message contracts
- `src/game/movement.ts` — walking, charge, burst, and movement feel rules
- `src/game/simulation.ts` — transport-independent game rules
- `src/game/components/MatchScreen.tsx` — shared bot and multiplayer match presentation

## Verification

```sh
npm test
npm run build
npm audit
```

The test suite includes real two-client WebSocket coverage for room creation, joining, ready/start, synchronized movement, malformed traffic, idempotent requests and deployment, action acknowledgement, latency echo, disconnect pausing, session resume, and rematches.

## Configuration

- `TETHERBOUND_WS_PORT` changes the room-server port.
- `VITE_WS_URL` overrides the WebSocket address used by the client, which is required when the public web client and room server use different hosts.
