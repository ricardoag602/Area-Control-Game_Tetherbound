# Game module layout

The game is organized by responsibility so authoritative rules stay usable by
the bot, multiplayer server, replay tools, and a future GPU renderer.

- `ai/` — bot decisions built on the same public commands as a player
- `components/` — React/SVG match presentation
- `hooks/` — browser-side match and rendering lifecycle hooks
- `input/` — keyboard, pointer, and shortcut translation into game commands
- `movement/` — authoritative walking, tank turning, charging, and bursts
- `presentation/` — renderer-independent camera, radar, and oxygen view math
- `simulation/` — fixed-step match orchestration and gameplay systems
- `world/` — map geometry, biomes, territory sampling, and event scheduling

The small files at this folder's root are shared foundations: data types,
geometry helpers, game constants, and initial-state construction.

## Dependency direction

Headless rule modules (`movement`, `simulation`, and `world`) must not import
React, browser APIs, or networking. Hooks and components may consume those
rules. The server imports only explicitly listed headless modules through
`tsconfig.server.json`. Regulation phases, cumulative exclusive-territory
scores, overtime, current-territory tiebreaks, and base-collapse progress all
belong to this shared authoritative state so bot play, multiplayer, replays,
and result screens resolve the same outcome.

Tether conflict is proximity-driven inside the authoritative fixed-step
simulation. Components may derive rings, hatching, and cable treatments from
the compact anchor state, but presentation-only geometry must not be serialized
into `GameState`. Scoring samples the world grid, excludes cells inside either
guaranteed home safe-zone radius from its numerator and denominator, and awards
each player that owned fraction per second. The opening setup phase contributes
no points, the final regulation minute applies the Signal Surge multiplier, and
overtime disables further supply-drop events.

Use direct module imports inside the game rather than a catch-all barrel. This
keeps client-only code out of the server build and makes dependency cycles
visible. Keep each test beside the module it protects.
