const { assignRoles } = require('./roles');
const { ROOM_A, ROOM_B, splitRooms, mapBoundsForRoom } = require('./rooms');
const { clamp, distance } = require('../util/helpers');

const TICK_MS = 100;
const SPEED_PER_TICK = 14;
const INTERACTION_RADIUS = 80;
const SWAP_TIMEOUT_MS = 15000;
const LEADER_VOTE_TIMEOUT_MS = 12000;
const LEADER_SUMMIT_TIMEOUT_MS = 10000;
const COOLDOWN_MS = { color: 10000, card: 20000 };

function validateSettings(raw) {
  const settings = {
    rounds: Number(raw?.rounds) || 3,
    roundSeconds: Number(raw?.roundSeconds) || 60,
    hostagesPerRoom: Number(raw?.hostagesPerRoom) || 1,
    winRule: raw?.winRule === 'separated' ? 'separated' : 'together'
  };
  settings.rounds = clamp(Math.trunc(settings.rounds), 2, 6);
  settings.roundSeconds = clamp(Math.trunc(settings.roundSeconds), 30, 180);
  settings.hostagesPerRoom = clamp(Math.trunc(settings.hostagesPerRoom), 1, 3);
  return settings;
}

function lobbyStatePayload(game) {
  return {
    code: game.code,
    hostId: game.hostId,
    players: Array.from(game.players.values())
      .filter((p) => p.connected)
      .map((p) => ({ id: p.id, name: p.name, ready: p.ready }))
  };
}

function emitLobbyState(io, game) {
  io.to(game.code).emit('lobbyState', lobbyStatePayload(game));
}

function resetBusy(game, playerIds = []) {
  playerIds.forEach((id) => {
    const p = game.players.get(id);
    if (p) p.busy = false;
  });
  if (game.pendingRequest && (!playerIds.length || playerIds.includes(game.pendingRequest.fromPlayerId) || playerIds.includes(game.pendingRequest.toPlayerId))) {
    game.pendingRequest = null;
  }
}

function connectedInRoom(game, room) {
  return Array.from(game.players.values()).filter((p) => p.connected && p.room === room);
}

function hasMajority(votesForCandidate, connectedCount) {
  return votesForCandidate > connectedCount / 2;
}

function pickFallbackLeader(game, room) {
  const roomPlayers = connectedInRoom(game, room);
  if (!roomPlayers.length) return null;

  const counts = new Map();
  Object.values(game.leaderVotes[room] || {}).forEach((candidateId) => {
    if (roomPlayers.some((p) => p.id === candidateId)) {
      counts.set(candidateId, (counts.get(candidateId) || 0) + 1);
    }
  });

  if (!counts.size) {
    return roomPlayers.map((p) => p.id).sort()[0];
  }

  return Array.from(counts.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })[0][0];
}

function hasResolvedTargetLeaders(game) {
  return [ROOM_A, ROOM_B].every((room) => !game.leaderVoteTargets[room] || Boolean(game.leaders[room]));
}

function startPlayingPhase(game, deadlineAt = null) {
  game.phase = 'playing';
  game.phaseEndsAt = deadlineAt || (Date.now() + game.settings.roundSeconds * 1000);
  game.swapDeadlineAt = null;
  game.playingResumeUntil = null;
  game.leaderVoteTargets = { A: false, B: false };
  game.leaderVotes = { A: {}, B: {} };
  game.confidenceVotes = { A: {}, B: {} };
}

function startLeaderVotePhase(game, targets, resumeFromPlaying = false) {
  if (resumeFromPlaying && game.phase === 'playing') {
    game.playingResumeUntil = game.phaseEndsAt;
  }
  game.phase = 'leader_vote';
  game.phaseEndsAt = Date.now() + LEADER_VOTE_TIMEOUT_MS;
  game.swapDeadlineAt = null;
  game.leaderVoteTargets = { A: Boolean(targets.A), B: Boolean(targets.B) };
  game.leaderVotes = { A: {}, B: {} };
  game.confidenceVotes = { A: {}, B: {} };
  if (game.leaderVoteTargets.A) {
    game.leaders.A = null;
    game.leaderRound.A = 0;
  }
  if (game.leaderVoteTargets.B) {
    game.leaders.B = null;
    game.leaderRound.B = 0;
  }
}

function ensureLeadersOrStartVote(game) {
  const targets = {
    A: !game.leaders[ROOM_A] || !connectedInRoom(game, ROOM_A).some((p) => p.id === game.leaders[ROOM_A]),
    B: !game.leaders[ROOM_B] || !connectedInRoom(game, ROOM_B).some((p) => p.id === game.leaders[ROOM_B])
  };
  if (targets.A || targets.B) {
    startLeaderVotePhase(game, targets, game.phase === 'playing');
    return false;
  }
  return true;
}

function getPlayerRoomState(game, player) {
  const sameRoom = Array.from(game.players.values()).filter((p) => p.connected && p.room === player.room);
  return {
    now: Date.now(),
    round: game.round,
    phase: game.phase,
    timeLeftMs: Math.max(0, (game.phaseEndsAt || game.swapDeadlineAt || 0) - Date.now()),
    room: player.room,
    leaderId: game.leaders[player.room],
    players: sameRoom.map((p) => ({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      isBusy: p.busy
    }))
  };
}

function emitRoomStates(io, game) {
  Array.from(game.players.values()).forEach((player) => {
    if (!player.connected || game.phase === 'lobby') return;
    io.to(player.socketId).emit('roomState', getPlayerRoomState(game, player));
  });
}

function startGame(io, game) {
  game.phase = 'playing';
  game.round = 1;
  const ids = Array.from(game.players.values()).filter((p) => p.connected).map((p) => p.id);
  const roomMap = splitRooms(ids);
  const assignments = assignRoles(game.players);

  ids.forEach((id, idx) => {
    const player = game.players.get(id);
    player.room = roomMap.get(id);
    player.role = assignments.get(id);
    player.busy = false;
    player.input = { up: false, down: false, left: false, right: false };
    const bounds = mapBoundsForRoom(player.room);
    player.x = bounds.minX + 50 + ((idx % 4) * 60);
    player.y = 140 + (Math.floor(idx / 4) * 70);
  });

  game.phaseEndsAt = Date.now() + game.settings.roundSeconds * 1000;
  game.swapDeadlineAt = null;
  game.pendingHostages = { A: null, B: null };
  game.pendingRequest = null;
  game.leaders = { A: null, B: null };
  game.leaderRound = { A: 0, B: 0 };
  game.playingResumeUntil = null;
  startLeaderVotePhase(game, { A: true, B: true });

  ids.forEach((id) => {
    const player = game.players.get(id);
    io.to(player.socketId).emit('gameStarted', {
      yourId: player.id,
      yourRoom: player.room,
      role: player.role,
      settings: game.settings
    });
  });
}

function enterLeaderSummitPhase(game) {
  game.phase = 'leader_summit';
  game.phaseEndsAt = Date.now() + LEADER_SUMMIT_TIMEOUT_MS;
  game.swapDeadlineAt = null;
  game.pendingHostages = { A: null, B: null };
}

function enterExchangeCommitPhase(game) {
  game.phase = 'exchange_commit';
  game.phaseEndsAt = null;
  game.swapDeadlineAt = Date.now() + SWAP_TIMEOUT_MS;
  game.pendingHostages = { A: null, B: null };
}

function autoSelectHostages(game, room) {
  if (game.pendingHostages[room]) return;
  const pool = Array.from(game.players.values()).filter((p) => p.connected && p.room === room);
  const max = Math.min(game.settings.hostagesPerRoom, pool.length);
  const leaderId = game.leaders[room];
  const nonLeaderPool = pool.filter((p) => p.id !== leaderId);
  const preferredPool = nonLeaderPool.length >= max ? nonLeaderPool : pool;
  const shuffled = preferredPool.sort(() => Math.random() - 0.5);
  const picks = shuffled.slice(0, max).map((p) => p.id);
  game.pendingHostages[room] = picks;
}

function resolveSwap(io, game) {
  const aHostages = game.pendingHostages[ROOM_A] || [];
  const bHostages = game.pendingHostages[ROOM_B] || [];

  aHostages.forEach((id, idx) => {
    const player = game.players.get(id);
    if (player && player.connected) {
      player.room = ROOM_B;
      player.x = 650 + (idx * 50);
      player.y = 120 + (idx * 50);
    }
  });

  bHostages.forEach((id, idx) => {
    const player = game.players.get(id);
    if (player && player.connected) {
      player.room = ROOM_A;
      player.x = 150 + (idx * 50);
      player.y = 120 + (idx * 50);
    }
  });

  resetBusy(game);
  if (game.round >= game.settings.rounds) {
    endGame(io, game);
    return;
  }

  game.round += 1;
  startLeaderVotePhase(game, { A: true, B: true });
  game.swapDeadlineAt = null;
  game.pendingHostages = { A: null, B: null };
}

function endGame(io, game) {
  game.phase = 'ended';
  const crown = Array.from(game.players.values()).find((p) => p.connected && p.role?.roleName === 'Crown');
  const claw = Array.from(game.players.values()).find((p) => p.connected && p.role?.roleName === 'Claw');

  if (!crown || !claw) {
    abortGameToLobby(io, game, 'Critical role disconnected, game aborted.');
    return;
  }

  const together = crown.room === claw.room;
  const redWins = game.settings.winRule === 'together' ? together : !together;
  const winner = redWins ? 'Red' : 'Blue';
  const reason = game.settings.winRule === 'together'
    ? (together ? 'Crown and Claw are together.' : 'Crown and Claw are separated.')
    : (together ? 'Crown and Claw are together.' : 'Crown and Claw are separated.');

  io.to(game.code).emit('gameEnded', {
    winner,
    reason,
    crownRoom: crown.room,
    clawRoom: claw.room
  });

  Array.from(game.players.values()).forEach((p) => {
    p.ready = false;
    p.busy = false;
    p.role = null;
    p.room = ROOM_A;
    p.x = 120;
    p.y = 120;
  });

  game.phase = 'lobby';
  game.round = 0;
  game.phaseEndsAt = null;
  game.swapDeadlineAt = null;
  game.pendingHostages = { A: null, B: null };
  game.pendingRequest = null;
  game.leaderVoteTargets = { A: false, B: false };
  game.leaderVotes = { A: {}, B: {} };
  game.confidenceVotes = { A: {}, B: {} };
  game.playingResumeUntil = null;
  game.leaders = { A: null, B: null };
  game.leaderRound = { A: 0, B: 0 };
  emitLobbyState(io, game);
}

function abortGameToLobby(io, game, message) {
  io.to(game.code).emit('errorMessage', { message });
  Array.from(game.players.values()).forEach((p) => {
    p.ready = false;
    p.busy = false;
    p.role = null;
    p.room = ROOM_A;
    p.x = 120;
    p.y = 120;
  });
  game.phase = 'lobby';
  game.round = 0;
  game.phaseEndsAt = null;
  game.swapDeadlineAt = null;
  game.pendingHostages = { A: null, B: null };
  game.pendingRequest = null;
  game.leaderVoteTargets = { A: false, B: false };
  game.leaderVotes = { A: {}, B: {} };
  game.confidenceVotes = { A: {}, B: {} };
  game.playingResumeUntil = null;
  game.leaders = { A: null, B: null };
  game.leaderRound = { A: 0, B: 0 };
  emitLobbyState(io, game);
}

function applyMovement(game) {
  Array.from(game.players.values()).forEach((player) => {
    if (!player.connected || game.phase !== 'playing') return;

    const { up, down, left, right } = player.input;
    let vx = 0;
    let vy = 0;
    if (left) vx -= SPEED_PER_TICK;
    if (right) vx += SPEED_PER_TICK;
    if (up) vy -= SPEED_PER_TICK;
    if (down) vy += SPEED_PER_TICK;

    const bounds = mapBoundsForRoom(player.room);
    player.x = clamp(player.x + vx, bounds.minX, bounds.maxX);
    player.y = clamp(player.y + vy, bounds.minY, bounds.maxY);
  });
}

function handlePhases(io, game) {
  const now = Date.now();
  if (game.phase === 'leader_vote') {
    if (now >= game.phaseEndsAt) {
      [ROOM_A, ROOM_B].forEach((room) => {
        if (game.leaderVoteTargets[room] && !game.leaders[room]) {
          game.leaders[room] = pickFallbackLeader(game, room);
          if (game.leaders[room]) game.leaderRound[room] = game.round;
        }
      });

      if (hasResolvedTargetLeaders(game)) {
        const resumeAt = game.playingResumeUntil;
        startPlayingPhase(game, resumeAt && resumeAt > now ? resumeAt : null);
      }
    }
    return;
  }

  if (game.phase === 'playing' && now >= game.phaseEndsAt) {
    if (ensureLeadersOrStartVote(game)) {
      enterLeaderSummitPhase(game);
    }
    return;
  }

  if (game.phase === 'leader_summit' && now >= game.phaseEndsAt) {
    enterExchangeCommitPhase(game);
    return;
  }

  if (game.phase === 'exchange_commit') {
    if (!game.pendingHostages[ROOM_A] && now >= game.swapDeadlineAt) {
      autoSelectHostages(game, ROOM_A);
    }
    if (!game.pendingHostages[ROOM_B] && now >= game.swapDeadlineAt) {
      autoSelectHostages(game, ROOM_B);
    }
    if (game.pendingHostages[ROOM_A] && game.pendingHostages[ROOM_B]) {
      resolveSwap(io, game);
    }
  }
}

function canStartGame(game, playerId) {
  if (game.hostId !== playerId) return { ok: false, message: 'Only host can start.' };
  const connected = Array.from(game.players.values()).filter((p) => p.connected);
  if (connected.length < 4) return { ok: false, message: 'Need at least 4 players.' };
  const allReady = connected.every((p) => p.ready || p.id === game.hostId);
  if (!allReady) return { ok: false, message: 'All players must be ready.' };
  return { ok: true };
}

function handleShareRequest(io, game, fromPlayerId, payload) {
  if (game.phase !== 'playing') return { ok: false, message: 'Can only share during playing phase.' };
  const from = game.players.get(fromPlayerId);
  const to = game.players.get(payload.toPlayerId);
  if (!from || !to || !from.connected || !to.connected) return { ok: false, message: 'Player not available.' };
  if (from.room !== to.room) return { ok: false, message: 'Target not in your room.' };
  if (!['color', 'card'].includes(payload.type)) return { ok: false, message: 'Invalid share type.' };
  if (from.busy || to.busy || game.pendingRequest) return { ok: false, message: 'One of the players is busy.' };

  const now = Date.now();
  if (from.cooldowns[payload.type] > now) {
    return { ok: false, message: `${payload.type} share is on cooldown.` };
  }

  if (distance(from, to) > INTERACTION_RADIUS) {
    return { ok: false, message: 'You are too far away.' };
  }

  const requestId = `${from.id}-${to.id}-${now}`;
  game.pendingRequest = {
    requestId,
    fromPlayerId: from.id,
    toPlayerId: to.id,
    type: payload.type,
    createdAt: now
  };
  from.busy = true;
  to.busy = true;

  io.to(to.socketId).emit('shareIncoming', {
    requestId,
    fromPlayerId: from.id,
    fromName: from.name,
    type: payload.type
  });

  return { ok: true };
}

function handleShareResponse(io, game, responderId, payload) {
  const pending = game.pendingRequest;
  if (!pending || pending.requestId !== payload.requestId) {
    return { ok: false, message: 'No matching request.' };
  }

  if (pending.toPlayerId !== responderId) {
    return { ok: false, message: 'Only target can respond.' };
  }

  const from = game.players.get(pending.fromPlayerId);
  const to = game.players.get(pending.toPlayerId);

  if (!from || !to || !from.connected || !to.connected) {
    resetBusy(game, [pending.fromPlayerId, pending.toPlayerId]);
    return { ok: false, message: 'Player disconnected.' };
  }

  if (!payload.accepted) {
    io.to(from.socketId).emit('errorMessage', { message: `${to.name} declined your share request.` });
    resetBusy(game, [from.id, to.id]);
    return { ok: true };
  }

  if (distance(from, to) > INTERACTION_RADIUS) {
    io.to(from.socketId).emit('errorMessage', { message: 'Share failed: player moved out of range.' });
    io.to(to.socketId).emit('errorMessage', { message: 'Share failed: player moved out of range.' });
    resetBusy(game, [from.id, to.id]);
    return { ok: true };
  }

  const payloadData = pending.type === 'color'
    ? { team: to.role.team }
    : { team: to.role.team, roleName: to.role.roleName };
  const reciprocalData = pending.type === 'color'
    ? { team: from.role.team }
    : { team: from.role.team, roleName: from.role.roleName };

  io.to(from.socketId).emit('shareResult', {
    withPlayerId: to.id,
    withName: to.name,
    type: pending.type,
    payload: payloadData
  });

  io.to(to.socketId).emit('shareResult', {
    withPlayerId: from.id,
    withName: from.name,
    type: pending.type,
    payload: reciprocalData
  });

  const now = Date.now();
  from.cooldowns[pending.type] = now + COOLDOWN_MS[pending.type];
  resetBusy(game, [from.id, to.id]);
  return { ok: true };
}

function submitHostages(game, playerId, hostageIds) {
  if (game.phase !== 'exchange_commit') return { ok: false, message: 'Not in exchange commit phase.' };
  const player = game.players.get(playerId);
  if (!player) return { ok: false, message: 'Player missing.' };
  const room = player.room;
  if (game.leaders[room] !== playerId) return { ok: false, message: 'Only current leader can submit.' };

  const unique = Array.isArray(hostageIds) ? Array.from(new Set(hostageIds)) : [];
  const roomPlayers = Array.from(game.players.values()).filter((p) => p.connected && p.room === room);
  const validIds = unique.filter((id) => roomPlayers.some((p) => p.id === id));
  const max = Math.min(game.settings.hostagesPerRoom, roomPlayers.length);
  const nonLeaderCount = roomPlayers.filter((p) => p.id !== playerId).length;
  if (validIds.includes(playerId) && nonLeaderCount >= max) {
    return { ok: false, message: 'Leaders must select other citizens when possible.' };
  }
  if (validIds.length !== max) {
    return { ok: false, message: `Must submit exactly ${max} hostages.` };
  }

  game.pendingHostages[room] = validIds;
  return { ok: true };
}

function submitLeaderVote(game, playerId, candidateId) {
  if (game.phase !== 'leader_vote') return { ok: false, message: 'Leader voting is closed.' };

  const voter = game.players.get(playerId);
  const candidate = game.players.get(candidateId);
  if (!voter || !voter.connected || !candidate || !candidate.connected) {
    return { ok: false, message: 'Invalid voter or candidate.' };
  }
  if (voter.room !== candidate.room) return { ok: false, message: 'Must vote within your room.' };
  if (!game.leaderVoteTargets[voter.room]) return { ok: false, message: 'Your room is not currently voting.' };

  game.leaderVotes[voter.room][voter.id] = candidate.id;

  const roomPlayers = connectedInRoom(game, voter.room);
  const votes = Object.values(game.leaderVotes[voter.room]);
  const countForCandidate = votes.filter((id) => id === candidate.id).length;
  if (hasMajority(countForCandidate, roomPlayers.length)) {
    game.leaders[voter.room] = candidate.id;
    game.leaderRound[voter.room] = game.round;
  }

  if (hasResolvedTargetLeaders(game)) {
    const now = Date.now();
    const resumeAt = game.playingResumeUntil;
    startPlayingPhase(game, resumeAt && resumeAt > now ? resumeAt : null);
  }

  return { ok: true };
}

function callConfidenceVote(game, playerId) {
  if (game.phase !== 'playing') return { ok: false, message: 'Confidence votes only during playing phase.' };
  const player = game.players.get(playerId);
  if (!player || !player.connected) return { ok: false, message: 'Player missing.' };

  const room = player.room;
  if (!game.leaders[room]) return { ok: false, message: 'No active leader to challenge.' };

  game.confidenceVotes[room][player.id] = true;
  const noConfidenceCount = Object.keys(game.confidenceVotes[room]).length;
  const connectedCount = connectedInRoom(game, room).length;

  if (hasMajority(noConfidenceCount, connectedCount)) {
    startLeaderVotePhase(game, { A: room === ROOM_A, B: room === ROOM_B }, true);
  }

  return { ok: true };
}

function handleLeaderDisconnect(game, room) {
  if (game.leaders[room]) {
    startLeaderVotePhase(game, { A: room === ROOM_A, B: room === ROOM_B }, game.phase === 'playing');
  }
}

module.exports = {
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
  submitLeaderVote,
  callConfidenceVote,
  handleLeaderDisconnect
};
