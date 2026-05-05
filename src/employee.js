import { api } from './api.js';
import { toast, fmt } from './main.js';

export function initEmployee(user) {
  document.getElementById('emp-store-name').textContent = user.store?.name || 'Магазин';
  document.getElementById('emp-user-name').textContent = user.display_name || user.username;

  // Set default date to today
  const dateInput = document.getElementById('report-date');
  dateInput.value = new Date().toISOString().slice(0, 10);

  loadHistory();
  setupForm();
}

function setupForm() {
  document.getElementById('report-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('report-submit');
    btn.disabled = true;
    btn.textContent = 'Отправка...';
    try {
      await api.createReport({
        date: document.getElementById('report-date').value,
        total: parseFloat(document.getElementById('r-total').value) || 0,
        cash: parseFloat(document.getElementById('r-cash').value) || 0,
        card: parseFloat(document.getElementById('r-card').value) || 0,
        transfer: parseFloat(document.getElementById('r-transfer').value) || 0,
        sales_count: parseInt(document.getElementById('r-sales').value) || 0,
        salary: parseFloat(document.getElementById('r-salary').value) || 0,
        purchases: parseFloat(document.getElementById('r-purchases').value) || 0,
        write_off: parseFloat(document.getElementById('r-writeoff').value) || 0,
      });
      toast('Отчёт отправлен!', 'success');
      document.getElementById('report-form').reset();
      document.getElementById('report-date').value = new Date().toISOString().slice(0, 10);
      loadHistory();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Отправить отчёт';
    }
  });
}

async function loadHistory() {
  try {
    const reports = await api.getReports();
    const tbody = document.getElementById('emp-history-body');
    tbody.innerHTML = reports.map(r => `<tr>
      <td>${formatDate(r.date)}</td><td>${fmt(r.total)}</td><td>${fmt(r.cash)}</td>
      <td>${fmt(r.card)}</td><td>${fmt(r.transfer)}</td><td>${r.sales_count}</td>
      <td>${fmt(r.salary)}</td><td>${fmt(r.purchases)}</td><td>${fmt(r.write_off)}</td>
    </tr>`).join('');

    // Calculate monthly stats
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const monthReports = reports.filter(r => r.date >= monthStart);
    const totalRevenue = monthReports.reduce((s, r) => s + r.total, 0);
    const totalSales = monthReports.reduce((s, r) => s + r.sales_count, 0);
    const daysCount = monthReports.length || 1;

    document.getElementById('stat-month-total').textContent = fmt(totalRevenue) + ' ₽';
    document.getElementById('stat-month-avg').textContent = fmt(totalRevenue / daysCount) + ' ₽';
    document.getElementById('stat-month-sales').textContent = totalSales;
  } catch (err) {
    toast('Ошибка загрузки данных', 'error');
  }
}

function formatDate(d) {
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y}`;
}
