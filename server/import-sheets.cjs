/**
 * Импорт исторических данных из Google Таблиц в PostgreSQL
 * Запуск: $env:DATABASE_URL="postgresql://..." ; node server/import-sheets.cjs
 */
const { Pool } = require('pg');
const https = require('https');
const bcrypt = require('bcryptjs');

// ─── Настройки ────────────────────────────────────────────────────────────────
const SHEET_PUB_ID = '2PACX-1vQJqF8osJ-XnFcQNcpDPIjrUfEKsSLdN5BT9mtMFFlacjG2TZobmNnxTSNPh4PPCu_hUEs1yebcGEBD';
const BASE = `https://docs.google.com/spreadsheets/d/e/${SHEET_PUB_ID}`;

const STORE_MAP = {
  'Взлетная': 'Фотосмайл- Взлетная',
  'Демократический': 'Фотосмайл2- Демократический',
  'Свердлова': 'Фотопечать- Свердлова',
};

// ─── Утилиты ──────────────────────────────────────────────────────────────────
function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Accept-Language': 'ru' } }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

function parseCSVLine(line) {
  const cols = []; let inQ = false; let cur = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  cols.push(cur.trim());
  return cols;
}

function parseCSV(text) {
  return text.split(/\r?\n/).map(l => parseCSVLine(l));
}

function toNum(s) {
  if (!s || s === '#DIV/0!') return 0;
  const n = parseFloat(s.replace(/,/g, '.').replace(/\s/g, ''));
  return isNaN(n) ? 0 : n;
}

function toDate(s) {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2})\.(\d{2})\.(\d{2,4})$/);
  if (!m) return null;
  let [, d, mo, y] = m;
  if (y.length === 2) y = '20' + y;
  return `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
}

function isDate(s) { return /^\d{1,2}\.\d{2}\.\d{2,4}$/.test(s?.trim() || ''); }

function getStore(col0) {
  for (const [k, v] of Object.entries(STORE_MAP))
    if ((col0 || '').includes(k)) return v;
  return null;
}

// ─── Получить список листов ───────────────────────────────────────────────────
async function getSheets() {
  const html = await fetchText(`${BASE}/pubhtml`);
  const sheets = [];
  // Match: {name: "Март 2024", ..., gid: "0"
  const re = /name:\s*"([^"]+)"[^}]+gid:\s*"(\d+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) sheets.push({ name: m[1], gid: m[2] });
  // Fallback: try sheet-button pattern
  if (sheets.length === 0) {
    const re2 = /switchToSheet\('(\d+)'\).*?>([^<]+)</g;
    while ((m = re2.exec(html)) !== null) sheets.push({ gid: m[1], name: m[2].trim() });
  }
  return sheets;
}

// ─── Парсинг листа ────────────────────────────────────────────────────────────
function parseSheet(csvText) {
  const rows = parseCSV(csvText);
  const records = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row[2]?.trim() !== 'Выручка за день') continue;
    const storeName = getStore(row[0]);
    if (!storeName) continue;

    // Найти строку дат (сканируем вверх)
    let dateIdx = -1;
    for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
      if (isDate(rows[j]?.[3])) { dateIdx = j; break; }
    }
    if (dateIdx < 0) continue;

    const empIdx = dateIdx - 1;
    const dateRow = rows[dateIdx];
    const empRow = empIdx >= 0 ? rows[empIdx] : [];

    // Собрать строки метрик по метке в col[2]
    const M = {};
    for (let j = i; j < Math.min(rows.length, i + 12); j++) {
      const lbl = rows[j][2]?.trim();
      if (lbl && !M[lbl]) M[lbl] = rows[j];
    }

    // Каждый день — отдельная колонка начиная с col[3]
    for (let col = 3; col < dateRow.length; col++) {
      const date = toDate(dateRow[col]);
      if (!date) continue;
      const total = toNum(M['Выручка за день']?.[col]);
      const cash  = toNum(M['Наличные']?.[col]);
      const card  = toNum(M['Терминал']?.[col]);
      const trans = toNum(M['Переводы']?.[col]);
      if (total === 0 && cash === 0 && card === 0 && trans === 0) continue;

      records.push({
        store_name: storeName,
        date,
        employee_name: empRow[col]?.trim() || null,
        total,
        cash,
        card,
        transfer: trans,
        sales_count: parseInt(M['Количество продаж']?.[col]) || 0,
        salary:     toNum(M['Зарплата за день']?.[col]),
        purchases:  toNum(M['Расходы текущие (закупки)']?.[col]),
        write_off:  toNum(M['Списание и брак']?.[col]),
      });
    }
  }
  return records;
}

// ─── Загрузка в БД ────────────────────────────────────────────────────────────
async function importRecords(pool, storeMap, sysUserId, records) {
  let ok = 0, skip = 0;
  for (const r of records) {
    const storeId = storeMap[r.store_name];
    if (!storeId) { skip++; continue; }
    try {
      await pool.query(`
        INSERT INTO reports
          (store_id,user_id,date,total,cash,card,transfer,sales_count,salary,purchases,write_off,employee_name)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (store_id, date) DO UPDATE SET
          total=EXCLUDED.total, cash=EXCLUDED.cash, card=EXCLUDED.card,
          transfer=EXCLUDED.transfer, sales_count=EXCLUDED.sales_count,
          salary=EXCLUDED.salary, purchases=EXCLUDED.purchases,
          write_off=EXCLUDED.write_off, employee_name=EXCLUDED.employee_name
      `, [storeId, sysUserId, r.date, r.total, r.cash, r.card, r.transfer,
          r.sales_count, r.salary, r.purchases, r.write_off, r.employee_name]);
      ok++;
    } catch (e) { console.warn(`  ⚠️  ${r.date} ${r.store_name}: ${e.message}`); skip++; }
  }
  return { ok, skip };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 Импорт данных из Google Sheets\n');

  if (!process.env.DATABASE_URL) {
    console.error('❌ Не задана переменная DATABASE_URL\n');
    console.error('Запустите так (PowerShell):');
    console.error('  $env:DATABASE_URL="postgresql://user:pass@host/db?sslmode=require"');
    console.error('  node server/import-sheets.cjs\n');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  // Добавить колонку если нет
  await pool.query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS employee_name TEXT`);

  // Карта магазинов
  const { rows: stores } = await pool.query('SELECT id, name FROM stores');
  const storeMap = {};
  stores.forEach(s => storeMap[s.name] = s.id);
  console.log('🏪 Магазины в БД:', Object.keys(storeMap).join(', '), '\n');

  // Системный пользователь для импорта
  let { rows: su } = await pool.query("SELECT id FROM users WHERE username='import_system'");
  let sysUserId;
  if (su.length === 0) {
    const { rows } = await pool.query(
      "INSERT INTO users (username,password_hash,display_name,role) VALUES ('import_system',$1,'Импорт данных','employee') RETURNING id",
      [bcrypt.hashSync('import_' + Date.now(), 10)]
    );
    sysUserId = rows[0].id;
  } else { sysUserId = su[0].id; }

  // Список листов
  console.log('📋 Получаю список листов...');
  const sheets = await getSheets();
  if (sheets.length === 0) {
    console.error('❌ Листы не найдены. Убедитесь что таблица опубликована.');
    process.exit(1);
  }
  console.log(`   Найдено: ${sheets.length} листов`);
  sheets.forEach(s => console.log(`   - ${s.name} (gid=${s.gid})`));
  console.log();

  let totalOk = 0, totalSkip = 0;

  for (const sheet of sheets) {
    process.stdout.write(`📅 ${sheet.name}... `);
    try {
      const csv = await fetchText(`${BASE}/pub?gid=${sheet.gid}&single=true&output=csv`);
      const records = parseSheet(csv);
      process.stdout.write(`${records.length} записей → `);
      if (records.length > 0) {
        const { ok, skip } = await importRecords(pool, storeMap, sysUserId, records);
        console.log(`✅ загружено: ${ok}, пропущено: ${skip}`);
        totalOk += ok; totalSkip += skip;
      } else { console.log('нет данных'); }
    } catch (e) { console.log(`❌ ${e.message}`); }
    await new Promise(r => setTimeout(r, 600)); // пауза между запросами
  }

  console.log(`\n✅ ИМПОРТ ЗАВЕРШЁН`);
  console.log(`   Загружено: ${totalOk} записей`);
  console.log(`   Пропущено: ${totalSkip}`);
  await pool.end();
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
