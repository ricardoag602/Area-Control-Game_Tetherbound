# Sites multiplayer deployment

Tetherbound now runs as one full-stack Site. Vinext serves the game from
`/game/`, the room endpoints live under `/api/rooms`, and Sites provisions the
`DB` D1 binding declared in `.openai/hosting.json`. No separately hosted Node
process or public WebSocket port is required.

Rooms are persisted as versioned documents. Clients send ordered input batches
and poll versioned snapshots; optimistic compare-and-swap updates keep two
simultaneous players from advancing the authoritative state independently.

## Build and publish

```sh
npm ci
npm test
npm run build
```

The production artifact must contain:

- `dist/server/index.js`
- `dist/client/game/index.html`
- `dist/.openai/hosting.json`
- `dist/.openai/drizzle/0000_flowery_shinobi_shaw.sql`

Publish the built artifact through Sites. The bundled migration creates the
room tables before the Worker begins handling multiplayer requests.

## Release verification

1. Open the published Site and confirm it redirects to `/game/index.html`.
2. Create a room and copy its invitation link.
3. Join from a second browser session or phone.
4. Ready both players and verify that movement and tether deployment appear on
   both devices.
5. Refresh one client and verify it resumes its slot within 30 seconds.
6. Complete a full match and request a rematch.

The Site is currently owner-private. Before a competition test with other
people, explicitly change its Sites audience or add the intended viewers; do
not change access merely as part of a code deployment.
