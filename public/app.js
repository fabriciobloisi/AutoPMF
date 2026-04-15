// ── Utility ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// Session ID: persists per browser so we can detect repeat feedback from the same user
const SESSION_KEY = 'autopmf_session_id';
function getSessionId() {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

// ── Screen navigation ───────────────────────────────────────────────────────
const screens = {
  product: $('product-screen'),
  feedback: $('feedback-screen'),
  stats: $('stats-screen'),
};
let currentScreen = 'product';

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
  currentScreen = name;
}

// ── Feedback FAB ────────────────────────────────────────────────────────────
$('feedback-fab').addEventListener('click', () => showScreen('feedback'));
$('feedback-back-btn').addEventListener('click', () => showScreen('product'));

// ── Stats FAB ───────────────────────────────────────────────────────────────
$('stats-fab').addEventListener('click', () => {
  showScreen('stats');
  loadStats();
});
$('stats-back-btn').addEventListener('click', () => showScreen('product'));

// ── Feedback form ───────────────────────────────────────────────────────────
const slider = $('feedback-slider');
const sliderValue = $('slider-value');
slider.addEventListener('input', () => { sliderValue.textContent = slider.value; });

$('feedback-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = $('feedback-submit');
  const status = $('feedback-status');

  submitBtn.disabled = true;
  status.textContent = 'Submitting...';
  status.className = 'feedback-status';

  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grade: Number(slider.value),
        comments: $('feedback-comments').value.trim() || null,
        sessionId: getSessionId(),
      }),
    });

    if (!res.ok) throw new Error('Server error');

    status.textContent = 'Thank you for your feedback!';
    status.classList.add('success');
    $('feedback-comments').value = '';
    slider.value = 5;
    sliderValue.textContent = '5';
    // Keep submit disabled after success to prevent duplicates
  } catch (err) {
    status.textContent = 'Failed to submit. Please try again.';
    status.classList.add('error');
    submitBtn.disabled = false;
  }
});

// ── Stats ───────────────────────────────────────────────────────────────────
async function loadStats() {
  const body = $('stats-body');
  body.innerHTML = '<p>Loading stats...</p>';

  try {
    const res = await fetch('/api/feedback/public-stats');
    if (!res.ok) throw new Error('Failed to load stats');
    const data = await res.json();

    body.innerHTML = `
      <div class="stat-card">
        <div class="stat-number">${data.total}</div>
        <div class="stat-label">Total responses</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${data.averageNps}</div>
        <div class="stat-label">Average NPS</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${data.uniqueSessions}</div>
        <div class="stat-label">Unique users</div>
      </div>
      <div class="stat-distribution">
        <h3>Score distribution</h3>
        <div class="dist-row"><span class="dist-label">Detractors (0-3)</span><span class="dist-value">${data.npsDistribution?.['0-3'] ?? 0}</span></div>
        <div class="dist-row"><span class="dist-label">Passive (4-6)</span><span class="dist-value">${data.npsDistribution?.['4-6'] ?? 0}</span></div>
        <div class="dist-row"><span class="dist-label">Satisfied (7-8)</span><span class="dist-value">${data.npsDistribution?.['7-8'] ?? 0}</span></div>
        <div class="dist-row"><span class="dist-label">Promoters (9-10)</span><span class="dist-value">${data.npsDistribution?.['9-10'] ?? 0}</span></div>
      </div>
      ${data.grades && data.grades.length > 0 ? `
        <div class="stat-grades">
          <h3>Score timeline</h3>
          <div class="grades-list">${data.grades.map(g => `<span class="grade-dot" style="background:${g >= 9 ? '#34c759' : g >= 7 ? '#007aff' : g >= 4 ? '#ff9500' : '#ff3b30'}">${g}</span>`).join('')}</div>
        </div>
      ` : ''}
    `;
  } catch (err) {
    body.innerHTML = '<p>Failed to load stats.</p>';
  }
}
