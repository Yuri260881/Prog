const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const { query, initDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

/* ── Auth Middleware ──────────────────────────── */
async function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Не авторизован' });
  try {
    const { rows } = await query(`
      SELECT u.id, u.username, u.role, u.store_id, u.display_name
      FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = $1
    `, [token]);
    if (!rows.length) return res.status(401).json({ error: 'Сессия истекла' });
    req.user = rows[0];
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Доступ запрещён' });
  next();
}

/* ── Auth Routes ──────────────────────────────── */
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const { rows } = await query('SELECT * FROM users WHERE username = $1', [username]);
    const user = rows[0];
    if (!user || !bcrypt.compareSync(password, user.password_hash))
      return res.status(401).json({ error: 'Неверный логин или пароль' });

    const token = crypto.randomUUID();
    await query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, user.id]);

    let store = null;
    if (user.store_id) {
      const { rows: sr } = await query('SELECT * FROM stores WHERE id = $1', [user.store_id]);
      store = sr[0] || null;
    }
    res.json({ token, user: { id: user.id, username: user.username, role: user.role, store_id: user.store_id, display_name: user.display_name, store } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/logout', auth, async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  await query('DELETE FROM sessions WHERE token = $1', [token]);
  res.json({ ok: true });
});

app.get('/api/me', auth, async (req, res) => {
  let store = null;
  if (req.user.store_id) {
    const { rows } = await query('SELECT * FROM stores WHERE id = $1', [req.user.store_id]);
    store = rows[0] || null;
  }
  res.json({ ...req.user, store });
});

/* ── Reports ──────────────────────────────────── */
app.post('/api/reports', auth, async (req, res) => {
  try {
    const { date, total, cash, card, transfer, sales_count, salary, purchases, write_off } = req.body;
    const store_id = req.user.store_id;
    if (!store_id) return res.status(400).json({ error: 'Нет привязки к магазину' });

    const { rows } = await query(
      `INSERT INTO reports (store_id,user_id,date,total,cash,card,transfer,sales_count,salary,purchases,write_off)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [store_id, req.user.id, date, total||0, cash||0, card||0, transfer||0, sales_count||0, salary||0, purchases||0, write_off||0]
    );
    res.json({ id: rows[0].id });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Отчёт за эту дату уже существует' });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reports', auth, async (req, res) => {
  try {
    let q = `SELECT r.*, s.name as store_name, u.display_name as user_name
      FROM reports r JOIN stores s ON r.store_id=s.id JOIN users u ON r.user_id=u.id WHERE 1=1`;
    const p = [];
    let i = 1;

    if (req.user.role === 'employee') { q += ` AND r.store_id=$${i++}`; p.push(req.user.store_id); }
    else if (req.query.store_id) { q += ` AND r.store_id=$${i++}`; p.push(req.query.store_id); }
    if (req.query.from) { q += ` AND r.date>=$${i++}`; p.push(req.query.from); }
    if (req.query.to) { q += ` AND r.date<=$${i++}`; p.push(req.query.to); }
    q += ' ORDER BY r.date DESC';

    const { rows } = await query(q, p);
    // Convert numeric fields from string to number (pg returns strings for NUMERIC)
    const result = rows.map(r => ({
      ...r,
      total: +r.total, cash: +r.cash, card: +r.card, transfer: +r.transfer,
      salary: +r.salary, purchases: +r.purchases, write_off: +r.write_off,
      date: r.date instanceof Date ? r.date.toISOString().slice(0,10) : String(r.date).slice(0,10)
    }));
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/reports/:id', auth, adminOnly, async (req, res) => {
  try {
    const { total, cash, card, transfer, sales_count, salary, purchases, write_off } = req.body;
    await query(
      `UPDATE reports SET total=$1,cash=$2,card=$3,transfer=$4,sales_count=$5,salary=$6,purchases=$7,write_off=$8 WHERE id=$9`,
      [total, cash, card, transfer, sales_count, salary, purchases, write_off, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/reports/:id', auth, adminOnly, async (req, res) => {
  await query('DELETE FROM reports WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

/* ── Stores ───────────────────────────────────── */
app.get('/api/stores', auth, async (req, res) => {
  const { rows } = await query('SELECT * FROM stores ORDER BY name');
  res.json(rows);
});

app.post('/api/stores', auth, adminOnly, async (req, res) => {
  try {
    const { rows } = await query('INSERT INTO stores (name) VALUES ($1) RETURNING id', [req.body.name]);
    res.json({ id: rows[0].id });
  } catch { res.status(400).json({ error: 'Магазин уже существует' }); }
});

app.put('/api/stores/:id', auth, adminOnly, async (req, res) => {
  await query('UPDATE stores SET name=$1 WHERE id=$2', [req.body.name, req.params.id]);
  res.json({ ok: true });
});

/* ── Users ────────────────────────────────────── */
app.get('/api/users', auth, adminOnly, async (req, res) => {
  const { rows } = await query(`
    SELECT u.id,u.username,u.display_name,u.role,u.store_id,s.name as store_name,u.created_at
    FROM users u LEFT JOIN stores s ON u.store_id=s.id ORDER BY u.role,u.username
  `);
  res.json(rows);
});

app.post('/api/users', auth, adminOnly, async (req, res) => {
  try {
    const { username, password, display_name, role, store_id } = req.body;
    const { rows } = await query(
      'INSERT INTO users (username,password_hash,display_name,role,store_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [username, bcrypt.hashSync(password, 10), display_name, role, store_id || null]
    );
    res.json({ id: rows[0].id });
  } catch { res.status(400).json({ error: 'Логин уже занят' }); }
});

app.put('/api/users/:id', auth, adminOnly, async (req, res) => {
  try {
    const { username, password, display_name, role, store_id } = req.body;
    if (password) {
      await query(
        'UPDATE users SET username=$1,password_hash=$2,display_name=$3,role=$4,store_id=$5 WHERE id=$6',
        [username, bcrypt.hashSync(password, 10), display_name, role, store_id || null, req.params.id]
      );
    } else {
      await query(
        'UPDATE users SET username=$1,display_name=$2,role=$3,store_id=$4 WHERE id=$5',
        [username, display_name, role, store_id || null, req.params.id]
      );
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/users/:id', auth, adminOnly, async (req, res) => {
  await query('DELETE FROM sessions WHERE user_id=$1', [req.params.id]);
  await query('DELETE FROM users WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

/* ── Serve static (production build) ─────────── */
const distPath = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(distPath, 'index.html'));
    }
  });
}

/* ── Start ────────────────────────────────────── */
initDB()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => console.log(`✅ Server running on port ${PORT}`));
  })
  .catch(err => {
    console.error('❌ DB init failed:', err.message);
    process.exit(1);
  });
