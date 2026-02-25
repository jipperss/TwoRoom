import Phaser from 'phaser';
import { createSocket } from './net/socket';
import { GameScene } from './game/scenes/GameScene';
import { toast, setHidden } from './ui/dom';

const socket = createSocket();

const state = {
  yourId: null,
  code: null,
  hostId: null,
  players: [],
  latestRoomState: null,
  role: null,
  settings: null,
  incomingRequest: null,
  interactTargetId: null,
  menuOpen: false,
  keys: { up: false, down: false, left: false, right: false },
  knownIntel: {},
  chatMessages: [],
  activeSidebarTab: 'intel',
  selectedLeaderCandidateId: null
};

state.getKnownTeam = (playerId) => state.knownIntel[playerId]?.team || null;

function intelStorageKey() {
  if (!state.code || !state.yourId) return null;
  return `tworoom:intel:${state.code}:${state.yourId}`;
}

function persistKnownIntel() {
  const key = intelStorageKey();
  if (!key) return;
  localStorage.setItem(key, JSON.stringify(state.knownIntel));
}

function restoreKnownIntel() {
  const key = intelStorageKey();
  if (!key) return;
  const raw = localStorage.getItem(key);
  if (!raw) return;
  try {
    state.knownIntel = JSON.parse(raw) || {};
  } catch {
    state.knownIntel = {};
  }
}

function renderKnownIntel() {
  const status = document.getElementById('intelStatus');
  const list = document.getElementById('intelList');
  if (!state.players.length || !state.yourId) {
    status.textContent = 'No intel yet.';
    list.innerHTML = '';
    return;
  }

  const others = state.players.filter((p) => p.id !== state.yourId);
  if (!others.length) {
    status.textContent = 'No other players.';
    list.innerHTML = '';
    return;
  }

  status.textContent = 'Only your discovered info is shown.';
  list.innerHTML = '';
  others.forEach((player) => {
    const intel = state.knownIntel[player.id];
    const team = intel?.team || null;
    const roleName = intel?.roleName || null;

    const li = document.createElement('li');
    li.className = 'intel-item';
    const dotClass = team === 'Blue' ? 'blue' : team === 'Red' ? 'red' : 'unknown';

    li.innerHTML = `
      <div class="intel-name">${player.name}</div>
      <div class="intel-meta"><span class="team-dot ${dotClass}"></span>Team: ${team || 'Unknown'}</div>
      <div class="intel-meta">Card: ${roleName || '?'}</div>
    `;
    list.appendChild(li);
  });
}

function setSidebarTab(tabName) {
  state.activeSidebarTab = tabName;
  const intelActive = tabName === 'intel';
  document.getElementById('intelTab').classList.toggle('active', intelActive);
  document.getElementById('chatTab').classList.toggle('active', !intelActive);
  document.getElementById('intelTabBtn').classList.toggle('active', intelActive);
  document.getElementById('chatTabBtn').classList.toggle('active', !intelActive);
}

function renderChatFeed() {
  const feed = document.getElementById('chatFeed');
  feed.innerHTML = '';
  state.chatMessages.forEach((msg) => {
    const li = document.createElement('li');
    li.className = 'chat-item';
    if (msg.system) {
      li.innerHTML = `<div class="chat-system">${msg.text}</div>`;
    } else {
      const scopeLabel = msg.scope === 'room' ? `Room ${msg.room}` : msg.scope === 'summit' ? 'Leader Summit' : 'Game';
      li.innerHTML = `<div class="chat-meta">${msg.fromName} · ${scopeLabel}</div><div>${msg.text}</div>`;
    }
    feed.appendChild(li);
  });
  feed.scrollTop = feed.scrollHeight;
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: 1000,
  height: 600,
  parent: 'game-container',
  scene: [new GameScene(state)]
});

const nameInput = document.getElementById('nameInput');
const codeInput = document.getElementById('codeInput');

function renderLobby() {
  document.getElementById('lobbyMeta').innerText = state.code ? `Code: ${state.code}\nHost: ${state.hostId}` : 'Not connected';
  const playerList = document.getElementById('playerList');
  playerList.innerHTML = '';
  state.players.forEach((p) => {
    const li = document.createElement('li');
    li.textContent = `${p.name} ${p.ready ? '✅' : '⬜'} ${p.id === state.hostId ? '(Host)' : ''}`;
    playerList.appendChild(li);
  });
  renderKnownIntel();
}

function renderHud() {
  const hud = document.getElementById('hud');
  if (!state.latestRoomState) {
    hud.innerHTML = '';
    setHidden('hud', true);
    return;
  }
  const leader = state.latestRoomState.players.find((p) => p.id === state.latestRoomState.leaderId);
  hud.innerHTML = [
    `Room: ${state.latestRoomState.room}`,
    `Round: ${state.latestRoomState.round}`,
    `Phase: ${state.latestRoomState.phase}`,
    `Time: ${(state.latestRoomState.timeLeftMs / 1000).toFixed(1)}s`,
    `Leader: ${leader ? leader.name : 'None'}`,
    `You: ${state.role?.team ?? '-'} ${state.role?.roleName ?? ''}`
  ].join('<br/>');
  setHidden('hud', false);
}

function renderLeaderVoteControls() {
  const wrap = document.getElementById('leaderVoteControls');
  if (!state.latestRoomState || state.latestRoomState.phase !== 'leader_vote') {
    wrap.classList.add('hidden');
    return;
  }

  wrap.classList.remove('hidden');
  const options = document.getElementById('leaderVoteOptions');
  options.innerHTML = '';

  state.latestRoomState.players.forEach((p) => {
    const row = document.createElement('label');
    row.style.display = 'block';
    row.innerHTML = `<input type="radio" name="leaderCandidate" value="${p.id}" ${state.selectedLeaderCandidateId === p.id ? 'checked' : ''}/> ${p.name}`;
    options.appendChild(row);
  });
}

function renderSwapControls() {
  const wrap = document.getElementById('swapControls');
  if (!state.latestRoomState || state.latestRoomState.phase !== 'exchange_commit' || state.latestRoomState.leaderId !== state.yourId) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  document.getElementById('swapHelp').innerText = `Select ${state.settings?.hostagesPerRoom ?? 1} outgoing citizen(s) from Room ${state.latestRoomState.room}`;
  const options = document.getElementById('hostageOptions');
  options.innerHTML = '';
  state.latestRoomState.players
    .filter((p) => p.id !== state.yourId)
    .forEach((p) => {
      const id = `hostage-${p.id}`;
      const row = document.createElement('label');
      row.style.display = 'block';
      row.innerHTML = `<input type="checkbox" id="${id}" value="${p.id}" /> ${p.name}`;
      options.appendChild(row);
    });
}

function renderGovernanceControls() {
  const btn = document.getElementById('callConfidenceBtn');
  const enabled = state.latestRoomState?.phase === 'playing' && Boolean(state.latestRoomState?.leaderId);
  btn.disabled = !enabled;
}

function renderChatScopeOptions() {
  const scope = document.getElementById('chatScopeInput');
  const summitVisible = state.latestRoomState?.phase === 'leader_summit' && state.latestRoomState?.leaderId === state.yourId;
  const summitOption = scope.querySelector('option[value="summit"]');
  summitOption.classList.toggle('hidden', !summitVisible);
  if (!summitVisible && scope.value === 'summit') {
    scope.value = 'room';
  }
}

function getClosestInRange() {
  if (!state.latestRoomState || !state.yourId) return null;
  const me = state.latestRoomState.players.find((p) => p.id === state.yourId);
  if (!me) return null;

  let best = null;
  state.latestRoomState.players.forEach((p) => {
    if (p.id === me.id) return;
    const dx = p.x - me.x;
    const dy = p.y - me.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= 80 && (!best || d < best.d)) best = { id: p.id, d };
  });
  return best;
}

function handleInteractMenu(forceHide = false) {
  const closest = getClosestInRange();
  if (forceHide || !closest) {
    state.interactTargetId = null;
    state.menuOpen = false;
    setHidden('interactPrompt', true);
    setHidden('interactMenu', true);
    return;
  }

  state.interactTargetId = closest.id;
  setHidden('interactPrompt', false);
  setHidden('interactMenu', !state.menuOpen);
}

socket.on('connect', () => {
  console.log('connected', socket.id);
});

socket.on('lobbyState', (payload) => {
  const previousCode = state.code;
  state.code = payload.code;
  state.hostId = payload.hostId;
  state.players = payload.players;
  if (!state.yourId) state.yourId = socket.id;
  if (previousCode && previousCode !== state.code) state.knownIntel = {};
  restoreKnownIntel();
  renderLobby();
});

socket.on('gameStarted', (payload) => {
  state.yourId = payload.yourId;
  state.role = payload.role;
  state.settings = payload.settings;
  state.latestRoomState = null;
  state.chatMessages = [{ system: true, text: 'Game chat started.' }];
  state.selectedLeaderCandidateId = null;
  restoreKnownIntel();
  setHidden('endScreen', true);
  toast(`Game started. You are ${payload.role.team} ${payload.role.roleName}`);
  renderLeaderVoteControls();
  renderSwapControls();
  renderGovernanceControls();
});

socket.on('chatMessage', (payload) => {
  state.chatMessages.push(payload);
  if (state.chatMessages.length > 120) state.chatMessages = state.chatMessages.slice(-120);
  renderChatFeed();
});

socket.on('roomState', (payload) => {
  state.latestRoomState = payload;
  renderHud();
  renderLeaderVoteControls();
  renderSwapControls();
  renderGovernanceControls();
  renderChatScopeOptions();
  if (payload.phase === 'ended') handleInteractMenu(true);
  else handleInteractMenu(false);
});

socket.on('shareIncoming', (payload) => {
  state.incomingRequest = payload;
  document.getElementById('incomingText').innerText = `${payload.fromName} requests a ${payload.type} share.`;
  setHidden('incomingModal', false);
});

socket.on('shareResult', (payload) => {
  state.knownIntel[payload.withPlayerId] = {
    team: payload.payload.team || state.knownIntel[payload.withPlayerId]?.team || null,
    roleName: payload.payload.roleName || state.knownIntel[payload.withPlayerId]?.roleName || null,
    learnedAt: Date.now()
  };
  persistKnownIntel();
  renderKnownIntel();

  const details = payload.type === 'color'
    ? `${payload.withName} is ${payload.payload.team}`
    : `${payload.withName} is ${payload.payload.team} ${payload.payload.roleName}`;
  toast(`Share complete: ${details}`);
  state.menuOpen = false;
  handleInteractMenu(false);
});

socket.on('gameEnded', (payload) => {
  document.getElementById('endTitle').innerText = `Winner: ${payload.winner}`;
  document.getElementById('endReason').innerText = `${payload.reason} Crown: ${payload.crownRoom} / Claw: ${payload.clawRoom}`;
  setHidden('endScreen', false);
  handleInteractMenu(true);
  renderKnownIntel();
});

socket.on('errorMessage', (payload) => {
  toast(payload.message);
});

document.getElementById('createBtn').onclick = () => socket.emit('createGame', { name: nameInput.value });
document.getElementById('joinBtn').onclick = () => socket.emit('joinGame', { code: codeInput.value, name: nameInput.value });
document.getElementById('readyBtn').onclick = () => {
  const me = state.players.find((p) => p.id === state.yourId);
  socket.emit('setReady', { ready: !(me?.ready) });
};

document.getElementById('startBtn').onclick = () => {
  socket.emit('startGame', {
    settings: {
      rounds: Number(document.getElementById('roundsInput').value),
      roundSeconds: Number(document.getElementById('secondsInput').value),
      hostagesPerRoom: Number(document.getElementById('hostagesInput').value),
      winRule: document.getElementById('winRuleInput').value
    }
  });
};

document.getElementById('submitLeaderVoteBtn').onclick = () => {
  const selected = document.querySelector('input[name="leaderCandidate"]:checked');
  if (!selected) {
    toast('Pick a candidate before submitting your vote.');
    return;
  }
  state.selectedLeaderCandidateId = selected.value;
  socket.emit('leaderVote', { candidateId: selected.value });
  toast('Leader vote submitted.');
};

document.getElementById('callConfidenceBtn').onclick = () => {
  socket.emit('callConfidenceVote');
  toast('No-confidence vote called.');
};

document.getElementById('submitHostagesBtn').onclick = () => {
  const selected = Array.from(document.querySelectorAll('#hostageOptions input:checked')).map((el) => el.value);
  socket.emit('leaderSubmitHostages', { hostageIds: selected });
};

document.getElementById('shareColorBtn').onclick = () => {
  if (!state.interactTargetId) return;
  socket.emit('shareRequest', { toPlayerId: state.interactTargetId, type: 'color' });
  state.menuOpen = false;
  handleInteractMenu(false);
};

document.getElementById('shareCardBtn').onclick = () => {
  if (!state.interactTargetId) return;
  socket.emit('shareRequest', { toPlayerId: state.interactTargetId, type: 'card' });
  state.menuOpen = false;
  handleInteractMenu(false);
};

document.getElementById('acceptShareBtn').onclick = () => {
  if (state.incomingRequest) socket.emit('shareResponse', { requestId: state.incomingRequest.requestId, accepted: true });
  state.incomingRequest = null;
  setHidden('incomingModal', true);
};

document.getElementById('declineShareBtn').onclick = () => {
  if (state.incomingRequest) socket.emit('shareResponse', { requestId: state.incomingRequest.requestId, accepted: false });
  state.incomingRequest = null;
  setHidden('incomingModal', true);
};

document.getElementById('returnLobbyBtn').onclick = () => setHidden('endScreen', true);
document.getElementById('intelTabBtn').onclick = () => setSidebarTab('intel');
document.getElementById('chatTabBtn').onclick = () => setSidebarTab('chat');

function sendChatMessage() {
  const input = document.getElementById('chatMessageInput');
  const scope = document.getElementById('chatScopeInput').value;
  const text = input.value.trim();
  if (!text) return;
  socket.emit('chatMessage', { scope, text });
  input.value = '';
}

document.getElementById('sendChatBtn').onclick = sendChatMessage;
document.getElementById('chatMessageInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendChatMessage();
  }
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'w' || e.key === 'ArrowUp') state.keys.up = true;
  if (e.key === 's' || e.key === 'ArrowDown') state.keys.down = true;
  if (e.key === 'a' || e.key === 'ArrowLeft') state.keys.left = true;
  if (e.key === 'd' || e.key === 'ArrowRight') state.keys.right = true;

  if ((e.key === 'e' || e.key === 'E') && state.interactTargetId) {
    state.menuOpen = !state.menuOpen;
    handleInteractMenu(false);
  }

  if (state.latestRoomState?.phase === 'exchange_commit' && state.latestRoomState?.leaderId === state.yourId && e.key === 'h') {
    const ids = state.latestRoomState.players.filter((p) => p.id !== state.yourId).slice(0, state.settings?.hostagesPerRoom ?? 1).map((p) => p.id);
    socket.emit('leaderSubmitHostages', { hostageIds: ids });
    toast('Outgoing citizens submitted using quick key H.');
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'w' || e.key === 'ArrowUp') state.keys.up = false;
  if (e.key === 's' || e.key === 'ArrowDown') state.keys.down = false;
  if (e.key === 'a' || e.key === 'ArrowLeft') state.keys.left = false;
  if (e.key === 'd' || e.key === 'ArrowRight') state.keys.right = false;
});

setInterval(() => {
  socket.emit('input', state.keys);
}, 100);

window.__phaserGame = game;
