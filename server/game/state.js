const { randomCode } = require('../util/helpers');

const games = new Map();
const socketToPlayer = new Map();

function createGameState(hostSocketId, hostName) {
  let code = randomCode();
  while (games.has(code)) {
    code = randomCode();
  }

  const hostPlayerId = hostSocketId;
  const players = new Map();
  players.set(hostPlayerId, {
    id: hostPlayerId,
    socketId: hostSocketId,
    name: hostName,
    ready: false,
    connected: true,
    room: 'A',
    x: 120,
    y: 120,
    role: null,
    busy: false,
    cooldowns: { color: 0, card: 0 },
    input: { up: false, down: false, left: false, right: false }
  });

  const game = {
    code,
    hostId: hostPlayerId,
    createdAt: Date.now(),
    phase: 'lobby',
    players,
    settings: {
      rounds: 3,
      roundSeconds: 60,
      hostagesPerRoom: 1,
      winRule: 'together'
    },
    round: 0,
    phaseEndsAt: null,
    swapDeadlineAt: null,
    leaderOrder: { A: [], B: [] },
    leaders: { A: null, B: null },
    pendingHostages: { A: null, B: null },
    pendingRequest: null
  };

  games.set(code, game);
  socketToPlayer.set(hostSocketId, { gameCode: code, playerId: hostPlayerId });

  return game;
}

function addPlayerToGame(game, socketId, name) {
  const playerId = socketId;
  game.players.set(playerId, {
    id: playerId,
    socketId,
    name,
    ready: false,
    connected: true,
    room: 'A',
    x: 120,
    y: 120,
    role: null,
    busy: false,
    cooldowns: { color: 0, card: 0 },
    input: { up: false, down: false, left: false, right: false }
  });
  socketToPlayer.set(socketId, { gameCode: game.code, playerId });
  return game.players.get(playerId);
}

function getMembershipBySocket(socketId) {
  return socketToPlayer.get(socketId) || null;
}

function removeSocketMapping(socketId) {
  socketToPlayer.delete(socketId);
}

function removeGameIfEmpty(game) {
  const active = Array.from(game.players.values()).some((player) => player.connected);
  if (!active) {
    games.delete(game.code);
  }
}

module.exports = {
  games,
  socketToPlayer,
  createGameState,
  addPlayerToGame,
  getMembershipBySocket,
  removeSocketMapping,
  removeGameIfEmpty
};
