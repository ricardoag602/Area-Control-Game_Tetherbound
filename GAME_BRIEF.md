# Tetherbound

## Tagline

**How far from safety will you go for power?**

## High concept

Tetherbound is a two-player, top-down mobile territory game. Rival astronauts explore an alien surface by extending life-support networks from opposing home bases. Players leave safety to recover salvage, fabricate new tether anchors, expand their powered territory, and sever vulnerable links in the opponent's network.

## Design pillars

1. **Risk versus safety** — Valuable resources require leaving powered territory and spending limited oxygen.
2. **Readable network strategy** — Every anchor and connection is visible. Long networks expand quickly but are vulnerable to being cut.
3. **One-thumb play** — Movement and contextual interactions must work comfortably on a phone.
4. **Competitive recovery** — Losing territory creates setbacks and opportunities, not early permanent elimination.

## First playable rules

- Two players begin at home bases on opposite edges of one map.
- Each player starts with two tether anchors.
- Powered anchors create circular safe zones and must connect to the home base or another powered anchor.
- Astronauts move normally in safe zones and consume emergency oxygen outside them.
- Astronauts collect alloy salvage from deposits and can carry up to three pieces.
- Delivering three salvage pieces to a powered anchor fabricates one new tether anchor.
- Players can deploy every tether anchor they fabricate; collection and spacing are the limits.
- Enemy tether connections can be disrupted through a short nearby interaction.
- An overloaded anchor and every downstream zone lose power immediately. The direct disruption clears after 20 seconds unless its owner repairs it sooner, and a recovered anchor receives brief overload protection.
- Regulation lasts five minutes. The first 30 seconds are a protected, non-scoring setup period for exploration, collection, and initial network deployment; base-collapse progress cannot begin during setup.
- After setup, each player earns the fraction of the scorable grid they exclusively control every second, up to one point per second for full control. Cells inside either guaranteed home safe zone are excluded from the calculation; neutral and contested cells do not score.
- The final minute is an announced Signal Surge in which territory earns 1.5× score.
- If the regulation scores finish within 3%, the match enters overtime. Supply drops stop, and the first player to earn five points more than the opponent during overtime wins; the retained regulation score does not trigger an immediate overtime finish.
- Overtime is capped at 60 seconds. If the lead target is not reached, current exclusive non-base territory breaks the tie; equal territory produces a draw.
- A base cannot be collapsed until its owner has deployed at least one anchor. If every deployed anchor is severed from power, an uncontested attacker inside the base zone builds a 12-second collapse meter. The meter decays when unattended, reverses faster when the defender contests the zone, and resets if any anchor regains power.
- Losing territory or interrupting a base push creates a recoverable setback rather than permanent early elimination.

## Initial content boundary

The first playable contains no weather, character classes, inventory screen, custom images, progression, matchmaking, or advanced graphics. These features come only after the core movement, oxygen, salvage, tether, territory, and disruption systems are fun.

## Initial presentation

- Portrait-first mobile layout
- Simple geometric astronauts, anchors, cables, and terrain
- Strong contrasting player colors
- Clear safe-zone circles and oxygen warnings
- Minimal sound cues for collection, deployment, disconnection, and danger

## Application views

### Main menu

- Tetherbound title and tagline
- Start Bot Game
- Create Multiplayer Room
- Persistent large-controls accessibility toggle
- Creator credits placeholder

### Room setup

- Select the intended player limit
- Generate a short room code and shareable room link
- Copy the link
- Enter the waiting room or return to the menu
- Two-player gameplay is implemented first; larger limits remain a forward-compatible room setting

### Match

- Full-screen arena
- Minimal match HUD showing cumulative score, current territory, match phase, and base-collapse progress when relevant
- Bot and multiplayer modes use the same game-state model
- Leave-match confirmation returns to the main menu

### Results

- Bot and multiplayer matches show the winner, finish reason, final cumulative score, and final territory.
- A bot game can restart immediately from its result screen.
- A multiplayer rematch starts after both connected players vote to play again.

View changes should feel continuous through short fades and directional motion. Accessibility preferences must remain active across every view.
