import './style.css';
import { getToken, getUser, clearAuth, api } from './api.js';
import { initAuth } from './auth.js';
import { initEmployee } from './employee.js';
import { initAdmin } from './admin.js';

/* ── Toast Notifications ──────────────── */
export function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type} show`;
  setTimeout(() => el.classList.remove('show'), 3000);
}

/* ── Format Number ────────────────────── */
export function fmt(n) {
  return Number(n || 0).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/* ── Screen Management ────────────────── */
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`${name}-screen`)?.classList.add('active');
}

/* ── Logout Handler ───────────────────── */
function setupLogout(btnId) {
  document.getElementById(btnId).addEventListener('click', async () => {
    try { await api.logout(); } catch {}
    clearAuth();
    showScreen('login');
    toast('Вы вышли из системы', 'info');
  });
}

/* ── Route by Role ────────────────────── */
function routeUser(user) {
  if (user.role === 'admin') {
    showScreen('admin');
    initAdmin(user);
  } else {
    showScreen('employee');
    initEmployee(user);
  }
}

/* ── Init ──────────────────────────────── */
async function init() {
  // Setup auth module
  initAuth(routeUser);

  // Setup logout buttons
  setupLogout('emp-logout');
  setupLogout('adm-logout');

  // Check existing session
  const token = getToken();
  if (token) {
    try {
      const user = await api.me();
      routeUser(user);
    } catch {
      clearAuth();
      showScreen('login');
    }
  } else {
    showScreen('login');
  }
}

init();

/* ── PWA Service Worker ───────────────── */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
