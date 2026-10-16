# Tetherbound

**How far from safety will you go for power?**

Tetherbound is a mobile-first, two-to-four-player territory game about extending fragile life-support networks across an alien surface.

The current arena is a 350 × 350 world divided into water, jungle, desert, taiga, and protected base corridors. Two players start opposite one another, three form an equilateral triangle, and four use the cardinal edges. Every layout gives each astronaut the same distance to center, the same radial route tuning, and mirrored starting resources. A seeded match timeline synchronizes frequent supply drops in bot and multiplayer games.

Where opposing life-support zones overlap, the ground becomes contested and stops scoring for either side. Exclusive powered territory outside the guaranteed home safe zones adds to a cumulative match score, rewarding control throughout the match instead of only the final map state. Hold position beside an enemy tether to overload it and sever every downstream zone; return to your own broken tether to repair it early. The network communicates this through closing progress rings, solid or broken cable shapes, and crossed territory hatching rather than another text-heavy HUD.

## Run locally

```sh
npm install
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_flowery_shinobi_shaw.sql
npm run dev
```

The one-time D1 command creates the local room database. The development command then starts the full Sites-compatible app: the game at `/game/` and the same-origin multiplayer API at `/api/rooms`.

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
- The translucent pixel minimap shows biome blocks, tether territory, anchors, and every astronaut. A brief amber landing signal marks each new supply drop.
- Three salvage materials fabricate one tether. The whole home zone accepts deliveries; powered remote anchors use the smaller pulsing hand-in ring. Gold recipe slots are carried material and cyan slots are safely banked.
- Select **Deploy** or press **T** within 84 world units of a powered node to place an available anchor. The long cable connects the nodes, but oxygen and territory still come from their circular zones.
- Stay inside the ring around an enemy anchor to overload it automatically. A nearby defender reverses your progress.
- Stay beside your own directly disabled anchor to repair it early. Otherwise the direct disruption clears after 20 seconds; restored anchors receive a brief protective ring before they can be attacked again.
- After setup, once an opponent has deployed a network, sever every one of its anchors from power and hold inside the exposed home-base collapse zone for 12 seconds to win immediately. A defender in the zone pushes the collapse back, and restoring any powered anchor cancels the attempt.

## Match flow and victory

- Regulation lasts five minutes. The opening 30 seconds are a protected setup period in which players can explore, collect, and deploy, but territory does not score and bases cannot be collapsed.
- After setup, each player earns the fraction of the scorable grid they exclusively control every second: controlling the entire scorable map would earn one point per second. Cells inside any guaranteed home safe zone are excluded from both the owned count and the total; neutral and contested cells earn nothing.
- The top HUD leads with every player's cumulative win points and shows territory share as supporting text. The match clock sits separately on the left.
- The final minute of regulation is the announced **Signal Surge**, when territory contributes at 1.5× its normal rate.
- The four quadrants retain different biome art, while rotationally mirrored routes share the same movement and oxygen tuning so neither spawn receives an opening-speed advantage.
- When regulation expires, a result outside the configured close-score threshold is final. A cumulative-score margin within the 3% threshold sends the match to overtime.
- Overtime lasts at most 60 seconds. Supply drops stop, and the first player to earn five points more than the runner-up during overtime wins. Regulation's cumulative score remains visible but does not cause an instant overtime finish.
- If nobody reaches that lead, the player controlling the most exclusive non-base territory when overtime expires wins. A tie for the lead is a draw.
- Base collapse is the alternate instant win. It cannot begin until the defender has deployed at least one anchor; while none of that player's anchors are powered, an uncontested attacker inside the base zone builds the 12-second collapse meter. Leaving makes progress decay, a defender in the zone reverses it faster, and restoring any powered anchor resets it.
- Bot and multiplayer matches both end on a result screen. Bot games can restart immediately; multiplayer rematches begin after every player votes to play again.

## Test multiplayer

### Multiple browser tabs

1. Open the local URL in the first tab.
2. Select **Create Multiplayer Room**, enter a name, choose a two-, three-, or four-player limit, and create the room.
3. Copy the invitation link or note the five-character room code.
4. In the required additional tabs, open the link or select **Join Multiplayer Room** and enter the code, then join with different names.
5. Mark every player ready.
6. Move or deploy a tether in any tab and verify the others update.
7. Refresh a tab to verify it reconnects to the same player slot.

### Computer and phone

For a production test, open the published Sites address on both devices. For local device testing, use a forwarded or LAN-accessible preview address so both the game and its same-origin room API are reachable.

## Reliability model

- The server owns movement, oxygen, salvage, tether conflict, regulation and overtime clocks, cumulative scoring, base collapse, and match outcomes.
- Biome effects and match events use the authoritative elapsed match clock; no gameplay system relies on client timers or `Math.random`.
- Every match event stream is seeded and serializable, allowing identical replay and reconnect behavior.
- Sites stores every room as a versioned D1 document and advances the authoritative simulation whenever a client synchronizes.
- Clients synchronize at 8 Hz while playing and 2 Hz in lobbies/results; compare-and-swap updates prevent concurrent requests from advancing a room independently.
- Bot and multiplayer matches share a fixed 20 Hz rules step with bounded catch-up, so charge timing stays consistent across frame-rate dips.
- Movement inputs carry increasing sequence numbers.
- Movement edges are queued in order, so a quick charge and release cannot disappear between server ticks.
- Fast bursts use swept pickup checks, preventing players from skipping through salvage between snapshots.
- Multiplayer positions are visually smoothed without changing the server-owned game state.
- Discrete actions are acknowledged and retried by unique ID, preventing loss or duplicate tether deployment.
- Refreshes resume through an opaque session token stored only in the joining browser session.
- Initial room requests are idempotent, so retrying a lost handshake cannot create duplicate rooms or players.
- Disconnected slots are reserved for 30 seconds, and the match pauses during that recovery window.
- Short presence leases detect inactive clients without relying on a long-running server process.
- Application ping/pong messages report smoothed round-trip latency in the lobby and match HUD.
- Reconnect attempts use capped exponential backoff with jitter.
- Runtime validation, message-rate limits, bounded action history, and snapshot backpressure protect the server from malformed or slow clients.
- Finished bot and multiplayer matches show a result screen. Bot matches can restart immediately, while multiplayer requires a unanimous rematch vote.

## Main modules

- `src/game/README.md` — game-folder boundaries and dependency rules
- `sites-server/roomService.ts` — Sites/D1 room lifecycle, authoritative simulation, leases, idempotency, and compare-and-swap updates
- `app/api/rooms/` — same-origin Sites API routes for create, join, synchronize, and leave
- `src/network/RoomClient.ts` — HTTP synchronization, command batching, session resume, backoff, and latency tracking
- `server/RoomServer.ts` — retained legacy Node/WebSocket room server and compatibility tests
- `src/network/protocol.ts` — shared network message contracts
- `src/game/movement/movement.ts` — walking, charge, burst, and movement feel rules
- `src/game/simulation/` — fixed-step match, tether, environment, event, cumulative scoring, overtime, and base-collapse systems
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

The test suite includes deterministic rules coverage for setup, cumulative scoring, Signal Surge, overtime, multiplayer base collapse, fair two-/three-/four-player placement, and result resolution. It also covers the Sites HTTP client, D1-backed room journeys, request/action idempotency, ready/start, synchronization, disconnect handling, session resume, and the retained local WebSocket server.

## Sites configuration

- `.openai/hosting.json` selects the existing Sites project and declares the `DB` D1 binding.
- `VITE_ROOM_API_URL` optionally overrides the default same-origin `/api/rooms` path.
- The generated files under `drizzle/` are deployed with the Worker so Sites can apply the room schema.
- The older `TETHERBOUND_WS_*` variables are only used by the retained standalone Node server.

See [`docs/PUBLIC_MULTIPLAYER.md`](docs/PUBLIC_MULTIPLAYER.md) for the Sites deployment and verification checklist.
