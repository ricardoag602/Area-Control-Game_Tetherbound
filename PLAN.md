# Tetherbound Development Plan

## Milestone 1: Local mechanics sandbox

Build one local arena with two simulated players and no networking.

- Top-down movement and mobile drag controls
- Opposing home bases
- Safe-zone detection
- Oxygen drain, recovery, emergency countdown, and respawn
- Salvage deposits, collection, carrying capacity, and delivery
- Tether fabrication and anchor placement
- Visible anchor connections and safe-zone coverage
- Main menu, room setup, and match views
- Seamless view transitions
- Persistent large-controls accessibility option

**Exit condition:** One player can repeatedly leave safety, collect salvage, return, fabricate an anchor, and extend a connected network.

**Current progress:** Implemented for bot and multiplayer matches, including oxygen presentation, a 4.59× biome arena, terrain effects, deterministic supply drops, and an extensible seeded world-event timeline.

## Milestone 2: Territory competition

- Network connectivity calculation
- Connection disruption interaction
- Timed anchor disruption, active repair, and brief reactivation protection
- Cumulative scoring from each player's share of exclusive powered territory outside the guaranteed home safe zones
- A protected 30-second setup period and 1.5× final-minute Signal Surge
- Close-score overtime with no supply drops, a five-point overtime-advantage target, and a 60-second cap
- Home-base collapse after severing the deployed network and holding the base for 12 seconds
- Match timer, current-territory overtime tiebreak, result screen, and rematch flow

**Exit condition:** Two players sharing one device or test harness can complete a full match with a clear winner.

**Current progress:** Implemented for bot and multiplayer matches. Powered coverage is sampled into a deterministic territory grid and displayed through the pixel minimap. After setup, each player's exclusive share of the scorable grid accumulates up to one point per second; the last minute uses the Signal Surge multiplier, close regulation scores enter capped overtime, and a fully severed deployed network exposes its home base to a 12-second collapse hold. Disruption, repair, recovery protection, results, and rematches are integrated into the same authoritative match flow.

## Milestone 3: Authoritative multiplayer

- Create room and join by short code
- Authoritative server simulation
- WebSocket input and state synchronization
- Two-browser testing
- Reconnection and player refresh handling
- Host departure and abandoned-room cleanup

**Exit condition:** Two separate phones or browser sessions can complete the same synchronized match.

**Current progress:** The two-player room vertical slice is implemented: server-issued room codes, join links, ready state, authoritative 20 Hz snapshots, ordered movement input, fair shared-resource resolution, acknowledged idempotent actions, RTT measurement, render-only position smoothing, backpressure protection, paused reconnect grace, refresh recovery, cumulative-score and base-collapse results, and two-player rematch votes. Public deployment and real-device network testing remain before this milestone is complete.

## Milestone 4: Mobile usability

- Portrait phone layout
- One-thumb controls and contextual action button
- Smooth walking plus a hold, aim, and release momentum burst
- Desktop tank controls: W/S drive, A/D turn, and tap-then-hold thrust boosts
- Match-wide desktop shortcuts, including T to deploy a tether
- Continuous unwrapped astronaut heading for seamless full rotations
- A charge radar showing projected reach and the remaining turn envelope
- A local-player follow camera with charge zoom and spring release
- Action previews and costs
- Legible oxygen, salvage, tether, score, and connection status
- Haptics, sound controls, reduced motion, and color-safe palettes
- Short interactive tutorial

**Exit condition:** A new player can join and complete a match without verbal explanation.

## Milestone 5: Controlled variation

Add only after the core game is balanced.

- Four buffs: Emergency Oxygen, Thruster Burst, Repair Drone, Anchor Overcharge
- One announced event: Meteor Impact
- Additional announced world events only after supply-drop playtesting
- Tunable map and match constants

**Exit condition:** Events create interesting detours without deciding the match through randomness.

## Milestone 6: Presentation and release

- Final visual theme and mission-patch customization
- Audio layers and supply-drop cues
- Performance and battery testing on phones
- Automated rules and multiplayer tests
- Public deployment, analytics, and submission materials

## Technical direction

- TypeScript throughout
- React for menus, HUD, accessibility, and room flow
- PixiJS for the continuously rendered arena
- Shared pure game-state module for rules and simulation
- Authoritative WebSocket server for multiplayer
- Vitest for deterministic game rules
- Playwright for multi-browser match testing

## Immediate validation order

1. Playtest whether the 30-second setup creates useful opening choices without delaying the first conflict.
2. Tune normal scoring, the 1.5× Signal Surge, the 3% overtime threshold, and the five-point overtime-advantage target so an early lead matters without becoming irreversible.
3. Test whether severing every deployed anchor and holding a base for 12 seconds creates a readable, recoverable last stand.
4. Validate overtime supply scarcity, the 60-second cap, and the current-territory tiebreak across defensive and aggressive strategies; track how often neither player reaches a five-point overtime advantage so the tiebreak does not become an accidental default.
5. Continue tuning biome movement, oxygen pressure, event cadence, and resource density before enabling timeline-driven buffs or debuffs.
