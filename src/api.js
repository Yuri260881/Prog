/* ═══ API Client ═══ */
const TOKEN_KEY = 'pc_token';
const USER_KEY = 'pc_user';

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setAuth(token, user) { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(USER_KEY, JSON.stringify(user)); }
function getUser() { try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; } }
function clearAuth() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); }

async function request(url, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) { clearAuth(); showScreen('login'); throw new Error('Сессия истекла'); }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка сервера');
  return data;
}

export const api = {
  login: (username, password) => request('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request('/api/logout', { method: 'POST' }),
  me: () => request('/api/me'),
  getReports: (params = {}) => {
    const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([,v]) => v))).toString();
    return request(`/api/reports${q ? '?' + q : ''}`);
  },
  createReport: (data) => request('/api/reports', { method: 'POST', body: JSON.stringify(data) }),
  updateReport: (id, data) => request(`/api/reports/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteReport: (id) => request(`/api/reports/${id}`, { method: 'DELETE' }),
  getStores: () => request('/api/stores'),
  createStore: (name) => request('/api/stores', { method: 'POST', body: JSON.stringify({ name }) }),
  updateStore: (id, name) => request(`/api/stores/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  getUsers: () => request('/api/users'),
  createUser: (data) => request('/api/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id, data) => request(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteUser: (id) => request(`/api/users/${id}`, { method: 'DELETE' }),
};

export { getToken, setAuth, getUser, clearAuth };

// Import showScreen lazily to avoid circular deps
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`${name}-screen`)?.classList.add('active');
}
