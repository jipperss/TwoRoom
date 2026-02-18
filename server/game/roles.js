function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function assignRoles(players) {
  const ids = Array.from(players.keys());
  const shuffled = shuffle(ids.slice());

  const assignments = new Map();
  shuffled.forEach((id, index) => {
    const team = index % 2 === 0 ? 'Red' : 'Blue';
    assignments.set(id, { team, roleName: 'Commoner' });
  });

  if (shuffled[0]) {
    const existing = assignments.get(shuffled[0]);
    assignments.set(shuffled[0], { ...existing, roleName: 'Crown' });
  }
  if (shuffled[1]) {
    const existing = assignments.get(shuffled[1]);
    assignments.set(shuffled[1], { ...existing, roleName: 'Claw' });
  }

  return assignments;
}

module.exports = {
  assignRoles
};
