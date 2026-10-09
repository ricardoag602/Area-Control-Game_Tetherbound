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
- Grace period for disconnected anchors
- Repair and reconnection behavior
- Active territory scoring
- Home-base vulnerability
- Match timer and win states

**Exit condition:** Two players sharing one device or test harness can complete a full match with a clear winner.

**Current progress:** Powered coverage is sampled into a deterministic territory grid and displayed through the pixel minimap. Connection disruption, repair, base vulnerability, and a territory-hold victory remain.

## Milestone 3: Authoritative multiplayer

- Create room and join by short code
- Authoritative server simulation
- WebSocket input and state synchronization
- Two-browser testing
- Reconnection and player refresh handling
- Host departure and abandoned-room cleanup

**Exit condition:** Two separate phones or browser sessions can complete the same synchronized match.

**Current progress:** The two-player room vertical slice is implemented: server-issued room codes, join links, ready state, authoritative 20 Hz snapshots, ordered movement input, fair shared-resource resolution, acknowledged idempotent actions, RTT measurement, render-only position smoothing, backpressure protection, paused reconnect grace, refresh recovery, result screens, and rematches. Public deployment and real-device network testing remain before this milestone is complete.

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
- One weather system with a clear temporary effect
- Tunable map and match constants

**Exit condition:** Events create interesting detours without deciding the match through randomness.

## Milestone 6: Presentation and release

- Final visual theme and mission-patch customization
- Audio layers and weather cues
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

## Immediate implementation order

1. Add enemy anchor disruption with downstream network disconnection.
2. Add repair and reconnection grace behavior.
3. Add a territory-hold victory condition and home-base vulnerability.
4. Playtest biome movement, oxygen pressure, event cadence, and resource density.
5. Enable timeline-driven buffs and debuffs only after the core competition is balanced.
