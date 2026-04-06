// ── State ────────────────────────────────────────────────────────────────────
const state = {
  newsItems: [],        // all loaded articles
  filteredItems: [],    // after category filter
  currentMode: localStorage.getItem('autopmf_mode') || 'text',
  currentCategory: 'all',
  currentTikTokIndex: 0,
  loading: false,
  preferences: JSON.parse(localStorage.getItem('autopmf_prefs') || '{"topics":[],"region":"Global","count":8}'),
  activeArticle: null,  // article open in detail modal
  currentScreen: 'feed',
  previousScreen: 'feed',
};

// ── Utility ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;
function safeColor(c, fallback) {
  return HEX_COLOR.test(c) ? c : fallback;
}

// ── Elements ─────────────────────────────────────────────────────────────────
const feedEl         = $('feed');
const feedLoading    = $('feed-loading');
const feedEmpty      = $('feed-empty');
const feedScreen     = $('feed-screen');
const customizeScreen= $('customize-screen');
const feedbackScreen = $('feedback-screen');
const drawer         = $('drawer');
const drawerBackdrop = $('drawer-backdrop');
const tiktokNav      = $('tiktok-nav');
const tiktokDots     = $('tiktok-dots');
const settingsModal  = $('settings-modal');
const articleModal   = $('article-modal');
const articleSheet   = $('article-sheet');

// ── Clock ─────────────────────────────────────────────────────────────────────
function updateClock() {
  const d = new Date();
  $('sb-time').textContent = `${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
}
updateClock();
setInterval(updateClock, 30000);

// ── Screen switching ──────────────────────────────────────────────────────────
function showScreen(name) {
  if (name === 'feedback') {
    state.previousScreen = state.currentScreen;
  }
  state.currentScreen = name;
  feedScreen.classList.toggle('active', name === 'feed');
  customizeScreen.classList.toggle('active', name === 'customize');
  feedbackScreen.classList.toggle('active', name === 'feedback');
  $('feedback-fab').style.display = name === 'feedback' ? 'none' : '';
  closeDrawer();
}

// ── Drawer ────────────────────────────────────────────────────────────────────
function openDrawer()  { drawer.classList.add('open'); drawerBackdrop.classList.add('visible'); }
function closeDrawer() { drawer.classList.remove('open'); drawerBackdrop.classList.remove('visible'); }
$('menu-btn').addEventListener('click', openDrawer);
drawerBackdrop.addEventListener('click', closeDrawer);

// ── Fetch static news from news.json ──────────────────────────────────────────
async function loadNews() {
  if (state.loading) return;

  state.loading = true;
  showLoading(true);

  // Spin the refresh icon
  const refreshBtn = $('refresh-btn');
  refreshBtn.querySelector('svg').classList.add('spinning');

  try {
    const r = await fetch('/news.json');
    if (!r.ok) throw new Error('Failed to load news');
    state.newsItems = await r.json();
    applyFilter();
  } catch (err) {
    console.error('loadNews error:', err);
    showLoading(false);
    feedEl.innerHTML = `<div class="feed-loading"><p style="color:#ff3b30">⚠️ ${esc(err.message)}</p></div>`;
  } finally {
    state.loading = false;
    refreshBtn.querySelector('svg').classList.remove('spinning');
  }
}

function showLoading(on) {
  feedLoading.style.display = on ? '' : 'none';
}

// ── Category filtering ────────────────────────────────────────────────────────
function applyFilter() {
  if (state.currentCategory === 'all') {
    state.filteredItems = [...state.newsItems];
  } else {
    state.filteredItems = state.newsItems.filter(
      n => n.category === state.currentCategory
    );
  }
  state.currentTikTokIndex = 0;
  renderFeed();
}

// ── Category bar ──────────────────────────────────────────────────────────────
document.querySelectorAll('.cat-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.currentCategory = btn.dataset.cat;
    applyFilter();
  });
});

// ── Mode switching ────────────────────────────────────────────────────────────
function setMode(mode) {
  state.currentMode = mode;
  localStorage.setItem('autopmf_mode', mode);

  // Update customize screen mode cards + feed mode bar
  document.querySelectorAll('.mode-card').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  document.querySelectorAll('.mode-bar-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));

  renderFeed();
}

// ── Main render dispatcher ────────────────────────────────────────────────────
function renderFeed() {
  showLoading(false);
  // Remove old mode classes
  feedEl.className = 'feed';

  // TikTok nav overlay
  tiktokNav.style.display = state.currentMode === 'tiktok' ? '' : 'none';

  if (state.filteredItems.length === 0 && !state.loading) {
    feedEl.innerHTML = '';
    feedEl.appendChild(feedLoading); feedLoading.style.display = 'none';
    feedEmpty.style.display = '';
    feedEl.appendChild(feedEmpty);
    return;
  }
  feedEmpty.style.display = 'none';

  switch (state.currentMode) {
    case 'text':      renderTextMode();      break;
    case 'instagram': renderInstagramMode(); break;
    case 'tiktok':    renderTikTokMode();    break;
    case 'cnn':       renderCnnMode();       break;
    case 'video':     renderVideoMode();     break;
    default:          renderTextMode();
  }
}

// ── Helpers: image & gradient ─────────────────────────────────────────────────
function gradStyle(item) {
  const g = item.imageGradient && item.imageGradient.length === 2
    ? item.imageGradient : ['#636e72', '#2d3436'];
  return `background: linear-gradient(135deg, ${safeColor(g[0], '#636e72')}, ${safeColor(g[1], '#2d3436')});`;
}

// Returns HTML for a real photo with gradient fallback
function imgHtml(item, extraClass = '') {
  const g = item.imageGradient && item.imageGradient.length === 2
    ? item.imageGradient : ['#636e72', '#2d3436'];
  const c0 = safeColor(g[0], '#636e72');
  const c1 = safeColor(g[1], '#2d3436');
  const url = item.imageUrl || '';
  if (url) {
    return `<img class="card-real-img ${extraClass}" src="${esc(url)}" alt="${esc(item.imageAlt || item.headline || '')}"
      onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
      <div class="img-fallback" style="background:linear-gradient(135deg,${c0},${c1})"></div>`;
  }
  return `<div class="img-fallback" style="background:linear-gradient(135deg,${c0},${c1})"></div>`;
}

// Sets the hero image of the article modal
function setHeroImg(item) {
  const heroEl = $('article-hero');
  // Remove old img/fallback (keep close btn, overlay, badge)
  heroEl.querySelectorAll('.card-real-img, .img-fallback').forEach(el => el.remove());
  const g = item.imageGradient && item.imageGradient.length === 2
    ? item.imageGradient : ['#636e72', '#2d3436'];
  const c0 = safeColor(g[0], '#636e72');
  const c1 = safeColor(g[1], '#2d3436');
  if (item.imageUrl) {
    const img = document.createElement('img');
    img.className = 'card-real-img';
    img.src = item.imageUrl;
    img.alt = item.imageAlt || item.headline || '';
    img.onerror = () => {
      img.style.display = 'none';
      const fb = document.createElement('div');
      fb.className = 'img-fallback';
      fb.style.cssText = `background:linear-gradient(135deg,${c0},${c1})`;
      heroEl.insertBefore(fb, heroEl.firstChild);
    };
    heroEl.insertBefore(img, heroEl.firstChild);
  } else {
    const fb = document.createElement('div');
    fb.className = 'img-fallback';
    fb.style.cssText = `background:linear-gradient(135deg,${c0},${c1})`;
    heroEl.insertBefore(fb, heroEl.firstChild);
  }
}

// ── TEXT MODE ─────────────────────────────────────────────────────────────────
function renderTextMode() {
  feedEl.classList.add('mode-text');
  feedEl.innerHTML = '';
  state.filteredItems.forEach(item => {
    const card = document.createElement('div');
    card.className = 'card-text';
    card.innerHTML = `
      <div class="card-thumb">
        ${imgHtml(item)}
      </div>
      <div class="card-content">
        <div class="card-cat-row">
          <span class="cat-badge">${esc(item.category)}</span>
          ${item.trending ? '<span class="trending-badge">🔥 Trending</span>' : ''}
        </div>
        <div class="card-headline">${esc(item.headline)}</div>
        <div class="card-summary">${esc(item.summary)}</div>
        <div class="card-footer">
          <span class="card-source">${esc(item.source)}</span>
          <span class="card-dot">·</span>
          <span>${esc(item.timeAgo)}</span>
          <span class="card-dot">·</span>
          <span>${esc(item.readTime)}</span>
        </div>
      </div>
    `;
    card.addEventListener('click', () => openArticle(item));
    feedEl.appendChild(card);
  });
}

// ── INSTAGRAM MODE ────────────────────────────────────────────────────────────
function renderInstagramMode() {
  feedEl.classList.add('mode-instagram');
  feedEl.innerHTML = '';
  state.filteredItems.forEach(item => {
    const card = document.createElement('div');
    card.className = 'card-instagram';
    card.innerHTML = `
      ${imgHtml(item, 'insta-bg-img')}
      <div class="insta-overlay"></div>
      <div class="insta-content">
        <div class="insta-cat">${esc(item.category)}</div>
        <div class="insta-headline">${esc(item.headline)}</div>
        <div class="insta-footer">
          <span>${esc(item.source)}</span>
          <span>·</span>
          <span>${esc(item.timeAgo)}</span>
          ${item.trending ? '<span class="insta-trending">🔥 Trending</span>' : ''}
        </div>
      </div>
    `;
    card.addEventListener('click', () => openArticle(item));
    feedEl.appendChild(card);
  });
}

// ── TIKTOK MODE ───────────────────────────────────────────────────────────────
function renderTikTokMode() {
  feedEl.classList.add('mode-tiktok');
  feedEl.innerHTML = '';
  const items = state.filteredItems;
  if (!items.length) return;

  // Clamp index
  state.currentTikTokIndex = Math.max(0, Math.min(state.currentTikTokIndex, items.length - 1));

  // Render current card
  const item = items[state.currentTikTokIndex];
  const card = document.createElement('div');
  card.className = 'card-tiktok';
  card.innerHTML = `
    ${imgHtml(item, 'tiktok-bg-img')}
    <div class="tiktok-overlay"></div>
    <div class="tiktok-content">
      <div class="tiktok-cat">${esc(item.category)}</div>
      <div class="tiktok-headline">${esc(item.headline)}</div>
      <div class="tiktok-summary">${esc(item.summary)}</div>
      <div class="tiktok-meta">
        <span>${esc(item.source)}</span>
        <span>·</span>
        <span>${esc(item.timeAgo)}</span>
        ${item.trending ? '<span class="tiktok-trending-badge">🔥 Trending</span>' : ''}
      </div>
    </div>
    ${items.length > 1 ? '<div class="swipe-hint">Swipe up/down to browse</div>' : ''}
  `;
  card.addEventListener('click', () => openArticle(item));
  feedEl.appendChild(card);

  // Update dots
  renderTikTokDots(items.length, state.currentTikTokIndex);

  // Update arrows
  $('tiktok-up').style.opacity   = state.currentTikTokIndex > 0 ? '1' : '0.3';
  $('tiktok-down').style.opacity = state.currentTikTokIndex < items.length - 1 ? '1' : '0.3';
}

function renderTikTokDots(total, current) {
  const MAX_DOTS = 8;
  const count = Math.min(total, MAX_DOTS);
  tiktokDots.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const dot = document.createElement('div');
    dot.className = 'tiktok-dot' + (i === Math.min(current, MAX_DOTS - 1) ? ' active' : '');
    tiktokDots.appendChild(dot);
  }
}

// TikTok navigation buttons
$('tiktok-up').addEventListener('click', () => {
  if (state.currentTikTokIndex > 0) {
    state.currentTikTokIndex--;
    renderTikTokMode();
  }
});
$('tiktok-down').addEventListener('click', () => {
  if (state.currentTikTokIndex < state.filteredItems.length - 1) {
    state.currentTikTokIndex++;
    renderTikTokMode();
  }
});

// Touch swipe for TikTok
let touchStartY = 0;
feedEl.addEventListener('touchstart', e => {
  touchStartY = e.touches[0].clientY;
}, { passive: true });
feedEl.addEventListener('touchend', e => {
  if (state.currentMode !== 'tiktok') return;
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (Math.abs(dy) < 40) return; // too small
  if (dy < 0 && state.currentTikTokIndex < state.filteredItems.length - 1) {
    state.currentTikTokIndex++;
    renderTikTokMode();
  } else if (dy > 0 && state.currentTikTokIndex > 0) {
    state.currentTikTokIndex--;
    renderTikTokMode();
  }
}, { passive: true });

// Keyboard arrow navigation for TikTok (desktop)
document.addEventListener('keydown', e => {
  if (state.currentMode !== 'tiktok') return;
  if (e.key === 'ArrowDown' && state.currentTikTokIndex < state.filteredItems.length - 1) {
    state.currentTikTokIndex++;
    renderTikTokMode();
  } else if (e.key === 'ArrowUp' && state.currentTikTokIndex > 0) {
    state.currentTikTokIndex--;
    renderTikTokMode();
  }
});

// ── CNN MODE ──────────────────────────────────────────────────────────────────
function renderCnnMode() {
  feedEl.classList.add('mode-cnn');
  feedEl.innerHTML = '';
  const items = state.filteredItems;
  if (!items.length) return;

  // Featured story (first item)
  const featured = items[0];
  const featEl = document.createElement('div');
  featEl.className = 'cnn-featured';
  featEl.innerHTML = `
    ${imgHtml(featured)}
    <div class="cnn-feat-overlay"></div>
    <div class="cnn-feat-content">
      <div class="cnn-feat-badge">${featured.trending ? '🔥 Top Story' : esc(featured.category)}</div>
      <div class="cnn-feat-headline">${esc(featured.headline)}</div>
    </div>
  `;
  featEl.addEventListener('click', () => openArticle(featured));
  feedEl.appendChild(featEl);

  // 2nd and 3rd items in a 2-col grid
  if (items.length > 1) {
    const labelEl = document.createElement('div');
    labelEl.className = 'cnn-section-label';
    labelEl.textContent = 'More Stories';
    feedEl.appendChild(labelEl);

    const grid = document.createElement('div');
    grid.className = 'cnn-grid';
    items.slice(1, 5).forEach(item => {
      const cell = document.createElement('div');
      cell.className = 'card-cnn-small';
      cell.innerHTML = `
        <div class="cnn-small-thumb">${imgHtml(item)}</div>
        <div class="cnn-small-cat">${esc(item.category)}</div>
        <div class="cnn-small-headline">${esc(item.headline)}</div>
        <div class="cnn-small-footer">${esc(item.source)} · ${esc(item.timeAgo)}</div>
      `;
      cell.addEventListener('click', () => openArticle(item));
      grid.appendChild(cell);
    });
    feedEl.appendChild(grid);
  }

  // Remaining items as list
  if (items.length > 5) {
    const label2 = document.createElement('div');
    label2.className = 'cnn-section-label';
    label2.textContent = 'In Depth';
    feedEl.appendChild(label2);

    items.slice(5).forEach(item => {
      const listItem = document.createElement('div');
      listItem.className = 'cnn-list-item';
      listItem.innerHTML = `
        <div class="cnn-list-thumb">${imgHtml(item)}</div>
        <div class="cnn-list-content">
          <div class="cnn-list-cat">${esc(item.category)} · ${esc(item.region || '')}</div>
          <div class="cnn-list-headline">${esc(item.headline)}</div>
          <div class="cnn-list-footer">${esc(item.source)} · ${esc(item.timeAgo)} · ${esc(item.readTime)}</div>
        </div>
      `;
      listItem.addEventListener('click', () => openArticle(item));
      feedEl.appendChild(listItem);
    });
  }
}

// ── VIDEO MODE ────────────────────────────────────────────────────────────────
function renderVideoMode() {
  feedEl.classList.add('mode-video');
  feedEl.innerHTML = '';
  state.filteredItems.forEach(item => {
    const card = document.createElement('div');
    card.className = 'card-video';
    // Simulate video duration based on readTime
    const mins = parseInt(item.readTime) || 3;
    const duration = `${mins}:${String(Math.floor(Math.random()*59)).padStart(2,'0')}`;
    card.innerHTML = `
      <div class="video-thumb">
        ${imgHtml(item)}
        <div class="video-play-btn">
          <svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>
        </div>
        <div class="video-duration">${esc(duration)}</div>
      </div>
      <div class="video-info">
        <div class="video-cat-row">
          <span class="video-cat">${esc(item.category)}</span>
          ${item.trending ? '<span class="video-trending">· 🔥 Trending</span>' : ''}
        </div>
        <div class="video-title">${esc(item.headline)}</div>
        <div class="video-meta">${esc(item.source)} · ${esc(item.timeAgo)} · ${esc(item.readTime)}</div>
      </div>
    `;
    card.addEventListener('click', () => openArticle(item));
    feedEl.appendChild(card);
  });
}

// ── Article Detail (Full Screen) ──────────────────────────────────────────────
function openArticle(item) {
  state.activeArticle = item;

  // Hero image
  setHeroImg(item);

  // Category + trending badges
  $('article-cat').textContent = item.category || '';
  const trendBadge = $('article-trending');
  trendBadge.style.display = item.trending ? '' : 'none';

  // Text content
  $('article-source-time').textContent = `${item.source || ''} · ${item.timeAgo || ''} · ${item.readTime || ''}`;
  $('article-headline').textContent = item.headline || '';
  $('article-summary').textContent = item.summary || '';
  $('article-detail').textContent = item.detail || '';

  // Reset ask section
  $('ask-input').value = '';
  $('ask-response').style.display = 'none';
  $('ask-response').className = 'ask-response';
  $('ask-response').textContent = '';

  articleModal.classList.add('open');
  $('article-body').scrollTop = 0;
}

function closeArticle() {
  articleModal.classList.remove('open');
  state.activeArticle = null;
}

$('article-close-btn').addEventListener('click', closeArticle);

// Ask Claude about the article
$('ask-send-btn').addEventListener('click', askClaude);
$('ask-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); askClaude(); }
});

async function askClaude() {
  const question = $('ask-input').value.trim();
  if (!question || !state.activeArticle) return;

  const responseEl = $('ask-response');
  responseEl.className = 'ask-response loading';
  responseEl.innerHTML = '<div class="spinner" style="width:16px;height:16px;border-width:2px;flex-shrink:0"></div><span>Asking Claude…</span>';
  responseEl.style.display = 'flex';
  $('ask-send-btn').disabled = true;

  try {
    const r = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        article: state.activeArticle,
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed');
    responseEl.className = 'ask-response';
    responseEl.textContent = data.text;
    responseEl.style.display = 'block';
    $('ask-input').value = '';
  } catch (err) {
    responseEl.className = 'ask-response';
    responseEl.textContent = '⚠️ ' + err.message;
    responseEl.style.display = 'block';
  } finally {
    $('ask-send-btn').disabled = false;
  }
}

// ── Refresh button ────────────────────────────────────────────────────────────
$('refresh-btn')?.addEventListener('click', loadNews);
$('drawer-refresh-btn')?.addEventListener('click', () => { closeDrawer(); loadNews(); });

// ── Navigate to End → Feedback ────────────────────────────────────────────────
function goToFeedback() { closeDrawer(); showScreen('feedback'); }
$('end-btn')?.addEventListener('click', goToFeedback);
$('feedback-fab')?.addEventListener('click', goToFeedback);
$('feedback-back')?.addEventListener('click', () => showScreen(state.previousScreen || 'feed'));

// ── Feedback slider ───────────────────────────────────────────────────────────
const gradeEl    = $('grade');
const gradeValEl = $('grade-val');
gradeEl?.addEventListener('input', () => { gradeValEl.textContent = gradeEl.value; });

// ── Submit feedback ───────────────────────────────────────────────────────────
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
        suggestion: $('suggestion').value,
        page: state.previousScreen || 'feed',
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed');
    feedbackMsg.textContent = 'Thanks! Your feedback was saved. ✓';
    feedbackMsg.className = 'feedback-msg show success';
    $('comments').value = '';
    $('suggestion').value = '';
    gradeEl.value = 7;
    gradeValEl.textContent = '7';
    setTimeout(() => showScreen(state.previousScreen || 'feed'), 1200);
  } catch (err) {
    feedbackMsg.textContent = 'Could not save feedback: ' + err.message;
    feedbackMsg.className = 'feedback-msg show error';
  } finally {
    submitFbBtn.disabled = false;
  }
});

// ── Customize Screen ──────────────────────────────────────────────────────────
$('drawer-customize-btn').addEventListener('click', () => { closeDrawer(); showScreen('customize'); openCustomize(); });
$('customize-back').addEventListener('click', () => showScreen('feed'));
$('customize-save').addEventListener('click', () => { saveCustomize(); showScreen('feed'); });

function openCustomize() {
  const prefs = state.preferences;

  // Restore mode
  document.querySelectorAll('.mode-card').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === state.currentMode);
  });
  document.querySelectorAll('.mode-card').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('active'));
      b.classList.add('active');
    }, { once: false });
  });

  // Restore topics
  document.querySelectorAll('.topic-chip').forEach(chip => {
    chip.classList.toggle('selected', (prefs.topics || []).includes(chip.dataset.topic));
  });

  // Restore region
  document.querySelectorAll('.region-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.region === (prefs.region || 'Global'));
  });

  // Restore count
  const count = String(prefs.count || 8);
  document.querySelectorAll('.count-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.count === count);
  });
}

function saveCustomize() {
  // Mode
  const activeMode = document.querySelector('.mode-card.active');
  if (activeMode) setMode(activeMode.dataset.mode);

  // Topics
  const topics = [];
  document.querySelectorAll('.topic-chip.selected').forEach(c => topics.push(c.dataset.topic));
  state.preferences.topics = topics;

  // Region
  const activeRegion = document.querySelector('.region-btn.active');
  state.preferences.region = activeRegion ? activeRegion.dataset.region : 'Global';

  // Count
  const activeCount = document.querySelector('.count-btn.active');
  state.preferences.count = activeCount ? Number(activeCount.dataset.count) : 8;

  localStorage.setItem('autopmf_prefs', JSON.stringify(state.preferences));
}

// Topic chip toggle
document.querySelectorAll('.topic-chip').forEach(chip => {
  chip.addEventListener('click', () => chip.classList.toggle('selected'));
});

// Region single-select
document.querySelectorAll('.region-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.region-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// Count single-select
document.querySelectorAll('.count-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.count-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// Apply & refresh
$('cust-apply-btn').addEventListener('click', () => {
  saveCustomize();
  showScreen('feed');
  loadNews();
});

// ── Settings Modal (kept for future use) ─────────────────────────────────────
function openSettings()  { settingsModal.classList.add('open'); }
function closeSettings() { settingsModal.classList.remove('open'); }

$('settings-btn').addEventListener('click', () => { closeDrawer(); openSettings(); });
settingsModal.querySelectorAll('[data-close-modal]').forEach(el =>
  el.addEventListener('click', closeSettings)
);

// ── About Modal ──────────────────────────────────────────────────────────────
const aboutModal = $('about-modal');
function openAbout()  { closeDrawer(); aboutModal.classList.add('open'); }
function closeAbout() { aboutModal.classList.remove('open'); }
$('about-btn').addEventListener('click', openAbout);
aboutModal.querySelectorAll('[data-close-about]').forEach(el =>
  el.addEventListener('click', closeAbout)
);

// ── Initialise app mode from localStorage ────────────────────────────────────
function initMode() {
  const mode = state.currentMode;
  document.querySelectorAll('.mode-card').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  document.querySelectorAll('.mode-bar-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));

  // Wire up mode bar click handlers
  document.querySelectorAll('.mode-bar-btn').forEach(b => {
    b.addEventListener('click', () => setMode(b.dataset.mode));
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  initMode();
  loadNews();
}

init();
