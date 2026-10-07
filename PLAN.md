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

## Milestone 2: Territory competition

- Network connectivity calculation
- Connection disruption interaction
- Grace period for disconnected anchors
- Repair and reconnection behavior
- Active territory scoring
- Home-base vulnerability
- Match timer and win states

**Exit condition:** Two players sharing one device or test harness can complete a full match with a clear winner.

## Milestone 3: Authoritative multiplayer

- Create room and join by short code
- Authoritative server simulation
- WebSocket input and state synchronization
- Two-browser testing
- Reconnection and player refresh handling
- Host departure and abandoned-room cleanup

**Exit condition:** Two separate phones or browser sessions can complete the same synchronized match.

**Current progress:** The two-player room vertical slice is implemented: server-issued room codes, join links, ready state, authoritative 20 Hz snapshots, fair shared-resource resolution, acknowledged idempotent actions, RTT measurement, backpressure protection, paused reconnect grace, refresh recovery, result screens, and rematches. Public deployment and real-device network testing remain before this milestone is complete.

## Milestone 4: Mobile usability

- Portrait phone layout
- One-thumb controls and contextual action button
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

1. Scaffold the TypeScript, React, PixiJS, and test environment.
2. Implement the main menu, room setup, and match shell.
3. Define the deterministic game-state model and tunable constants.
4. Implement movement and safe-zone geometry.
5. Add oxygen and respawn behavior.
6. Add salvage collection, delivery, and tether deployment.
7. Playtest the local loop before implementing combat or networking.
