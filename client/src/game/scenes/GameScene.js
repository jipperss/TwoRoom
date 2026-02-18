import Phaser from 'phaser';

export class GameScene extends Phaser.Scene {
  constructor(state) {
    super('GameScene');
    this.state = state;
    this.sprites = new Map();
  }

  create() {
    this.cameras.main.setBackgroundColor('#0b1220');
    this.add.rectangle(250, 300, 400, 520, 0x1d4ed8, 0.15).setStrokeStyle(2, 0x3b82f6);
    this.add.rectangle(750, 300, 400, 520, 0xef4444, 0.15).setStrokeStyle(2, 0xf87171);
    this.add.text(220, 40, 'Room A', { fontSize: '20px', color: '#93c5fd' });
    this.add.text(720, 40, 'Room B', { fontSize: '20px', color: '#fca5a5' });
  }

  update() {
    const snapshot = this.state.latestRoomState;
    if (!snapshot) return;

    const activeIds = new Set(snapshot.players.map((p) => p.id));
    snapshot.players.forEach((player) => {
      let entry = this.sprites.get(player.id);
      if (!entry) {
        const color = player.id === this.state.yourId ? 0x22c55e : 0xe5e7eb;
        const circle = this.add.circle(player.x, player.y, 18, color);
        const label = this.add.text(player.x - 22, player.y - 34, player.name, { fontSize: '12px', color: '#ffffff' });
        entry = { circle, label, x: player.x, y: player.y };
        this.sprites.set(player.id, entry);
      }

      entry.x = Phaser.Math.Linear(entry.x, player.x, 0.35);
      entry.y = Phaser.Math.Linear(entry.y, player.y, 0.35);
      entry.circle.setPosition(entry.x, entry.y);
      entry.label.setPosition(entry.x - 22, entry.y - 34);
      entry.circle.setFillStyle(player.isBusy ? 0xf59e0b : (player.id === this.state.yourId ? 0x22c55e : 0xe5e7eb));
    });

    Array.from(this.sprites.entries()).forEach(([id, entry]) => {
      if (activeIds.has(id)) return;
      entry.circle.destroy();
      entry.label.destroy();
      this.sprites.delete(id);
    });
  }
}
