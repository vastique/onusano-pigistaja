'use strict';

const SUPABASE_URL      = 'https://ydbeigrvlsvmrhouguhm.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_jGOeC0DLdJlzI64FNcSPaQ_bZEyM3UN';
const ADMIN_EMAIL       = 'sanel.mittal@delfi.ee';

const { createClient } = window.supabase;
const db               = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = id => document.getElementById(id);

// ── Gate (login) ──────────────────────────────────────────────────────────────

const gate       = $('gate');
const gateForm   = $('gate-form');
const gateEmail  = $('gate-email');
const gatePw     = $('gate-password');
const gateErr    = $('gate-error');
const dashboard  = $('dashboard');
const dashLogout = $('dash-logout');

async function boot() {
  const { data: { session } } = await db.auth.getSession();
  if (session?.user) {
    showDashboard(session.user);
  } else {
    gate.classList.remove('hidden');
  }
}

gateForm.addEventListener('submit', async e => {
  e.preventDefault();
  gateErr.textContent = '';
  const { error, data } = await db.auth.signInWithPassword({
    email: gateEmail.value.trim(),
    password: gatePw.value,
  });
  if (error) {
    gateErr.textContent = error.message;
    return;
  }
  gate.classList.add('hidden');
  showDashboard(data.user);
});

dashLogout.addEventListener('click', async () => {
  await db.auth.signOut();
  window.location.href = location.href.split('/admin')[0] + '/';
});

const confirmOverlay = $('confirm-overlay');

function openConfirm() {
  $('confirm-step-1').classList.remove('hidden');
  $('confirm-step-2').classList.add('hidden');
  confirmOverlay.classList.remove('hidden');
}

function closeConfirm() {
  confirmOverlay.classList.add('hidden');
}

$('dash-clear').addEventListener('click', openConfirm);

$('confirm-cancel').addEventListener('click', closeConfirm);
$('confirm-back').addEventListener('click', closeConfirm);

confirmOverlay.addEventListener('click', e => {
  if (e.target === confirmOverlay) closeConfirm();
});

$('confirm-next').addEventListener('click', () => {
  $('confirm-step-1').classList.add('hidden');
  $('confirm-step-2').classList.remove('hidden');
});

$('confirm-ok').addEventListener('click', async () => {
  closeConfirm();
  const { error } = await db.from('compression_runs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (error) { alert('Viga: ' + error.message); return; }
  refreshDashboard();
});

// ── Dashboard ─────────────────────────────────────────────────────────────────

let dauChart   = null;
let sizesChart = null;

async function refreshDashboard() {
  const { data: runs } = await db.from('compression_runs').select('*').order('created_at', { ascending: true });
  if (!runs) return;
  await renderStats(runs);
  renderCotm(runs);
  renderDauChart(runs);
  renderSizesChart(runs);
  await renderUserTable(runs);
}

const burgerBtn  = $('burger-btn');
const burgerMenu = $('burger-menu');

burgerBtn.addEventListener('click', e => {
  e.stopPropagation();
  burgerMenu.classList.toggle('hidden');
});

document.addEventListener('click', e => {
  if (!burgerMenu.classList.contains('hidden') &&
      !burgerMenu.contains(e.target) && e.target !== burgerBtn) {
    burgerMenu.classList.add('hidden');
  }
});

$('burger-clear').addEventListener('click', () => {
  burgerMenu.classList.add('hidden');
  openConfirm();
});

$('burger-logout').addEventListener('click', async () => {
  await db.auth.signOut();
  window.location.href = location.href.split('/admin')[0] + '/';
});

function showDashboard(user) {
  dashboard.classList.remove('hidden');
  if (user?.email === ADMIN_EMAIL) {
    $('dash-clear').style.display = 'inline-flex';
    $('burger-clear').classList.remove('hidden');
  }
  refreshDashboard();

  db.channel('compression_runs_live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'compression_runs' }, () => {
      refreshDashboard();
    })
    .subscribe();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtBytesHTML(bytes) {
  const u = s => `<span class="card-unit">${s}</span>`;
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + u(' GB');
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + u(' MB');
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(0) + u(' KB');
  return bytes + u(' B');
}

function ymd(dateStr) { return dateStr.slice(0, 10); }

function startOfWeek() {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

// ── Stat cards ────────────────────────────────────────────────────────────────

async function renderStats(runs) {
  const { data: userCount } = await db.rpc('count_auth_users');
  $('stat-users').textContent = userCount ?? 0;

  const weekStart = startOfWeek();
  const runsThisWeek = runs.filter(r => new Date(r.created_at) >= weekStart).length;
  $('stat-runs-week').textContent = runsThisWeek;

  const totalIn  = runs.reduce((s, r) => s + (r.total_input_bytes  || 0), 0);
  const totalOut = runs.reduce((s, r) => s + (r.total_output_bytes || 0), 0);
  $('stat-bytes-saved').innerHTML = fmtBytesHTML(totalIn - totalOut);

  const ratio = totalIn > 0 ? ((1 - totalOut / totalIn) * 100).toFixed(0) : 0;
  $('stat-avg-ratio').innerHTML = ratio + '<span class="card-unit">%</span>';
}

// ── Compressor of the month ───────────────────────────────────────────────────

function renderCotm(runs) {
  const now   = new Date();
  const month = now.getMonth();
  const year  = now.getFullYear();

  const thisMonth = runs.filter(r => {
    const d = new Date(r.created_at);
    return d.getMonth() === month && d.getFullYear() === year;
  });

  if (!thisMonth.length) {
    $('cotm-name').textContent = 'Veel pole pigistajaid';
    $('cotm-stat').textContent = '';
    return;
  }

  const counts = {};
  thisMonth.forEach(r => {
    counts[r.email] = (counts[r.email] || 0) + (r.file_count || 0);
  });

  const winner = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  $('cotm-name').textContent = winner[0];
  $('cotm-stat').textContent = `${winner[1]} faili pigistatud sel kuul`;
}

// ── Daily active users chart ──────────────────────────────────────────────────

function renderDauChart(runs) {
  const days   = 30;
  const labels = [];
  const values = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = ymd(d.toISOString());
    labels.push(key.slice(5));

    const activeUsers = new Set(
      runs.filter(r => ymd(r.created_at) === key).map(r => r.user_id)
    ).size;
    values.push(activeUsers);
  }

  if (dauChart) dauChart.destroy();
  dauChart = new Chart($('chart-dau'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor:     'rgb(18,28,87)',
        backgroundColor: 'rgba(18,28,87,.08)',
        borderWidth: 2,
        pointRadius: 3,
        pointHoverRadius: 5,
        fill: true,
        tension: 0.3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: 'rgba(0,0,0,.06)' } },
        x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } },
      },
    },
  });
}

// ── Top banner sizes chart ────────────────────────────────────────────────────

function renderSizesChart(runs) {
  const counts = {};
  runs.forEach(r => {
    (r.banner_sizes || []).forEach(s => { counts[s] = (counts[s] || 0) + 1; });
  });

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const labels = sorted.map(([s]) => s);
  const values = sorted.map(([, n]) => n);

  if (sizesChart) sizesChart.destroy();
  sizesChart = new Chart($('chart-sizes'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: 'rgb(247,117,42)',
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: 'rgba(0,0,0,.06)' } },
        y: { grid: { display: false } },
      },
    },
  });
}

// ── User table ────────────────────────────────────────────────────────────────

async function renderUserTable(runs) {
  const { data: authUsers } = await db.rpc('list_auth_users');

  const users = {};
  (authUsers || []).forEach(u => {
    users[u.email] = { lastActive: u.created_at, runs: 0, files: 0 };
  });

  runs.forEach(r => {
    if (!users[r.email]) users[r.email] = { lastActive: r.created_at, runs: 0, files: 0 };
    const u = users[r.email];
    if (r.created_at > u.lastActive) u.lastActive = r.created_at;
    u.runs  += 1;
    u.files += (r.file_count || 0);
  });

  const rows  = Object.entries(users).sort((a, b) => b[1].files - a[1].files);
  const tbody = $('user-tbody');
  tbody.innerHTML = rows.map(([email, u]) => `
    <tr>
      <td>${email}</td>
      <td>${new Date(u.lastActive).toLocaleDateString('et-EE')}</td>
      <td>${u.runs}</td>
      <td>${u.files}</td>
    </tr>`).join('');
}

// ── Shadow overlay animation ──────────────────────────────────────────────────

(function() {
  const feHue = $('cotm-hue');
  if (!feHue) return;
  let start = null;
  const cycleDuration = 16000;
  function tick(ts) {
    if (!start) start = ts;
    feHue.setAttribute('values', String(((ts - start) / cycleDuration * 360) % 360));
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}());

// ── Start ─────────────────────────────────────────────────────────────────────

boot();
