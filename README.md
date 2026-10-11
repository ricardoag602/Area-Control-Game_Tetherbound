# Tetherbound

**How far from safety will you go for power?**

Tetherbound is a mobile-first, two-player territory game about extending fragile life-support networks across an alien surface.

The current arena is a 210 × 350 world divided into water, jungle, desert, taiga, and protected base corridors. Terrain changes authoritative movement and oxygen behavior, while a seeded match timeline synchronizes frequent supply drops in bot and multiplayer games.

Where opposing life-support zones overlap, the ground becomes contested and stops scoring for either side. Hold position beside an enemy tether to overload it and sever every downstream zone; return to your own broken tether to repair it early. The network communicates this through closing progress rings, solid or broken cable shapes, and crossed territory hatching rather than another text-heavy HUD.

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
- On desktop, use **W/S** or **up/down** to drive along the astronaut's facing. Use **A/D** or **left/right** to turn. These controls stay active throughout the match, even after using a HUD button.
- To boost with the keyboard, tap **W** or **S**, press that same key again, and hold the second press to charge. You can steer during the charge, but the turn eases to a stop with your movement. Release to launch.
- The charge radar shows your remaining turn envelope and projected launch reach; it narrows as rotational control settles.
- Keyboard and pointer controls hand off automatically to whichever one you use most recently.
- On touch, tap once, then press and hold in the direction you want to charge. Touch uses the same narrowing radar and diminishing turn authority as keyboard charging.
- The astronaut lunges briefly, then slows throughout the charge. Release when the ring flashes after one second for maximum distance, or release sooner for a shorter burst.
- The camera follows your astronaut, eases outward during a charge, and springs back when you launch.
- Below 40% oxygen, the camera closes in slightly while a red edge vignette and subtle wash intensify toward empty.
- The translucent pixel minimap shows biome blocks, tether territory, anchors, and both astronauts. A brief amber landing signal marks each new supply drop.
- Three salvage materials fabricate one tether. The whole home zone accepts deliveries; powered remote anchors use the smaller pulsing hand-in ring. Gold recipe slots are carried material and cyan slots are safely banked.
- Select **Deploy** or press **T** within 84 world units of a powered node to place an available anchor. The long cable connects the nodes, but oxygen and territory still come from their circular zones.
- Stay inside the ring around an enemy anchor to overload it automatically. A nearby defender reverses your progress.
- Stay beside your own directly disabled anchor to repair it. Restored anchors receive a brief protective ring before they can be attacked again.

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

- The server owns movement, oxygen, salvage, tether conflict, timer, and scoring.
- Biome effects and match events use the authoritative elapsed match clock; no gameplay system relies on client timers or `Math.random`.
- Every match event stream is seeded and serializable, allowing identical replay and reconnect behavior.
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

- `src/game/README.md` — game-folder boundaries and dependency rules
- `server/RoomServer.ts` — room lifecycle, authoritative simulation, heartbeat, and reconnect handling
- `src/network/RoomClient.ts` — socket lifecycle, session resume, backoff, and latency tracking
- `src/network/protocol.ts` — shared network message contracts
- `src/game/movement/movement.ts` — walking, charge, burst, and movement feel rules
- `src/game/simulation/` — fixed-step match, tether, environment, event, and scoring systems
- `src/game/simulation/tetherConflict.ts` — overload, repair, recovery protection, and downstream power resolution
- `src/game/world/map.ts` — renderer-independent biome geometry and terrain effects
- `src/game/world/timeline.ts` — deterministic master event timeline and future system hooks
- `src/game/world/territory.ts` — coarse territory sampling shared by scoring and the minimap
- `src/game/presentation/` — pure camera, charge-radar, and oxygen presentation math
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
