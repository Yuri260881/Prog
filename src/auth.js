import { api, setAuth } from './api.js';
import { toast } from './main.js';

export function initAuth(onLogin) {
  const form = document.getElementById('login-form');
  const errorEl = document.getElementById('login-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    if (!username || !password) { errorEl.textContent = 'Заполните все поля'; return; }

    const btn = document.getElementById('login-btn');
    btn.disabled = true;
    btn.querySelector('span').textContent = 'Вход...';

    try {
      const data = await api.login(username, password);
      setAuth(data.token, data.user);
      form.reset();
      toast('Добро пожаловать!', 'success');
      onLogin(data.user);
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.querySelector('span').textContent = 'Войти';
    }
  });
}
