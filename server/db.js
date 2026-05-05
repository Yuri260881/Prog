const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'photocenter.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    role TEXT NOT NULL CHECK(role IN ('employee', 'admin')),
    store_id INTEGER REFERENCES stores(id),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    date TEXT NOT NULL,
    total REAL NOT NULL DEFAULT 0,
    cash REAL NOT NULL DEFAULT 0,
    card REAL NOT NULL DEFAULT 0,
    transfer REAL NOT NULL DEFAULT 0,
    sales_count INTEGER NOT NULL DEFAULT 0,
    salary REAL NOT NULL DEFAULT 0,
    purchases REAL NOT NULL DEFAULT 0,
    write_off REAL NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(store_id, date)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Seed default data
const storeCount = db.prepare('SELECT COUNT(*) as c FROM stores').get().c;
if (storeCount === 0) {
  const ins = db.prepare('INSERT INTO stores (name) VALUES (?)');
  ins.run('Фотосмайл- Взлетная');
  ins.run('Фотосмайл2- Демократический');
  ins.run('Фотопечать- Свердлова');
}

const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
if (userCount === 0) {
  const stores = db.prepare('SELECT * FROM stores').all();
  const ins = db.prepare('INSERT INTO users (username, password_hash, display_name, role, store_id) VALUES (?,?,?,?,?)');
  ins.run('vzletnaya', bcrypt.hashSync('photo123', 10), 'Сотрудник Взлётная', 'employee', stores[0].id);
  ins.run('demokrat', bcrypt.hashSync('photo123', 10), 'Сотрудник Демократический', 'employee', stores[1].id);
  ins.run('sverdlova', bcrypt.hashSync('photo123', 10), 'Сотрудник Свердлова', 'employee', stores[2].id);
  ins.run('admin', bcrypt.hashSync('admin2026', 10), 'Администратор', 'admin', null);
}

module.exports = db;
