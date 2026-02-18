export function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.add('hidden'), 4500);
}

export function setHidden(id, hidden) {
  document.getElementById(id).classList.toggle('hidden', hidden);
}
