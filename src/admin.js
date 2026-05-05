import { api } from './api.js';
import { toast, fmt } from './main.js';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

let revenueChart = null, salesChart = null, cmpRevenueChart = null, cmpSalesChart = null;
let stores = [];

export async function initAdmin(user) {
  document.getElementById('adm-user-name').textContent = user.display_name || user.username;
  stores = await api.getStores();

  // Populate store selects
  populateStoreSelects();
  setupTabs();
  setupFilters();
  setupManagement();
  setupModals();

  // Set default date range (last 30 days)
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  document.getElementById('f-from').value = from;
  document.getElementById('f-to').value = today;

  loadReports();
  loadCharts();
  loadComparison();
  loadUsers();
  loadStores();
}

function populateStoreSelects() {
  ['f-store', 'ch-store'].forEach(id => {
    const sel = document.getElementById(id);
    const current = sel.value;
    sel.innerHTML = '<option value="">Все магазины</option>';
    stores.forEach(s => sel.innerHTML += `<option value="${s.id}">${s.name}</option>`);
    sel.value = current;
  });
  ['nu-store', 'um-store'].forEach(id => {
    const sel = document.getElementById(id);
    sel.innerHTML = '<option value="">— Нет —</option>';
    stores.forEach(s => sel.innerHTML += `<option value="${s.id}">${s.name}</option>`);
  });
}

/* ── Tabs ──────────────────────────────── */
function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab).classList.add('active');
    });
  });
}

/* ── Reports Tab ──────────────────────── */
function setupFilters() {
  document.getElementById('f-apply').onclick = loadReports;
  document.getElementById('ch-apply').onclick = loadCharts;
  document.getElementById('cmp-apply').onclick = loadComparison;
  document.getElementById('f-export-excel').onclick = exportExcel;
  document.getElementById('f-export-pdf').onclick = exportPDF;
}

async function loadReports() {
  try {
    const params = {
      store_id: document.getElementById('f-store').value,
      from: document.getElementById('f-from').value,
      to: document.getElementById('f-to').value,
    };
    const reports = await api.getReports(params);
    const tbody = document.getElementById('adm-reports-body');
    tbody.innerHTML = reports.map(r => `<tr data-id="${r.id}">
      <td>${fmtDate(r.date)}</td><td>${r.store_name}</td>
      <td>${fmt(r.total)}</td><td>${fmt(r.cash)}</td><td>${fmt(r.card)}</td>
      <td>${fmt(r.transfer)}</td><td>${r.sales_count}</td><td>${fmt(r.salary)}</td>
      <td>${fmt(r.purchases)}</td><td>${fmt(r.write_off)}</td>
      <td class="actions-cell">
        <button class="btn btn-sm btn-ghost edit-report-btn">✏️</button>
        <button class="btn btn-sm btn-danger del-report-btn">🗑️</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="11" style="text-align:center;padding:32px;color:var(--text-dim)">Нет данных</td></tr>';

    // Summary
    const totals = reports.reduce((a, r) => ({
      total: a.total + r.total, cash: a.cash + r.cash, card: a.card + r.card,
      transfer: a.transfer + r.transfer, sales: a.sales + r.sales_count,
      salary: a.salary + r.salary, purchases: a.purchases + r.purchases, write_off: a.write_off + r.write_off
    }), { total: 0, cash: 0, card: 0, transfer: 0, sales: 0, salary: 0, purchases: 0, write_off: 0 });

    document.getElementById('adm-summary').innerHTML = `
      <div class="summary-item">Итого: <strong>${fmt(totals.total)} ₽</strong></div>
      <div class="summary-item">Наличные: <strong>${fmt(totals.cash)} ₽</strong></div>
      <div class="summary-item">Безнал: <strong>${fmt(totals.card)} ₽</strong></div>
      <div class="summary-item">Перевод: <strong>${fmt(totals.transfer)} ₽</strong></div>
      <div class="summary-item">Продаж: <strong>${totals.sales}</strong></div>
      <div class="summary-item">ЗП: <strong>${fmt(totals.salary)} ₽</strong></div>
      <div class="summary-item">Закупки: <strong>${fmt(totals.purchases)} ₽</strong></div>
      <div class="summary-item">Списание: <strong>${fmt(totals.write_off)} ₽</strong></div>`;

    // Attach edit/delete handlers
    tbody.querySelectorAll('.edit-report-btn').forEach(btn => {
      btn.onclick = () => openEditModal(reports.find(r => r.id == btn.closest('tr').dataset.id));
    });
    tbody.querySelectorAll('.del-report-btn').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Удалить отчёт?')) return;
        await api.deleteReport(btn.closest('tr').dataset.id);
        toast('Отчёт удалён', 'info');
        loadReports();
      };
    });
  } catch (err) { toast('Ошибка загрузки отчётов: ' + err.message, 'error'); }
}

/* ── Charts Tab ───────────────────────── */
async function loadCharts() {
  const days = parseInt(document.getElementById('ch-period').value);
  const storeId = document.getElementById('ch-store').value;
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);

  const reports = await api.getReports({ store_id: storeId, from, to });

  // Group by date
  const byDate = {};
  reports.forEach(r => {
    if (!byDate[r.date]) byDate[r.date] = { total: 0, sales: 0 };
    byDate[r.date].total += r.total;
    byDate[r.date].sales += r.sales_count;
  });

  const labels = Object.keys(byDate).sort();
  const totals = labels.map(d => byDate[d].total);
  const sales = labels.map(d => byDate[d].sales);
  const fmtLabels = labels.map(d => fmtDate(d));

  const chartOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#94a3b8', font: { family: 'Inter' } } } },
    scales: {
      x: { ticks: { color: '#64748b', font: { family: 'Inter', size: 11 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
      y: { ticks: { color: '#64748b', font: { family: 'Inter', size: 11 } }, grid: { color: 'rgba(255,255,255,0.06)' } }
    }
  };

  if (revenueChart) revenueChart.destroy();
  revenueChart = new Chart(document.getElementById('chart-revenue'), {
    type: 'line',
    data: {
      labels: fmtLabels,
      datasets: [{ label: 'Выручка (₽)', data: totals, borderColor: '#a855f7', backgroundColor: 'rgba(168,85,247,0.1)', fill: true, tension: 0.4, pointRadius: 3, pointBackgroundColor: '#a855f7' }]
    },
    options: { ...chartOpts, plugins: { ...chartOpts.plugins, title: { display: true, text: 'Выручка по дням', color: '#e2e8f0', font: { family: 'Inter', size: 16, weight: 600 } } } }
  });

  if (salesChart) salesChart.destroy();
  salesChart = new Chart(document.getElementById('chart-sales'), {
    type: 'bar',
    data: {
      labels: fmtLabels,
      datasets: [{ label: 'Количество продаж', data: sales, backgroundColor: 'rgba(6,182,212,0.6)', borderColor: '#06b6d4', borderWidth: 1, borderRadius: 4 }]
    },
    options: { ...chartOpts, plugins: { ...chartOpts.plugins, title: { display: true, text: 'Продажи по дням', color: '#e2e8f0', font: { family: 'Inter', size: 16, weight: 600 } } } }
  });
}

/* ── Compare Tab ──────────────────────── */
async function loadComparison() {
  const days = parseInt(document.getElementById('cmp-period').value);
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const reports = await api.getReports({ from, to: new Date().toISOString().slice(0, 10) });

  const byStore = {};
  stores.forEach(s => byStore[s.id] = { name: s.name, total: 0, sales: 0 });
  reports.forEach(r => {
    if (byStore[r.store_id]) {
      byStore[r.store_id].total += r.total;
      byStore[r.store_id].sales += r.sales_count;
    }
  });

  const labels = Object.values(byStore).map(s => s.name);
  const totals = Object.values(byStore).map(s => s.total);
  const sales = Object.values(byStore).map(s => s.sales);
  const colors = ['rgba(139,92,246,0.7)', 'rgba(6,182,212,0.7)', 'rgba(16,185,129,0.7)', 'rgba(245,158,11,0.7)', 'rgba(239,68,68,0.7)'];
  const borders = ['#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444'];

  const opts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#94a3b8', font: { family: 'Inter', size: 11 } }, grid: { display: false } },
      y: { ticks: { color: '#64748b', font: { family: 'Inter', size: 11 } }, grid: { color: 'rgba(255,255,255,0.06)' } }
    }
  };

  if (cmpRevenueChart) cmpRevenueChart.destroy();
  cmpRevenueChart = new Chart(document.getElementById('chart-compare-revenue'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Выручка', data: totals, backgroundColor: colors, borderColor: borders, borderWidth: 1, borderRadius: 6 }] },
    options: { ...opts, plugins: { ...opts.plugins, title: { display: true, text: `Выручка за ${days} дней`, color: '#e2e8f0', font: { family: 'Inter', size: 16, weight: 600 } } } }
  });

  if (cmpSalesChart) cmpSalesChart.destroy();
  cmpSalesChart = new Chart(document.getElementById('chart-compare-sales'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Продажи', data: sales, backgroundColor: colors.map(c => c.replace('0.7', '0.5')), borderColor: borders, borderWidth: 1, borderRadius: 6 }] },
    options: { ...opts, plugins: { ...opts.plugins, title: { display: true, text: `Продажи за ${days} дней`, color: '#e2e8f0', font: { family: 'Inter', size: 16, weight: 600 } } } }
  });
}

/* ── Management Tab ───────────────────── */
function setupManagement() {
  document.getElementById('add-user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.createUser({
        username: document.getElementById('nu-username').value.trim(),
        password: document.getElementById('nu-password').value,
        display_name: document.getElementById('nu-name').value.trim(),
        role: document.getElementById('nu-role').value,
        store_id: document.getElementById('nu-store').value || null,
      });
      toast('Пользователь создан', 'success');
      e.target.reset();
      loadUsers();
    } catch (err) { toast(err.message, 'error'); }
  });

  document.getElementById('add-store-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.createStore(document.getElementById('ns-name').value.trim());
      toast('Магазин добавлен', 'success');
      e.target.reset();
      stores = await api.getStores();
      populateStoreSelects();
      loadStores();
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function loadUsers() {
  const users = await api.getUsers();
  const tbody = document.getElementById('manage-users-body');
  tbody.innerHTML = users.map(u => `<tr data-id="${u.id}">
    <td>${u.username}</td><td>${u.display_name || '—'}</td>
    <td><span class="user-badge" style="font-size:11px">${u.role === 'admin' ? 'Админ' : 'Сотрудник'}</span></td>
    <td>${u.store_name || '—'}</td>
    <td class="actions-cell">
      <button class="btn btn-sm btn-ghost edit-user-btn">✏️</button>
      <button class="btn btn-sm btn-danger del-user-btn">🗑️</button>
    </td>
  </tr>`).join('');

  tbody.querySelectorAll('.edit-user-btn').forEach(btn => {
    btn.onclick = () => openUserModal(users.find(u => u.id == btn.closest('tr').dataset.id));
  });
  tbody.querySelectorAll('.del-user-btn').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Удалить пользователя?')) return;
      await api.deleteUser(btn.closest('tr').dataset.id);
      toast('Пользователь удалён', 'info');
      loadUsers();
    };
  });
}

async function loadStores() {
  const storesList = await api.getStores();
  const tbody = document.getElementById('manage-stores-body');
  tbody.innerHTML = storesList.map(s => `<tr data-id="${s.id}">
    <td>${s.name}</td>
    <td class="actions-cell">
      <button class="btn btn-sm btn-ghost edit-store-btn">✏️</button>
    </td>
  </tr>`).join('');

  tbody.querySelectorAll('.edit-store-btn').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.closest('tr').dataset.id;
      const s = storesList.find(x => x.id == id);
      const name = prompt('Новое название:', s.name);
      if (name && name !== s.name) {
        await api.updateStore(id, name);
        stores = await api.getStores();
        populateStoreSelects();
        loadStores();
        toast('Магазин обновлён', 'success');
      }
    };
  });
}

/* ── Modals ────────────────────────────── */
function setupModals() {
  // Edit report modal
  document.getElementById('modal-cancel').onclick = () => document.getElementById('modal-overlay').classList.remove('open');
  document.getElementById('modal-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('modal-id').value;
    await api.updateReport(id, {
      total: parseFloat(document.getElementById('m-total').value) || 0,
      cash: parseFloat(document.getElementById('m-cash').value) || 0,
      card: parseFloat(document.getElementById('m-card').value) || 0,
      transfer: parseFloat(document.getElementById('m-transfer').value) || 0,
      sales_count: parseInt(document.getElementById('m-sales').value) || 0,
      salary: parseFloat(document.getElementById('m-salary').value) || 0,
      purchases: parseFloat(document.getElementById('m-purchases').value) || 0,
      write_off: parseFloat(document.getElementById('m-writeoff').value) || 0,
    });
    document.getElementById('modal-overlay').classList.remove('open');
    toast('Отчёт обновлён', 'success');
    loadReports();
  });

  // Edit user modal
  document.getElementById('user-modal-cancel').onclick = () => document.getElementById('user-modal-overlay').classList.remove('open');
  document.getElementById('user-modal-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('um-id').value;
    await api.updateUser(id, {
      username: document.getElementById('um-username').value.trim(),
      password: document.getElementById('um-password').value || undefined,
      display_name: document.getElementById('um-name').value.trim(),
      role: document.getElementById('um-role').value,
      store_id: document.getElementById('um-store').value || null,
    });
    document.getElementById('user-modal-overlay').classList.remove('open');
    toast('Пользователь обновлён', 'success');
    loadUsers();
  });
}

function openEditModal(r) {
  document.getElementById('modal-id').value = r.id;
  document.getElementById('m-total').value = r.total;
  document.getElementById('m-cash').value = r.cash;
  document.getElementById('m-card').value = r.card;
  document.getElementById('m-transfer').value = r.transfer;
  document.getElementById('m-sales').value = r.sales_count;
  document.getElementById('m-salary').value = r.salary;
  document.getElementById('m-purchases').value = r.purchases;
  document.getElementById('m-writeoff').value = r.write_off;
  document.getElementById('modal-title').textContent = `Редактировать: ${fmtDate(r.date)} — ${r.store_name}`;
  document.getElementById('modal-overlay').classList.add('open');
}

function openUserModal(u) {
  document.getElementById('um-id').value = u.id;
  document.getElementById('um-username').value = u.username;
  document.getElementById('um-password').value = '';
  document.getElementById('um-name').value = u.display_name || '';
  document.getElementById('um-role').value = u.role;
  document.getElementById('um-store').value = u.store_id || '';
  document.getElementById('user-modal-overlay').classList.add('open');
}

/* ── Export ────────────────────────────── */
async function exportExcel() {
  const XLSX = await import('xlsx');
  const params = {
    store_id: document.getElementById('f-store').value,
    from: document.getElementById('f-from').value,
    to: document.getElementById('f-to').value,
  };
  const reports = await api.getReports(params);
  const data = reports.map(r => ({
    'Дата': fmtDate(r.date), 'Магазин': r.store_name, 'Итого': r.total,
    'Наличные': r.cash, 'Безнал': r.card, 'Перевод': r.transfer,
    'Продажи': r.sales_count, 'Зарплата': r.salary, 'Закупки': r.purchases, 'Списание': r.write_off
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Отчёты');
  XLSX.writeFile(wb, `Отчёты_${params.from || 'all'}_${params.to || 'all'}.xlsx`);
  toast('Excel файл скачан', 'success');
}

async function exportPDF() {
  const { default: jsPDF } = await import('jspdf');
  await import('jspdf-autotable');

  const params = {
    store_id: document.getElementById('f-store').value,
    from: document.getElementById('f-from').value,
    to: document.getElementById('f-to').value,
  };
  const reports = await api.getReports(params);
  const doc = new jsPDF({ orientation: 'landscape' });

  doc.setFontSize(16);
  doc.text('Отчёты ФотоЦентр', 14, 20);
  doc.setFontSize(10);
  doc.text(`Период: ${params.from || '—'} — ${params.to || '—'}`, 14, 28);

  doc.autoTable({
    startY: 35,
    head: [['Дата', 'Магазин', 'Итого', 'Нал', 'Безнал', 'Перевод', 'Продажи', 'ЗП', 'Закупки', 'Списание']],
    body: reports.map(r => [fmtDate(r.date), r.store_name, r.total, r.cash, r.card, r.transfer, r.sales_count, r.salary, r.purchases, r.write_off]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [124, 58, 237] },
  });

  doc.save(`Отчёты_${params.from || 'all'}_${params.to || 'all'}.pdf`);
  toast('PDF файл скачан', 'success');
}

/* ── Helpers ───────────────────────────── */
function fmtDate(d) {
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y}`;
}
