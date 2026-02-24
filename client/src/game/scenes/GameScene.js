import Phaser from 'phaser';

export class GameScene extends Phaser.Scene {
  constructor(state) {
    super('GameScene');
    this.state = state;
    this.sprites = new Map();
  }

  create() {
    this.cameras.main.setBackgroundColor('#0b1220');
    this.roomPanel = this.add.rectangle(500, 300, 880, 520, 0x334155, 0.25).setStrokeStyle(2, 0x94a3b8);
    this.roomLabel = this.add.text(430, 40, 'Room -', { fontSize: '24px', color: '#e2e8f0' });
  }

  update() {
    const snapshot = this.state.latestRoomState;
    if (!snapshot) return;

    this.roomLabel.setText(`Room ${snapshot.room}`);

    const activeIds = new Set(snapshot.players.map((p) => p.id));
    snapshot.players.forEach((player) => {
      let entry = this.sprites.get(player.id);
      if (!entry) {
        const color = this.getPlayerColor(player.id);
        const circle = this.add.circle(player.x, player.y, 18, color);
        const label = this.add.text(player.x - 22, player.y - 34, player.name, { fontSize: '12px', color: '#ffffff' });
        entry = { circle, label, x: player.x, y: player.y };
        this.sprites.set(player.id, entry);
      }

      entry.x = Phaser.Math.Linear(entry.x, player.x, 0.35);
      entry.y = Phaser.Math.Linear(entry.y, player.y, 0.35);
      entry.circle.setPosition(entry.x, entry.y);
      entry.label.setPosition(entry.x - 22, entry.y - 34);
      entry.circle.setFillStyle(player.isBusy ? 0xf59e0b : this.getPlayerColor(player.id));
    });

    Array.from(this.sprites.entries()).forEach(([id, entry]) => {
      if (activeIds.has(id)) return;
      entry.circle.destroy();
      entry.label.destroy();
      this.sprites.delete(id);
    });
  }

  getPlayerColor(playerId) {
    if (playerId === this.state.yourId) return 0x22c55e;
    const knownTeam = this.state.getKnownTeam?.(playerId);
    if (knownTeam === 'Blue') return 0x60a5fa;
    if (knownTeam === 'Red') return 0xf87171;
    return 0xe5e7eb;
  }
}
