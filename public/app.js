// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  currentScreen: 'weather',
  previousScreen: 'weather',
};

// ── Utility ───────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

let _toastTimer = null;
function showToast(msg) {
  let el = $('app-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('visible'), 3500);
}

const SESSION_KEY = 'autopmf_session_id';
function getSessionId() {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(SESSION_KEY, id); }
  return id;
}

// ── Elements ──────────────────────────────────────────────────────────────────
const weatherScreen  = $('weather-screen');
const feedbackScreen = $('feedback-screen');
const statsScreen    = $('stats-screen');
const progressScreen = $('progress-screen');
const drawer         = $('drawer');
const drawerBackdrop = $('drawer-backdrop');
const settingsModal  = $('settings-modal');

// ── Screen switching ──────────────────────────────────────────────────────────
function showScreen(name) {
  if (name === 'feedback') state.previousScreen = state.currentScreen;
  state.currentScreen = name;
  weatherScreen.classList.toggle('active',  name === 'weather');
  feedbackScreen.classList.toggle('active', name === 'feedback');
  statsScreen.classList.toggle('active',    name === 'stats');
  progressScreen.classList.toggle('active', name === 'progress');
  $('feedback-fab').style.display = (name === 'feedback' || name === 'stats' || name === 'progress') ? 'none' : '';
  $('refresh-btn').style.display = name === 'weather' ? '' : 'none';
  if (name === 'stats')    loadStats();
  if (name === 'progress') loadProgress();
  closeDrawer();
}

// ── Drawer ────────────────────────────────────────────────────────────────────
function openDrawer()  { drawer.classList.add('open'); drawerBackdrop.classList.add('visible'); }
function closeDrawer() { drawer.classList.remove('open'); drawerBackdrop.classList.remove('visible'); }
$('menu-btn').addEventListener('click', openDrawer);
drawerBackdrop.addEventListener('click', closeDrawer);

// ── Refresh button → reload weather ──────────────────────────────────────────
$('refresh-btn').addEventListener('click', () => {
  const btn = $('refresh-btn');
  const svg = btn.querySelector('svg');
  if (typeof WX !== 'undefined' && WX.busy) {
    btn.classList.add('wx-refresh-busy');
    setTimeout(() => btn.classList.remove('wx-refresh-busy'), 400);
    return;
  }
  btn.classList.add('wx-refreshing');
  svg.classList.add('spinning');
  if (typeof WX !== 'undefined') {
    WX.loadAll().finally(() => { svg.classList.remove('spinning'); btn.classList.remove('wx-refreshing'); });
  } else {
    setTimeout(() => { svg.classList.remove('spinning'); btn.classList.remove('wx-refreshing'); }, 700);
  }
});

// ── Feedback ──────────────────────────────────────────────────────────────────
function goToFeedback() { closeDrawer(); showScreen('feedback'); }
$('end-btn')?.addEventListener('click', goToFeedback);
$('feedback-fab')?.addEventListener('click', goToFeedback);
$('feedback-back')?.addEventListener('click', () => showScreen(state.previousScreen || 'weather'));

const gradeEl    = $('grade');
const gradeValEl = $('grade-val');
gradeEl?.addEventListener('input', () => { gradeValEl.textContent = gradeEl.value; });

const submitFbBtn = $('submit-feedback');
const feedbackMsg = $('feedback-msg');
submitFbBtn?.addEventListener('click', async () => {
  submitFbBtn.disabled = true;
  feedbackMsg.className = 'feedback-msg';
  try {
    const r = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grade: Number(gradeEl.value),
        comments: $('comments').value,
        page: state.previousScreen || 'weather',
        sessionId: getSessionId(),
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed');
    feedbackMsg.textContent = 'Thanks! Your feedback was saved. ✓';
    feedbackMsg.className = 'feedback-msg show success';
    $('comments').value = '';
    gradeEl.value = 7;
    gradeValEl.textContent = '7';
    setTimeout(() => showScreen(state.previousScreen || 'weather'), 1200);
  } catch (err) {
    feedbackMsg.textContent = 'Could not save feedback: ' + err.message;
    feedbackMsg.className = 'feedback-msg show error';
    submitFbBtn.disabled = false;
  }
});

// ── Stats Screen ──────────────────────────────────────────────────────────────
$('drawer-stats-btn').addEventListener('click', () => { closeDrawer(); showScreen('stats'); });
$('stats-back').addEventListener('click', () => showScreen('weather'));

let statsCache = null;
async function loadStats() {
  const loading = $('stats-loading'), content = $('stats-content'), empty = $('stats-empty');
  loading.style.display = ''; content.style.display = 'none'; empty.style.display = 'none';
  try {
    const r = await fetch('/api/feedback/public-stats');
    const d = await r.json();
    statsCache = d;
    if (!d.total) { loading.style.display = 'none'; empty.style.display = ''; return; }
    $('stat-total').textContent = d.total;
    $('stat-nps').textContent = d.averageNps;
    $('stat-users').textContent = d.uniqueSessions;
    $('stat-latest').textContent = d.latestEntry
      ? new Date(d.latestEntry).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
    const detractors = (d.npsDistribution['0-3'] || 0) + (d.npsDistribution['4-6'] || 0);
    const passives   = d.npsDistribution['7-8']  || 0;
    const promoters  = d.npsDistribution['9-10'] || 0;
    const max = Math.max(detractors, passives, promoters, 1);
    $('nps-bar-detractor').style.width = (detractors / max * 100) + '%';
    $('nps-bar-passive').style.width   = (passives   / max * 100) + '%';
    $('nps-bar-promoter').style.width  = (promoters  / max * 100) + '%';
    $('nps-count-detractor').textContent = detractors;
    $('nps-count-passive').textContent   = passives;
    $('nps-count-promoter').textContent  = promoters;
    loading.style.display = 'none'; content.style.display = '';
  } catch {
    loading.style.display = 'none'; empty.style.display = '';
  }
}

// ── Progress Screen ───────────────────────────────────────────────────────────
$('drawer-progress-btn').addEventListener('click', () => { closeDrawer(); showScreen('progress'); });
$('progress-back').addEventListener('click', () => showScreen('weather'));

async function loadProgress() {
  const loading = $('progress-loading'), content = $('progress-content'), empty = $('progress-empty');
  loading.style.display = ''; content.style.display = 'none'; empty.style.display = 'none';
  try {
    const data = statsCache || await fetch('/api/feedback/public-stats').then(r => r.json());
    if (!data.grades || data.grades.length === 0) { loading.style.display = 'none'; empty.style.display = ''; return; }
    loading.style.display = 'none'; content.style.display = '';
    drawNpsChart(data.grades);
    const latest = data.grades[data.grades.length - 1];
    $('progress-summary').innerHTML =
      `<strong>${data.grades.length}</strong> feedback response${data.grades.length > 1 ? 's' : ''}. ` +
      `Latest score: <strong>${latest}</strong>. Average: <strong>${data.averageNps}</strong>.`;
  } catch {
    loading.style.display = 'none'; empty.style.display = '';
  }
}

function drawNpsChart(grades) {
  const canvas = $('nps-chart');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.parentElement.clientWidth - 24;
  const h = Math.round(w * 0.55);
  canvas.width = w * dpr; canvas.height = h * dpr;
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  ctx.scale(dpr, dpr);
  const isDark = document.querySelector('.app').classList.contains('dark-mode');
  const pad = { top: 20, right: 16, bottom: 36, left: 36 };
  const cw = w - pad.left - pad.right, ch = h - pad.top - pad.bottom;
  ctx.strokeStyle = isDark ? '#333' : '#e5e5ea'; ctx.lineWidth = 0.5;
  ctx.font = '10px -apple-system, system-ui, sans-serif';
  ctx.fillStyle = '#8e8e93'; ctx.textAlign = 'right';
  for (let i = 0; i <= 10; i += 2) {
    const y = pad.top + ch - (i / 10) * ch;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
    ctx.fillText(String(i), pad.left - 6, y + 3);
  }
  const n = grades.length;
  ctx.textAlign = 'center';
  const step = Math.max(1, Math.floor(n / Math.min(n, 10)));
  for (let i = 0; i < n; i += step) {
    ctx.fillText('#' + (i + 1), pad.left + (i / Math.max(n - 1, 1)) * cw, h - 8);
  }
  if (n > 1 && (n - 1) % step !== 0) ctx.fillText('#' + n, pad.left + cw, h - 8);
  const pts = grades.map((g, i) => ({
    x: pad.left + (n === 1 ? cw / 2 : (i / (n - 1)) * cw),
    y: pad.top + ch - (g / 10) * ch,
  }));
  if (n === 1) {
    ctx.fillStyle = '#0062CC';
    ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, 5, 0, Math.PI * 2); ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pad.top + ch);
  pts.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(pts[pts.length - 1].x, pad.top + ch);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + ch);
  grad.addColorStop(0, isDark ? 'rgba(0,98,204,0.3)' : 'rgba(0,98,204,0.15)');
  grad.addColorStop(1, 'rgba(0,98,204,0)');
  ctx.fillStyle = grad; ctx.fill();
  ctx.beginPath();
  pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.strokeStyle = '#0062CC'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.fillStyle = '#0062CC';
  pts.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2); ctx.fill(); });
}

// ── Settings Modal ────────────────────────────────────────────────────────────
function openSettings()  {
  settingsModal.classList.add('open');
  document.body.classList.add('modal-open');
  if (typeof showToast === 'function') showToast('Settings');
}
function closeSettings() {
  settingsModal.classList.remove('open');
  document.body.classList.remove('modal-open');
}
$('settings-btn').addEventListener('click', () => { closeDrawer(); openSettings(); });
const headerSettingsBtn = $('header-settings-btn');
if (headerSettingsBtn) headerSettingsBtn.addEventListener('click', openSettings);
settingsModal.querySelectorAll('[data-close-modal]').forEach(el => el.addEventListener('click', closeSettings));

// ── Dark Mode ─────────────────────────────────────────────────────────────────
const darkToggle = $('dark-mode-toggle');
const appEl = document.querySelector('.app');
function applyDarkMode(on) {
  appEl.classList.toggle('dark-mode', on);
  localStorage.setItem('autopmf_dark', on ? '1' : '0');
  darkToggle.checked = on;
}
applyDarkMode(localStorage.getItem('autopmf_dark') === '1');
darkToggle.addEventListener('change', () => applyDarkMode(darkToggle.checked));

// ── Large Text ────────────────────────────────────────────────────────────────
const largeTextToggle = $('large-text-toggle');
function applyLargeText(on) {
  appEl.classList.toggle('large-text', on);
  localStorage.setItem('autopmf_largetext', on ? '1' : '0');
  largeTextToggle.checked = on;
}
applyLargeText(localStorage.getItem('autopmf_largetext') === '1');
largeTextToggle.addEventListener('change', () => applyLargeText(largeTextToggle.checked));

// ── Purple Theme ──────────────────────────────────────────────────────────────
const purpleToggle = $('purple-theme-toggle');
function applyPurpleTheme(on) {
  appEl.classList.toggle('purple-theme', on);
  localStorage.setItem('autopmf_purple', on ? '1' : '0');
  purpleToggle.checked = on;
}
applyPurpleTheme(localStorage.getItem('autopmf_purple') === '1');
purpleToggle.addEventListener('change', () => applyPurpleTheme(purpleToggle.checked));

// ── About Modal ───────────────────────────────────────────────────────────────
const aboutModal = $('about-modal');
function openAbout()  {
  closeDrawer();
  aboutModal.classList.add('open');
  document.body.classList.add('modal-open');
  aboutModal.scrollTop = 0;
  const sheet = aboutModal.querySelector('.modal-sheet');
  if (sheet) sheet.scrollTop = 0;
  if (typeof showToast === 'function') showToast('About');
}
function closeAbout() {
  aboutModal.classList.remove('open');
  document.body.classList.remove('modal-open');
}
$('about-btn').addEventListener('click', openAbout);
aboutModal.querySelectorAll('[data-close-about]').forEach(el => el.addEventListener('click', closeAbout));

// ── wx-search-btn shortcut ────────────────────────────────────────────────────
$('wx-search-btn').addEventListener('click', () => { if (typeof WX !== 'undefined') WX.switchTab('search'); });
