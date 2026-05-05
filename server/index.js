const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

/* ── Auth Middleware ─────────────────────────── */
function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Не авторизован' });
  const row = db.prepare(`
    SELECT u.id, u.username, u.role, u.store_id, u.display_name
    FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ?
  `).get(token);
  if (!row) return res.status(401).json({ error: 'Сессия истекла' });
  req.user = row;
  next();
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Доступ запрещён' });
  next();
}

/* ── Auth Routes ─────────────────────────────── */
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  const token = crypto.randomUUID();
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, user.id);
  const store = user.store_id ? db.prepare('SELECT * FROM stores WHERE id = ?').get(user.store_id) : null;
  res.json({ token, user: { id: user.id, username: user.username, role: user.role, store_id: user.store_id, display_name: user.display_name, store } });
});

app.post('/api/logout', auth, (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  const store = req.user.store_id ? db.prepare('SELECT * FROM stores WHERE id = ?').get(req.user.store_id) : null;
  res.json({ ...req.user, store });
});

/* ── Reports ─────────────────────────────────── */
app.post('/api/reports', auth, (req, res) => {
  const { date, total, cash, card, transfer, sales_count, salary, purchases, write_off } = req.body;
  const store_id = req.user.store_id;
  if (!store_id) return res.status(400).json({ error: 'Нет привязки к магазину' });
  try {
    const r = db.prepare(`INSERT INTO reports (store_id,user_id,date,total,cash,card,transfer,sales_count,salary,purchases,write_off)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(store_id, req.user.id, date, total||0, cash||0, card||0, transfer||0, sales_count||0, salary||0, purchases||0, write_off||0);
    res.json({ id: r.lastInsertRowid });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Отчёт за эту дату уже существует' });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reports', auth, (req, res) => {
  let { store_id, from, to } = req.query;
  let q = `SELECT r.*, s.name as store_name, u.display_name as user_name
    FROM reports r JOIN stores s ON r.store_id=s.id JOIN users u ON r.user_id=u.id WHERE 1=1`;
  const p = [];
  if (req.user.role === 'employee') { q += ' AND r.store_id=?'; p.push(req.user.store_id); }
  else if (store_id) { q += ' AND r.store_id=?'; p.push(store_id); }
  if (from) { q += ' AND r.date>=?'; p.push(from); }
  if (to) { q += ' AND r.date<=?'; p.push(to); }
  q += ' ORDER BY r.date DESC';
  res.json(db.prepare(q).all(...p));
});

app.put('/api/reports/:id', auth, adminOnly, (req, res) => {
  const { total, cash, card, transfer, sales_count, salary, purchases, write_off } = req.body;
  db.prepare(`UPDATE reports SET total=?,cash=?,card=?,transfer=?,sales_count=?,salary=?,purchases=?,write_off=? WHERE id=?`)
    .run(total, cash, card, transfer, sales_count, salary, purchases, write_off, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/reports/:id', auth, adminOnly, (req, res) => {
  db.prepare('DELETE FROM reports WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

/* ── Stores ──────────────────────────────────── */
app.get('/api/stores', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM stores ORDER BY name').all());
});

app.post('/api/stores', auth, adminOnly, (req, res) => {
  try {
    const r = db.prepare('INSERT INTO stores (name) VALUES (?)').run(req.body.name);
    res.json({ id: r.lastInsertRowid });
  } catch { res.status(400).json({ error: 'Магазин уже существует' }); }
});

app.put('/api/stores/:id', auth, adminOnly, (req, res) => {
  db.prepare('UPDATE stores SET name=? WHERE id=?').run(req.body.name, req.params.id);
  res.json({ ok: true });
});

/* ── Users ────────────────────────────────────── */
app.get('/api/users', auth, adminOnly, (req, res) => {
  res.json(db.prepare(`SELECT u.id,u.username,u.display_name,u.role,u.store_id,s.name as store_name,u.created_at
    FROM users u LEFT JOIN stores s ON u.store_id=s.id ORDER BY u.role,u.username`).all());
});

app.post('/api/users', auth, adminOnly, (req, res) => {
  const { username, password, display_name, role, store_id } = req.body;
  try {
    const r = db.prepare('INSERT INTO users (username,password_hash,display_name,role,store_id) VALUES (?,?,?,?,?)')
      .run(username, bcrypt.hashSync(password, 10), display_name, role, store_id || null);
    res.json({ id: r.lastInsertRowid });
  } catch { res.status(400).json({ error: 'Логин уже занят' }); }
});

app.put('/api/users/:id', auth, adminOnly, (req, res) => {
  const { username, password, display_name, role, store_id } = req.body;
  if (password) {
    db.prepare('UPDATE users SET username=?,password_hash=?,display_name=?,role=?,store_id=? WHERE id=?')
      .run(username, bcrypt.hashSync(password, 10), display_name, role, store_id || null, req.params.id);
  } else {
    db.prepare('UPDATE users SET username=?,display_name=?,role=?,store_id=? WHERE id=?')
      .run(username, display_name, role, store_id || null, req.params.id);
  }
  res.json({ ok: true });
});

app.delete('/api/users/:id', auth, adminOnly, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.params.id);
  db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

/* ── Serve static files (production build) ───── */
const distPath = path.join(__dirname, '..', 'dist');
const fs = require('fs');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(distPath, 'index.html'));
    }
  });
}

app.listen(PORT, '0.0.0.0', () => console.log(`✅ Server running on port ${PORT}`));
