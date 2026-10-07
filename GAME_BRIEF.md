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
- Each player can maintain up to eight deployed anchors.
- Enemy tether connections can be disrupted through a short nearby interaction.
- Disconnected anchors receive a brief reconnection grace period before shutting down.
- Active territory generates score over a five-minute match.
- A player can also win by disabling the opposing home base.

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
- Minimal match HUD
- Bot and multiplayer modes use the same game-state model
- Leave-match confirmation returns to the main menu

View changes should feel continuous through short fades and directional motion. Accessibility preferences must remain active across every view.
