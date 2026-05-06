const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function query(text, params) {
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    return res;
  } finally {
    client.release();
  }
}

async function initDB() {
  await query(`
    CREATE TABLE IF NOT EXISTS stores (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      role TEXT NOT NULL CHECK(role IN ('employee', 'admin')),
      store_id INTEGER REFERENCES stores(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS reports (
      id SERIAL PRIMARY KEY,
      store_id INTEGER NOT NULL REFERENCES stores(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      date DATE NOT NULL,
      total NUMERIC NOT NULL DEFAULT 0,
      cash NUMERIC NOT NULL DEFAULT 0,
      card NUMERIC NOT NULL DEFAULT 0,
      transfer NUMERIC NOT NULL DEFAULT 0,
      sales_count INTEGER NOT NULL DEFAULT 0,
      salary NUMERIC NOT NULL DEFAULT 0,
      purchases NUMERIC NOT NULL DEFAULT 0,
      write_off NUMERIC NOT NULL DEFAULT 0,
      employee_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(store_id, date)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Seed stores if empty
  const { rows: storeRows } = await query('SELECT COUNT(*) as c FROM stores');
  if (parseInt(storeRows[0].c) === 0) {
    await query(`INSERT INTO stores (name) VALUES ($1),($2),($3)`, [
      'Фотосмайл- Взлетная',
      'Фотосмайл2- Демократический',
      'Фотопечать- Свердлова',
    ]);
    console.log('✅ Магазины созданы');
  }

  // Seed users if empty
  const { rows: userRows } = await query('SELECT COUNT(*) as c FROM users');
  if (parseInt(userRows[0].c) === 0) {
    const { rows: stores } = await query('SELECT * FROM stores ORDER BY id');
    const s = stores;
    await query(
      `INSERT INTO users (username, password_hash, display_name, role, store_id) VALUES
        ($1,$2,$3,$4,$5),($6,$7,$8,$9,$10),($11,$12,$13,$14,$15),($16,$17,$18,$19,$20)`,
      [
        'vzletnaya', bcrypt.hashSync('photo123', 10), 'Сотрудник Взлётная', 'employee', s[0].id,
        'demokrat',  bcrypt.hashSync('photo123', 10), 'Сотрудник Демократический', 'employee', s[1].id,
        'sverdlova', bcrypt.hashSync('photo123', 10), 'Сотрудник Свердлова', 'employee', s[2].id,
        'admin',     bcrypt.hashSync('admin2026', 10), 'Администратор', 'admin', null,
      ]
    );
    console.log('✅ Пользователи созданы');
  }

  // Add employee_name column if it doesn't exist yet (migration)
  await query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS employee_name TEXT`);
  console.log('✅ База данных готова');
}

module.exports = { query, initDB };
