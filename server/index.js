const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const {
  games,
  createGameState,
  addPlayerToGame,
  getMembershipBySocket,
  removeSocketMapping,
  removeGameIfEmpty
} = require('./game/state');
const {
  TICK_MS,
  validateSettings,
  emitLobbyState,
  emitRoomStates,
  startGame,
  canStartGame,
  handleShareRequest,
  handleShareResponse,
  submitHostages,
  applyMovement,
  handlePhases,
  abortGameToLobby,
  rebalanceLeaders
} = require('./game/logic');
const { sanitizeName } = require('./util/helpers');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  transports: ['polling', 'websocket'],
  pingInterval: 15000,
  pingTimeout: 30000
});

const clientDist = path.resolve(__dirname, '../client/dist');

app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

io.on('connection', (socket) => {
  socket.on('createGame', (payload = {}) => {
    const name = sanitizeName(payload.name);
    if (!name) {
      socket.emit('errorMessage', { message: 'Enter a valid name.' });
      return;
    }
    const game = createGameState(socket.id, name);
    socket.join(game.code);
    emitLobbyState(io, game);
  });

  socket.on('joinGame', (payload = {}) => {
    const name = sanitizeName(payload.name);
    const code = typeof payload.code === 'string' ? payload.code.trim().toUpperCase() : '';
    if (!name || !code) {
      socket.emit('errorMessage', { message: 'Invalid join payload.' });
      return;
    }

    const game = games.get(code);
    if (!game) {
      socket.emit('errorMessage', { message: 'Game not found.' });
      return;
    }
    if (game.phase !== 'lobby') {
      socket.emit('errorMessage', { message: 'Game already started.' });
      return;
    }

    addPlayerToGame(game, socket.id, name);
    socket.join(game.code);
    emitLobbyState(io, game);
  });

  socket.on('setReady', (payload = {}) => {
    const m = getMembershipBySocket(socket.id);
    if (!m) return;
    const game = games.get(m.gameCode);
    if (!game || game.phase !== 'lobby') return;
    const player = game.players.get(m.playerId);
    if (!player) return;
    player.ready = Boolean(payload.ready);
    emitLobbyState(io, game);
  });

  socket.on('startGame', (payload = {}) => {
    const m = getMembershipBySocket(socket.id);
    if (!m) return;
    const game = games.get(m.gameCode);
    if (!game || game.phase !== 'lobby') return;

    const canStart = canStartGame(game, m.playerId);
    if (!canStart.ok) {
      socket.emit('errorMessage', { message: canStart.message });
      return;
    }

    game.settings = validateSettings(payload.settings || {});
    startGame(io, game);
  });

  socket.on('input', (payload = {}) => {
    const m = getMembershipBySocket(socket.id);
    if (!m) return;
    const game = games.get(m.gameCode);
    if (!game || game.phase !== 'playing') return;
    const player = game.players.get(m.playerId);
    if (!player || !player.connected) return;
    player.input = {
      up: Boolean(payload.up),
      down: Boolean(payload.down),
      left: Boolean(payload.left),
      right: Boolean(payload.right)
    };
  });

  socket.on('shareRequest', (payload = {}) => {
    const m = getMembershipBySocket(socket.id);
    if (!m) return;
    const game = games.get(m.gameCode);
    if (!game) return;

    const result = handleShareRequest(io, game, m.playerId, payload);
    if (!result.ok) {
      socket.emit('errorMessage', { message: result.message });
    }
  });

  socket.on('shareResponse', (payload = {}) => {
    const m = getMembershipBySocket(socket.id);
    if (!m) return;
    const game = games.get(m.gameCode);
    if (!game) return;

    const result = handleShareResponse(io, game, m.playerId, {
      requestId: payload.requestId,
      accepted: Boolean(payload.accepted)
    });
    if (!result.ok) {
      socket.emit('errorMessage', { message: result.message });
    }
  });

  socket.on('leaderSubmitHostages', (payload = {}) => {
    const m = getMembershipBySocket(socket.id);
    if (!m) return;
    const game = games.get(m.gameCode);
    if (!game) return;

    const result = submitHostages(game, m.playerId, payload.hostageIds);
    if (!result.ok) {
      socket.emit('errorMessage', { message: result.message });
    }
  });

  socket.on('chatMessage', (payload = {}) => {
    const m = getMembershipBySocket(socket.id);
    if (!m) return;
    const game = games.get(m.gameCode);
    if (!game || game.phase === 'lobby') return;

    const fromPlayer = game.players.get(m.playerId);
    if (!fromPlayer || !fromPlayer.connected) return;

    const text = typeof payload.text === 'string' ? payload.text.trim().slice(0, 220) : '';
    const scope = payload.scope === 'room' ? 'room' : 'game';
    if (!text) return;

    const messagePayload = {
      fromPlayerId: fromPlayer.id,
      fromName: fromPlayer.name,
      room: fromPlayer.room,
      scope,
      text,
      at: Date.now()
    };

    if (scope === 'game') {
      io.to(game.code).emit('chatMessage', messagePayload);
      return;
    }

    Array.from(game.players.values()).forEach((player) => {
      if (!player.connected || player.room !== fromPlayer.room) return;
      io.to(player.socketId).emit('chatMessage', messagePayload);
    });
  });

  socket.on('disconnect', () => {
    const m = getMembershipBySocket(socket.id);
    if (!m) return;

    const game = games.get(m.gameCode);
    removeSocketMapping(socket.id);
    if (!game) return;

    const player = game.players.get(m.playerId);
    if (!player) return;
    player.connected = false;
    player.input = { up: false, down: false, left: false, right: false };

    if (game.pendingRequest && (game.pendingRequest.fromPlayerId === player.id || game.pendingRequest.toPlayerId === player.id)) {
      game.pendingRequest = null;
      Array.from(game.players.values()).forEach((p) => {
        p.busy = false;
      });
    }

    if (game.phase !== 'lobby' && (player.role?.roleName === 'Crown' || player.role?.roleName === 'Claw')) {
      abortGameToLobby(io, game, 'Crown or Claw disconnected. Game aborted to lobby.');
    }

    if (game.hostId === player.id) {
      const nextHost = Array.from(game.players.values()).find((p) => p.connected);
      game.hostId = nextHost?.id || null;
    }

    rebalanceLeaders(game);
    emitLobbyState(io, game);
    removeGameIfEmpty(game);
  });
});

setInterval(() => {
  games.forEach((game) => {
    if (game.phase === 'lobby') return;
    applyMovement(game);
    handlePhases(io, game);
    emitRoomStates(io, game);
  });
}, TICK_MS);

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Server listening on ${port}`);
});
