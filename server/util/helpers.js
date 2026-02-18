function randomCode(length = 4) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function sanitizeName(input) {
  if (typeof input !== 'string') return null;
  const clean = input.trim().slice(0, 20);
  return clean.length ? clean : null;
}

module.exports = {
  randomCode,
  clamp,
  distance,
  sanitizeName
};
