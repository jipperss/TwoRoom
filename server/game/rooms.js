const ROOM_A = 'A';
const ROOM_B = 'B';

function splitRooms(playerIds) {
  const half = Math.ceil(playerIds.length / 2);
  const map = new Map();
  playerIds.forEach((id, index) => {
    map.set(id, index < half ? ROOM_A : ROOM_B);
  });
  return map;
}

function mapBoundsForRoom(room) {
  const common = { minX: 50, minY: 50, maxY: 550 };
  return room === ROOM_A
    ? { ...common, minX: 50, maxX: 450 }
    : { ...common, minX: 550, maxX: 950 };
}

module.exports = {
  ROOM_A,
  ROOM_B,
  splitRooms,
  mapBoundsForRoom
};
