# Public multiplayer deployment

The website and multiplayer room server are two separate processes. The static
website can live at `https://playonlinegames.us/tetherbound/`, but the room
server must run continuously on a host that supports WebSocket upgrades over
public TLS port 443.

The previous public build tried to connect to
`wss://playonlinegames.us:8788`. That port is not proxied by Cloudflare, so a
browser could never reach the room server.

## Recommended topology

Deploy one instance of the Node room server to a WebSocket-capable host and let
that host terminate TLS:

```text
https://playonlinegames.us/tetherbound/
                 |
                 +-- wss://<room-server-host>/ws
```

Keep the service at one instance. Rooms currently live in process memory, so
horizontal scaling or a restart would separate or discard active rooms.

## Run the production server

The server accepts the standard `PORT` variable used by managed hosts:

```sh
PORT=8788 \
TETHERBOUND_ALLOWED_ORIGINS=https://playonlinegames.us \
npm run start:server
```

Its endpoints are:

- `GET /healthz` for health checks
- `WS /ws` for multiplayer connections

The same server can be built as a container:

```sh
docker build -f Dockerfile.multiplayer -t tetherbound-multiplayer .
docker run --rm -p 8788:8788 \
  -e TETHERBOUND_ALLOWED_ORIGINS=https://playonlinegames.us \
  tetherbound-multiplayer
```

Configure the managed host with the repository's current release branch, the
start command `npm run start:server`, health path `/healthz`, and exactly one
always-on instance. Sleeping free tiers will introduce a visible cold start and
are not recommended for a real-time match server.

## Point the website at the room server

`VITE_WS_URL` is a build-time value. Set it while building the website, then
upload the resulting `dist/` directory:

```sh
VITE_WS_URL=wss://<room-server-host>/ws npm run build
```

The generated JavaScript must contain the public `wss://` address and must not
contain `playonlinegames.us:8788`.

If the existing web origin can run Node and configure a reverse proxy, the
client's production fallback is now the same-origin URL
`wss://playonlinegames.us/tetherbound/ws`. That route must be forwarded to the
room server before the static single-page-app fallback. A separate managed room
server is simpler when the current host serves static files only.

## Release verification

1. Confirm `https://<room-server-host>/healthz` returns `{"status":"ok"}`.
2. Create a room from the public website.
3. Join from a phone using cellular data rather than the same Wi-Fi network.
4. Ready both players and verify that movement and tether deployment appear on
   both devices.
5. Refresh one client and verify it resumes its slot within 30 seconds.
6. Complete a full match and request a rematch.

The client now stops after bounded connection attempts, explains the outage,
and offers a manual retry instead of remaining on “Establishing connection…”
forever.
