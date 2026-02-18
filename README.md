# TwoRoom MVP (Crown & Claw Variant)

Browser-based, deployable 2D social deduction MVP for classroom play (~18 players), inspired by Two Rooms and a Boom.

## Stack
- **Server:** Node.js 20+, Express, Socket.IO
- **Client:** Vite + Phaser 3 + Socket.IO client
- **State:** In-memory only (no database)
- **Deploy:** Single Railway service (HTTPS + WSS same origin)

## Monorepo Layout

```txt
/client
  /src
    main.js
    /game/scenes/GameScene.js
    /net/socket.js
    /ui/dom.js
  index.html
  vite.config.js
/server
  index.js
  /game
    state.js
    rooms.js
    roles.js
    logic.js
  /util/helpers.js
package.json
README.md
```

## Scripts
From repo root:

- `npm run dev` — run server + client locally (concurrently)
- `npm run build` — build Vite client into `client/dist`
- `npm start` — start production server (serves `client/dist`)

## Local Run

1. Install deps:
   ```bash
   npm install
   npm --prefix client install
   npm --prefix server install
   ```
2. Dev mode:
   ```bash
   npm run dev
   ```
3. Open Vite URL (usually `http://localhost:5173`).

## Railway Deployment

1. Create one Railway service from this repo.
2. Build command:
   ```bash
   npm install && npm --prefix client install && npm --prefix server install && npm run build
   ```
3. Start command:
   ```bash
   npm start
   ```
4. Railway provides HTTPS; Socket.IO uses same origin with polling + websocket fallback.
5. Health check endpoint:
   - `GET /health` → `200 OK`

## MVP Rules Implemented

- Exactly two rooms: A and B.
- Players only receive/browse room state for their current room.
- Secret server-side roles: Red/Blue teams and special Crown + Claw (1 each).
- Configurable game settings (host-controlled): rounds, round length, hostages per room, win rule.
- Round flow:
  1. Playing phase timer runs.
  2. Swap phase starts.
  3. Room leader submits K hostages (or server auto-selects after 15s timeout).
  4. Hostages swap A↔B.
  5. Next round or game end.
- Leader rotates each round per room.
- Crown/Claw disconnect during active game aborts game safely to lobby.

## Interaction Rules

- Movement via WASD / arrow keys.
- Closest player within 80px can be targeted (`E` interact).
- Request types:
  - **Color Share:** reveals target team only.
  - **Card Share:** reveals target team + role.
- Consent required (Accept/Decline modal on target).
- One pending request globally per game between two players; both marked busy while pending.
- Cooldowns (server enforced):
  - color: 10s
  - card: 20s
- Distance re-validated on accept (prevents walk-away exploit).

## Socket Event Contract

### Client → Server
- `createGame: { name }`
- `joinGame: { code, name }`
- `setReady: { ready }`
- `startGame: { settings: { rounds, roundSeconds, hostagesPerRoom, winRule } }`
- `input: { up, down, left, right }` (10Hz)
- `shareRequest: { toPlayerId, type: "color"|"card" }`
- `shareResponse: { requestId, accepted }`
- `leaderSubmitHostages: { hostageIds: string[] }`

### Server → Client
- `lobbyState`
- `gameStarted`
- `roomState`
- `shareIncoming`
- `shareResult`
- `errorMessage`
- `gameEnded`

See `server/game/logic.js` and `server/index.js` for validation and payload details.

## Known MVP Limits

- No persistence (game lost on restart).
- No reconnect resume identity (socket ID = player ID).
- No chat by design.
- Rendering is intentionally minimal (circles + name labels).
