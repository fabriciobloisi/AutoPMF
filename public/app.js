// ── State ────────────────────────────────────────────────────────────────────
const state = {
  newsItems: [],        // all loaded articles
  filteredItems: [],    // after category filter
  currentMode: localStorage.getItem('autopmf_mode') || 'text',
  currentCategory: 'all',
  currentTikTokIndex: 0,
  loading: false,
  preferences: JSON.parse(localStorage.getItem('autopmf_prefs') || '{"topics":[],"region":"Global","count":8,"sources":[]}'),
  activeArticle: null,  // article open in detail modal
  currentScreen: 'feed',
  previousScreen: 'feed',
  searchQuery: '',
  savedArticles: JSON.parse(localStorage.getItem('autopmf_saved') || '[]'),
  showingSaved: false,
};

// ── Saved articles ───────────────────────────────────────────────────────────
function isArticleSaved(id) { return state.savedArticles.some(a => a.id === id); }
function toggleSaveArticle(item) {
  if (isArticleSaved(item.id)) {
    state.savedArticles = state.savedArticles.filter(a => a.id !== item.id);
  } else {
    state.savedArticles.push(item);
  }
  localStorage.setItem('autopmf_saved', JSON.stringify(state.savedArticles));
}

// ── Category colors ──────────────────────────────────────────────────────────
const CAT_COLORS = {
  Technology:'#0066CC', Business:'#FF6B35', World:'#1A936F', Politics:'#4A4E69',
  Science:'#00B4D8', Sports:'#52B788', Health:'#E63946', Culture:'#9B5DE5',
  Climate:'#2D6A4F', AI:'#7209B7', Entertainment:'#E040FB', Finance:'#FF6D00',
  Space:'#1A237E', Education:'#00695C', Travel:'#0277BD', Food:'#BF360C', Opinion:'#4E342E'
};
function catBadgeStyle(cat) {
  const c = CAT_COLORS[cat];
  return c ? `background:${c};color:#fff` : '';
}

// ── Utility ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Brief toast notification (auto-dismisses after 2.5s)
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
  _toastTimer = setTimeout(() => el.classList.remove('visible'), 2500);
}

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

const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;
function safeColor(c, fallback) {
  return HEX_COLOR.test(c) ? c : fallback;
}

// Highlight search matches in text (returns escaped HTML with <mark> wrapping)
function highlight(text) {
  const s = esc(String(text || ''));
  const q = state.searchQuery.trim();
  if (!q) return s;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${escaped})`, 'gi');
  return s.replace(re, '<mark>$1</mark>');
}

// ── Elements ─────────────────────────────────────────────────────────────────
const feedEl         = $('feed');
const feedLoading    = $('feed-loading');
const feedEmpty      = $('feed-empty');
const feedScreen     = $('feed-screen');
const customizeScreen= $('customize-screen');
const feedbackScreen = $('feedback-screen');
const statsScreen    = $('stats-screen');
const progressScreen = $('progress-screen');
const drawer         = $('drawer');
const drawerBackdrop = $('drawer-backdrop');
const tiktokNav      = $('tiktok-nav');
const tiktokDots     = $('tiktok-dots');
const settingsModal  = $('settings-modal');
const articleModal   = $('article-modal');
const articleSheet   = $('article-sheet');

// ── Clock ─────────────────────────────────────────────────────────────────────
function updateClock() {
  const el = $('sb-time');
  if (!el) return;
  const d = new Date();
  el.textContent = `${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
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
  statsScreen.classList.toggle('active', name === 'stats');
  progressScreen.classList.toggle('active', name === 'progress');
  $('feedback-fab').style.display = (name === 'feedback' || name === 'stats' || name === 'progress') ? 'none' : '';
  $('refresh-btn').style.display = name === 'feed' ? '' : 'none';
  if (name === 'stats') loadStats();
  if (name === 'progress') loadProgress();
  closeDrawer();
}

// ── Drawer ────────────────────────────────────────────────────────────────────
function openDrawer()  { closeArticle(); drawer.classList.add('open'); drawerBackdrop.classList.add('visible'); }
function closeDrawer() { drawer.classList.remove('open'); drawerBackdrop.classList.remove('visible'); }
$('menu-btn').addEventListener('click', openDrawer);
drawerBackdrop.addEventListener('click', closeDrawer);

// ── Fetch news — static first for speed, dynamic for Load More ───────────────
async function fetchNewsFromAPI(timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = {
      topics: state.preferences.topics || [],
      count: state.preferences.count || 8,
      regions: state.preferences.regions || [],
    };
    const r = await fetch('/api/news', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!r.ok) throw new Error('API error');
    return r.json();
  } finally {
    clearTimeout(timer);
  }
}

async function loadNews() {
  if (state.loading) return;

  state.loading = true;
  showLoading(true);

  // Spin the refresh icon and disable button during load
  const refreshBtn = $('refresh-btn');
  refreshBtn.disabled = true;
  refreshBtn.querySelector('svg').classList.add('spinning');

  try {
    feedEl.style.opacity = '0.3';
    feedEl.style.transition = 'opacity 0.15s';
    // Load static news.json first (instant)
    const r = await fetch('/news.json');
    if (!r.ok) throw new Error('Failed to load news');
    state.newsItems = await r.json();
    state.lastUpdated = Date.now();
    applyFilter();
    feedEl.style.opacity = '1';

    // Background: fetch 1 fresh article to make feed feel live
    fetchNewsFromAPI(15000).then(articles => {
      if (!articles || !articles.length) return;
      const fresh = articles[0];
      fresh.timeAgo = 'Just now';
      fresh.trending = false;
      const ids = new Set(state.newsItems.map(a => a.id));
      if (!ids.has(fresh.id)) {
        state.newsItems = [fresh, ...state.newsItems];
        state.lastUpdated = Date.now();
        applyFilter();
      }
    }).catch(() => {});  // silent — static feed already shown
  } catch (err) {
    console.error('loadNews error:', err);
    showLoading(false);
    feedEl.innerHTML = `<div class="feed-loading"><p style="color:#ff3b30">⚠️ ${esc(err.message)}</p></div>`;
  } finally {
    state.loading = false;
    refreshBtn.querySelector('svg').classList.remove('spinning');
    refreshBtn.disabled = false;
  }
}

async function loadMoreNews() {
  if (state.loading) return;

  state.loading = true;
  const moreBtn = feedEl.querySelector('.load-more-btn');
  if (moreBtn) {
    moreBtn.textContent = 'Loading...';
    moreBtn.disabled = true;
  }

  try {
    const articles = await fetchNewsFromAPI();
    // Append new articles (avoid duplicates by id)
    const existingIds = new Set(state.newsItems.map(a => a.id));
    const newArticles = articles.filter(a => !existingIds.has(a.id));
    state.newsItems = [...state.newsItems, ...newArticles];
    applyFilter();
  } catch (err) {
    console.error('loadMoreNews error:', err);
    if (moreBtn) {
      moreBtn.textContent = 'Failed — tap to retry';
      moreBtn.disabled = false;
    }
  } finally {
    state.loading = false;
  }
}

function showLoading(on) {
  feedLoading.style.display = on ? '' : 'none';
}

// ── Category + Search filtering ───────────────────────────────────────────────
function applyFilter() {
  if (state.showingSaved) {
    state.showingSaved = false;
    document.querySelector('.nav-title').textContent = 'AutoPMF';
  }
  let items = state.currentCategory === 'all'
    ? [...state.newsItems]
    : state.newsItems.filter(n => n.category === state.currentCategory);

  // Filter by preferred regions
  let regions = state.preferences.regions || [];
  // Legacy: single region string (not "Global")
  if (regions.length === 0 && state.preferences.region && state.preferences.region !== 'Global') {
    regions = [state.preferences.region];
  }
  if (regions.length > 0) {
    items = items.filter(n => regions.includes(n.region));
  }

  // Filter by preferred sources
  const sources = state.preferences.sources || [];
  if (sources.length > 0) {
    items = items.filter(n => sources.includes(n.source));
  }

  const q = state.searchQuery.trim().toLowerCase();
  if (q) {
    items = items.filter(n =>
      (n.headline || '').toLowerCase().includes(q) ||
      (n.hook     || '').toLowerCase().includes(q) ||
      (n.summary  || '').toLowerCase().includes(q) ||
      (n.category || '').toLowerCase().includes(q) ||
      (Array.isArray(n.tags) ? n.tags.join(' ') : '').toLowerCase().includes(q)
    );
    // Prioritise headline matches over body-only matches
    items.sort((a, b) => {
      const aHead = (a.headline || '').toLowerCase().includes(q) ? 0 : 1;
      const bHead = (b.headline || '').toLowerCase().includes(q) ? 0 : 1;
      return aHead - bHead;
    });
  }

  // Cap trending badges to max 2 to reduce clutter
  let trendCount = 0;
  items.forEach(n => {
    if (n.trending) {
      trendCount++;
      if (trendCount > 2) n._hideTrending = true;
    }
  });

  state.filteredItems = items;
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

// Show only selected topic chips (+ "All"); show all if no preferences set
function updateCategoryBar() {
  const topics = state.preferences.topics || [];
  document.querySelectorAll('.cat-btn').forEach(btn => {
    if (btn.dataset.cat === 'all' || topics.length === 0) {
      btn.style.display = '';
    } else {
      btn.style.display = topics.includes(btn.dataset.cat) ? '' : 'none';
    }
  });
}

// ── Search bar ────────────────────────────────────────────────────────────────
const searchInput = $('search-input');
const searchClear = $('search-clear');
searchInput.addEventListener('input', () => {
  state.searchQuery = searchInput.value;
  searchClear.style.display = state.searchQuery ? '' : 'none';
  applyFilter();
});
searchClear.addEventListener('click', () => {
  searchInput.value = '';
  state.searchQuery = '';
  searchClear.style.display = 'none';
  searchInput.focus();
  applyFilter();
});

// ── Mode switching ────────────────────────────────────────────────────────────
function setMode(mode) {
  state.currentMode = mode;
  localStorage.setItem('autopmf_mode', mode);

  // Update customize screen mode cards
  document.querySelectorAll('.mode-card').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));

  renderFeed();
}

// ── Empty state messages per category ─────────────────────────────────────────
const emptyMessages = {
  all:        { icon: '🍵', text: 'The newsroom took a tea break.<br>Hit refresh and they\'ll get back to work!' },
  Technology: { icon: '🤖', text: 'The robots are still booting up.<br>Try again in a moment!' },
  AI:         { icon: '🧠', text: 'AI is thinking really hard right now.<br>Give it a sec — or hit refresh!' },
  World:      { icon: '🌍', text: 'The world is suspiciously quiet.<br>Refresh to see what\'s really going on.' },
  Business:   { icon: '💼', text: 'Markets are closed, traders are napping.<br>Refresh for the latest!' },
  Science:    { icon: '🔬', text: 'Still awaiting peer review.<br>Try refreshing — science takes time!' },
  Climate:    { icon: '🌱', text: 'The forecast? Empty — for now.<br>Refresh to check the climate pulse!' },
  Health:     { icon: '🧘', text: 'Take a deep breath. Nothing here yet.<br>Refresh and feel better!' },
  Culture:    { icon: '🎭', text: 'The muse is on vacation.<br>Refresh and she might come back!' },
  Sports:     { icon: '⚽', text: 'Halftime! No scores to report.<br>Refresh for the next play!' },
  Politics:      { icon: '🏛️', text: 'No comment at this time.<br>Refresh for the official statement!' },
  Entertainment: { icon: '🎬', text: 'The show hasn\'t started yet.<br>Refresh for tonight\'s lineup!' },
  Finance:       { icon: '📈', text: 'Markets are still calculating.<br>Refresh for the latest numbers!' },
  Space:         { icon: '🚀', text: 'Houston, we have no articles.<br>Refresh to launch a new search!' },
  Education:     { icon: '📚', text: 'Class hasn\'t started yet.<br>Refresh for today\'s lessons!' },
  Travel:        { icon: '✈️', text: 'Destination: unknown.<br>Refresh to explore the world!' },
  Food:          { icon: '🍽️', text: 'The kitchen is still prepping.<br>Refresh for a fresh serving!' },
  Opinion:       { icon: '💬', text: 'Everyone\'s speechless — for now.<br>Refresh for hot takes!' },
};

const searchEmptyMessages = [
  { icon: '🔍', text: 'Even our best reporters couldn\'t find that.<br>Try different keywords!' },
  { icon: '🕵️', text: 'Sherlock searched. Watson searched. Nothing.<br>Maybe rephrase your query?' },
  { icon: '🌵', text: 'It\'s a news desert for that search.<br>Try something broader!' },
  { icon: '🦗', text: '*crickets*<br>No articles matched your search.' },
];

function getEmptyMessage(category) {
  if (state.searchQuery.trim()) {
    return searchEmptyMessages[Math.floor(Math.random() * searchEmptyMessages.length)];
  }
  return emptyMessages[category] || emptyMessages.all;
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
    const emptyMsg = getEmptyMessage(state.currentCategory);
    $('feed-empty-icon').textContent = emptyMsg.icon;
    $('feed-empty-text').innerHTML = emptyMsg.text;
    feedEmpty.style.display = '';
    feedEl.appendChild(feedEmpty);
    return;
  }
  feedEmpty.style.display = 'none';

  // "Updated" timestamp at top of feed
  if (state.lastUpdated && state.currentMode !== 'tiktok') {
    const ts = document.createElement('div');
    ts.className = 'feed-updated';
    ts.textContent = `Updated ${new Date(state.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    feedEl.appendChild(ts);
  }

  switch (state.currentMode) {
    case 'text':      renderTextMode();      break;
    case 'instagram': renderInstagramMode(); break;
    case 'tiktok':    renderTikTokMode();    break;
    case 'cnn':       renderCnnMode();       break;
    case 'video':     renderVideoMode();     break;
    default:          renderTextMode();
  }

  // Load more button at bottom (except TikTok mode)
  if (state.currentMode !== 'tiktok' && state.filteredItems.length > 0) {
    const moreBtn = document.createElement('button');
    moreBtn.className = 'load-more-btn';
    moreBtn.textContent = 'Generate fresh news';
    moreBtn.addEventListener('click', loadMoreNews);
    feedEl.appendChild(moreBtn);
  }
}

// ── Helpers: image & gradient ─────────────────────────────────────────────────
function gradStyle(item) {
  const g = item.imageGradient && item.imageGradient.length === 2
    ? item.imageGradient : ['#636e72', '#2d3436'];
  return `background: linear-gradient(135deg, ${safeColor(g[0], '#636e72')}, ${safeColor(g[1], '#2d3436')});`;
}

// Returns HTML for a real photo with gradient fallback
// Image proxy: prefer picsum.photos for reliability, fall back to original URL
function proxyImgUrl(url) {
  if (!url) return '';
  // Convert Unsplash source URLs to picsum (reliable, no rate limits)
  if (url.includes('source.unsplash.com')) {
    const seed = url.split('?')[1] || 'default';
    return `https://picsum.photos/seed/${encodeURIComponent(seed)}/800/500`;
  }
  return url;
}

function imgHtml(item, extraClass = '') {
  const g = item.imageGradient && item.imageGradient.length === 2
    ? item.imageGradient : ['#636e72', '#2d3436'];
  const c0 = safeColor(g[0], '#636e72');
  const c1 = safeColor(g[1], '#2d3436');
  const url = proxyImgUrl(item.imageUrl || '');
  if (url) {
    return `<img class="card-real-img ${extraClass}" src="${esc(url)}" alt="${esc(item.imageAlt || item.headline || '')}" loading="lazy"
      onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
      <div class="img-fallback" style="background:linear-gradient(135deg,${c0},${c1})"></div>`;
  }
  return `<div class="img-fallback" style="display:block;background:linear-gradient(135deg,${c0},${c1})"></div>`;
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
    img.src = proxyImgUrl(item.imageUrl);
    img.alt = item.imageAlt || item.headline || '';
    img.onerror = () => {
      img.style.display = 'none';
      const fb = document.createElement('div');
      fb.className = 'img-fallback';
      fb.style.cssText = `display:block;background:linear-gradient(135deg,${c0},${c1})`;
      heroEl.insertBefore(fb, heroEl.firstChild);
    };
    heroEl.insertBefore(img, heroEl.firstChild);
  } else {
    const fb = document.createElement('div');
    fb.className = 'img-fallback';
    fb.style.cssText = `display:block;background:linear-gradient(135deg,${c0},${c1})`;
    heroEl.insertBefore(fb, heroEl.firstChild);
  }
}

// ── TEXT MODE ─────────────────────────────────────────────────────────────────
function renderTextMode() {
  feedEl.classList.add('mode-text');
  feedEl.innerHTML = '';
  state.filteredItems.forEach((item, idx) => {
    const card = document.createElement('div');
    card.className = 'card-text';
    card.style.setProperty('--card-idx', idx);
    card.innerHTML = `
      <div class="card-thumb">
        ${imgHtml(item)}
      </div>
      <div class="card-content">
        <div class="card-cat-row">
          <span class="cat-badge" style="${catBadgeStyle(item.category)}">${esc(item.category)}</span>
          ${item.trending && !item._hideTrending ? '<span class="trending-badge">TRENDING</span>' : ''}
        </div>
        <div class="card-headline">${highlight(item.headline)}</div>
        <div class="card-summary">${highlight(item.summary)}</div>
        <div class="card-footer">
          <span class="card-source">${esc(item.source)}</span>
          <span class="card-dot">·</span>
          <span>${esc(item.timeAgo)}</span>
          <span class="card-dot">·</span>
          <span>${esc(item.readTime)}</span>
          <button class="card-save-btn ${isArticleSaved(item.id) ? 'saved' : ''}" aria-label="Save">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="${isArticleSaved(item.id) ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            <span class="card-btn-label">Save</span>
          </button>
          <button class="card-share-btn" aria-label="Share">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
            <span class="card-btn-label">Share</span>
          </button>
        </div>
      </div>
    `;
    card.querySelector('.card-save-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSaveArticle(item);
      const btn = e.currentTarget;
      const saved = isArticleSaved(item.id);
      btn.classList.toggle('saved', saved);
      btn.querySelector('svg').setAttribute('fill', saved ? 'currentColor' : 'none');
    });
    card.querySelector('.card-share-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      shareItem(item, e.currentTarget);
    });
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
        <div class="insta-cat" style="${catBadgeStyle(item.category)}">${esc(item.category)}</div>
        <div class="insta-headline">${highlight(item.headline)}</div>
        <div class="insta-footer">
          <span>${esc(item.source)}</span>
          <span>·</span>
          <span>${esc(item.timeAgo)}</span>
          ${item.trending && !item._hideTrending ? '<span class="insta-trending">TRENDING</span>' : ''}
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
      <div class="tiktok-cat" style="${catBadgeStyle(item.category)}">${esc(item.category)}</div>
      <div class="tiktok-headline">${highlight(item.headline)}</div>
      <div class="tiktok-summary">${highlight(item.summary)}</div>
      <div class="tiktok-meta">
        <span>${esc(item.source)}</span>
        <span>·</span>
        <span>${esc(item.timeAgo)}</span>
        ${item.trending && !item._hideTrending ? '<span class="tiktok-trending-badge">TRENDING</span>' : ''}
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
      <div class="cnn-feat-badge" style="${featured.trending ? '' : catBadgeStyle(featured.category)}">${featured.trending ? 'TOP STORY' : esc(featured.category)}</div>
      <div class="cnn-feat-headline">${highlight(featured.headline)}</div>
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
        <div class="cnn-small-cat" style="${catBadgeStyle(item.category)}">${esc(item.category)}</div>
        <div class="cnn-small-headline">${highlight(item.headline)}</div>
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
          <div class="cnn-list-headline">${highlight(item.headline)}</div>
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
    card.innerHTML = `
      <div class="video-thumb">
        ${imgHtml(item)}
      </div>
      <div class="video-info">
        <div class="video-cat-row">
          <span class="video-cat" style="${catBadgeStyle(item.category)}">${esc(item.category)}</span>
          ${item.trending && !item._hideTrending ? '<span class="video-trending">· TRENDING</span>' : ''}
        </div>
        <div class="video-title">${highlight(item.headline)}</div>
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
  const catColor = CAT_COLORS[item.category];
  if (catColor) { $('article-cat').style.background = catColor; $('article-cat').style.color = '#fff'; }
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

  // Related articles (same category, different article)
  const relatedEl = $('related-articles');
  const relatedItems = state.filteredItems
    .filter(a => a.id !== item.id && a.category === item.category)
    .slice(0, 3);
  if (relatedItems.length > 0) {
    relatedEl.innerHTML = `
      <div class="related-label">Related Stories</div>
      ${relatedItems.map((a, i) => `
        <div class="related-card" data-idx="${i}">
          <div class="related-thumb">${imgHtml(a)}</div>
          <div class="related-info">
            <div class="related-headline">${esc(a.headline)}</div>
            <div class="related-meta">${esc(a.source)} · ${esc(a.timeAgo)}</div>
          </div>
        </div>
      `).join('')}
    `;
    relatedEl.querySelectorAll('.related-card').forEach(card => {
      const idx = Number(card.dataset.idx);
      card.addEventListener('click', () => openArticle(relatedItems[idx]));
    });
  } else {
    relatedEl.innerHTML = '';
  }

  articleModal.classList.add('open');
  $('article-body').scrollTop = 0;
}

function closeArticle() {
  articleModal.classList.remove('open');
  state.activeArticle = null;
}

$('article-close-btn').addEventListener('click', closeArticle);

// Share article helper
async function shareItem(item, feedbackBtn) {
  const text = `${item.headline}\n\n${item.hook || item.summary}`;
  const shareData = { title: item.headline, text };
  if (navigator.share) {
    try { await navigator.share(shareData); } catch {}
  } else {
    try {
      await navigator.clipboard.writeText(text);
      if (feedbackBtn) {
        feedbackBtn.style.color = '#34c759';
        setTimeout(() => feedbackBtn.style.color = '', 1200);
      }
    } catch {}
  }
}

$('article-share-btn').addEventListener('click', () => shareItem(state.activeArticle, $('article-share-btn')));

// Ask Claude about the article
$('ask-send-btn').addEventListener('click', askClaude);
$('ask-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); askClaude(); }
});
// Character counter for Ask the news input — always visible, warns when near limit
(function initAskCounter() {
  const input = $('ask-input');
  if (!input) return;
  const counter = document.createElement('span');
  counter.id = 'ask-char-count';
  counter.className = 'ask-char-count';
  counter.textContent = '300';
  input.parentNode.insertBefore(counter, input.nextSibling);
  input.addEventListener('input', () => {
    const remaining = 300 - input.value.length;
    counter.textContent = String(remaining);
    counter.classList.toggle('warn', remaining < 30);
    counter.classList.toggle('near', remaining < 60 && remaining >= 30);
  });
})();

async function askClaude() {
  const question = $('ask-input').value.trim();
  if (!question || !state.activeArticle) return;

  const responseEl = $('ask-response');
  responseEl.className = 'ask-response loading';
  responseEl.innerHTML = '<div class="spinner" style="width:16px;height:16px;border-width:2px;flex-shrink:0"></div><span>Asking Claude…</span>';
  responseEl.style.display = 'flex';
  $('ask-send-btn').disabled = true;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const r = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        article: state.activeArticle,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed');
    responseEl.className = 'ask-response';
    const fmtAsk = t => esc(t).replace(/\*([^*]+)\*/g, '<em>$1</em>');
    responseEl.innerHTML = data.text.split('\n').filter(p => p.trim()).map(p => `<p>${fmtAsk(p)}</p>`).join('');
    responseEl.style.display = 'block';
    $('ask-input').value = '';
    // Scroll response into view within the article body
    setTimeout(() => {
      responseEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
  } catch (err) {
    responseEl.className = 'ask-response';
    const msg = err.name === 'AbortError' ? 'Request timed out — please try again.' : err.message;
    responseEl.textContent = '⚠️ ' + msg;
    responseEl.style.display = 'block';
    $('article-body').scrollTo({ top: $('article-body').scrollHeight, behavior: 'smooth' });
  } finally {
    $('ask-send-btn').disabled = false;
  }
}

// ── Refresh button ────────────────────────────────────────────────────────────
$('refresh-btn')?.addEventListener('click', loadNews);
$('drawer-refresh-btn')?.addEventListener('click', () => { closeDrawer(); loadNews(); });

// ── Navigate to End → Feedback ────────────────────────────────────────────────
function goToFeedback() { closeDrawer(); closeArticle(); showScreen('feedback'); }
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
        page: state.previousScreen || 'feed',
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
    setTimeout(() => showScreen(state.previousScreen || 'feed'), 1200);
    // Keep button disabled after success to prevent duplicate submissions
  } catch (err) {
    feedbackMsg.textContent = 'Could not save feedback: ' + err.message;
    feedbackMsg.className = 'feedback-msg show error';
    submitFbBtn.disabled = false; // Only re-enable on error so user can retry
  }
});

// ── Stats Screen ─────────────────────────────────────────────────────────────
$('drawer-stats-btn').addEventListener('click', () => { closeDrawer(); closeArticle(); showScreen('stats'); });
$('stats-back').addEventListener('click', () => showScreen('feed'));

let statsCache = null;
async function loadStats() {
  const loading = $('stats-loading');
  const content = $('stats-content');
  const empty   = $('stats-empty');
  loading.style.display = ''; content.style.display = 'none'; empty.style.display = 'none';
  try {
    const r = await fetch('/api/feedback/public-stats');
    const d = await r.json();
    statsCache = d;
    if (!d.total) { loading.style.display = 'none'; empty.style.display = ''; return; }
    $('stat-total').textContent = d.total;
    $('stat-nps').textContent = d.averageNps;
    $('stat-users').textContent = d.uniqueSessions;
    $('stat-latest').textContent = d.latestEntry ? new Date(d.latestEntry).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
    const detractors = (d.npsDistribution['0-3'] || 0) + (d.npsDistribution['4-6'] || 0);
    const passives = d.npsDistribution['7-8'] || 0;
    const promoters = d.npsDistribution['9-10'] || 0;
    const max = Math.max(detractors, passives, promoters, 1);
    $('nps-bar-detractor').style.width = (detractors / max * 100) + '%';
    $('nps-bar-passive').style.width = (passives / max * 100) + '%';
    $('nps-bar-promoter').style.width = (promoters / max * 100) + '%';
    $('nps-count-detractor').textContent = detractors;
    $('nps-count-passive').textContent = passives;
    $('nps-count-promoter').textContent = promoters;
    loading.style.display = 'none'; content.style.display = '';
  } catch {
    loading.style.display = 'none'; empty.style.display = '';
  }
}

// ── Progress Screen ──────────────────────────────────────────────────────────
$('drawer-progress-btn').addEventListener('click', () => { closeDrawer(); closeArticle(); showScreen('progress'); });
$('progress-back').addEventListener('click', () => showScreen('feed'));

async function loadProgress() {
  const loading = $('progress-loading');
  const content = $('progress-content');
  const empty   = $('progress-empty');
  loading.style.display = ''; content.style.display = 'none'; empty.style.display = 'none';
  try {
    const data = statsCache || await fetch('/api/feedback/public-stats').then(r => r.json());
    if (!data.grades || data.grades.length === 0) { loading.style.display = 'none'; empty.style.display = ''; return; }
    loading.style.display = 'none'; content.style.display = '';
    drawNpsChart(data.grades);
    const latest = data.grades[data.grades.length - 1];
    const avg = data.averageNps;
    $('progress-summary').innerHTML =
      `<strong>${data.grades.length}</strong> feedback response${data.grades.length > 1 ? 's' : ''}. ` +
      `Latest score: <strong>${latest}</strong>. Average: <strong>${avg}</strong>.`;
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

  const isDark = document.body.classList.contains('dark');
  const pad = { top: 20, right: 16, bottom: 36, left: 36 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;

  // Y-axis grid (0–10)
  ctx.strokeStyle = isDark ? '#333' : '#e5e5ea';
  ctx.lineWidth = 0.5;
  ctx.font = '10px -apple-system, system-ui, sans-serif';
  ctx.fillStyle = isDark ? '#8e8e93' : '#8e8e93';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 10; i += 2) {
    const y = pad.top + ch - (i / 10) * ch;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
    ctx.fillText(String(i), pad.left - 6, y + 3);
  }

  // X-axis labels (# feedback)
  ctx.textAlign = 'center';
  const n = grades.length;
  const maxLabels = Math.min(n, 10);
  const step = Math.max(1, Math.floor(n / maxLabels));
  for (let i = 0; i < n; i += step) {
    const x = pad.left + (i / Math.max(n - 1, 1)) * cw;
    ctx.fillText('#' + (i + 1), x, h - 8);
  }
  // Always label the last one
  if (n > 1 && (n - 1) % step !== 0) {
    const x = pad.left + cw;
    ctx.fillText('#' + n, x, h - 8);
  }

  // Points
  const pts = grades.map((g, i) => ({
    x: pad.left + (n === 1 ? cw / 2 : (i / (n - 1)) * cw),
    y: pad.top + ch - (g / 10) * ch,
  }));

  if (n === 1) {
    ctx.fillStyle = '#0062CC';
    ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, 5, 0, Math.PI * 2); ctx.fill();
    return;
  }

  // Area fill
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pad.top + ch);
  pts.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(pts[pts.length - 1].x, pad.top + ch);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + ch);
  grad.addColorStop(0, isDark ? 'rgba(0,98,204,0.3)' : 'rgba(0,98,204,0.15)');
  grad.addColorStop(1, isDark ? 'rgba(0,98,204,0)' : 'rgba(0,98,204,0)');
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.strokeStyle = '#0062CC';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Dots
  ctx.fillStyle = '#0062CC';
  pts.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2); ctx.fill(); });
}

// ── Saved Articles ───────────────────────────────────────────────────────────
$('drawer-saved-btn')?.addEventListener('click', () => {
  closeDrawer();
  closeArticle();
  showScreen('feed');
  state.showingSaved = true;
  state.filteredItems = [...state.savedArticles];
  document.querySelector('.nav-title').textContent = 'Saved';
  renderFeed();
});

// ── Customize Screen ──────────────────────────────────────────────────────────
$('drawer-customize-btn').addEventListener('click', () => { closeDrawer(); closeArticle(); showScreen('customize'); openCustomize(); });
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

  // Restore regions (multi-select)
  const regions = Array.isArray(prefs.regions) ? prefs.regions : (prefs.region && prefs.region !== 'Global' ? [prefs.region] : []);
  document.querySelectorAll('.region-btn').forEach(btn => {
    if (btn.dataset.region === 'Global') {
      btn.classList.toggle('active', regions.length === 0);
    } else {
      btn.classList.toggle('active', regions.includes(btn.dataset.region));
    }
  });

  // Restore sources
  document.querySelectorAll('.source-chip').forEach(chip => {
    chip.classList.toggle('selected', (prefs.sources || []).includes(chip.dataset.source));
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

  // Regions (multi-select)
  const regions = [];
  document.querySelectorAll('.region-btn.active').forEach(b => {
    if (b.dataset.region !== 'Global') regions.push(b.dataset.region);
  });
  state.preferences.regions = regions;
  state.preferences.region = regions.length === 1 ? regions[0] : 'Global';

  // Sources
  const sources = [];
  document.querySelectorAll('.source-chip.selected').forEach(c => sources.push(c.dataset.source));
  state.preferences.sources = sources;

  // Count
  const activeCount = document.querySelector('.count-btn.active');
  state.preferences.count = activeCount ? Number(activeCount.dataset.count) : 8;

  localStorage.setItem('autopmf_prefs', JSON.stringify(state.preferences));
  updateCategoryBar();
}

// Topic chip toggle
document.querySelectorAll('.topic-chip').forEach(chip => {
  chip.addEventListener('click', () => chip.classList.toggle('selected'));
});

// Source chip toggle
document.querySelectorAll('.source-chip').forEach(chip => {
  chip.addEventListener('click', () => chip.classList.toggle('selected'));
});

// Sources select-all / clear-all toggle
$('sources-select-all').addEventListener('click', () => {
  const chips = document.querySelectorAll('.source-chip');
  const allSelected = [...chips].every(c => c.classList.contains('selected'));
  chips.forEach(c => c.classList.toggle('selected', !allSelected));
  $('sources-select-all').textContent = allSelected ? 'Select All' : 'Clear All';
});

// Region multi-select (Global = reset)
document.querySelectorAll('.region-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.region === 'Global') {
      document.querySelectorAll('.region-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    } else {
      document.querySelector('.region-btn[data-region="Global"]').classList.remove('active');
      btn.classList.toggle('active');
      // If none selected, revert to Global
      if (!document.querySelector('.region-btn.active')) {
        document.querySelector('.region-btn[data-region="Global"]').classList.add('active');
      }
    }
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

// ── Settings Modal ───────────────────────────────────────────────────────────
function openSettings()  { settingsModal.classList.add('open'); }
function closeSettings() { settingsModal.classList.remove('open'); }

$('settings-btn').addEventListener('click', () => { closeDrawer(); closeArticle(); openSettings(); });
settingsModal.querySelectorAll('[data-close-modal]').forEach(el =>
  el.addEventListener('click', closeSettings)
);

// ── Dark Mode Toggle ─────────────────────────────────────────────────────────
const darkToggle = $('dark-mode-toggle');
const appEl = document.querySelector('.app');

function applyDarkMode(on) {
  appEl.classList.toggle('dark-mode', on);
  localStorage.setItem('autopmf_dark', on ? '1' : '0');
  darkToggle.checked = on;
}

applyDarkMode(localStorage.getItem('autopmf_dark') === '1');

darkToggle.addEventListener('change', () => {
  applyDarkMode(darkToggle.checked);
});

// ── Large Text toggle ────────────────────────────────────────────────────────
const largeTextToggle = $('large-text-toggle');
function applyLargeText(on) {
  appEl.classList.toggle('large-text', on);
  localStorage.setItem('autopmf_largetext', on ? '1' : '0');
  largeTextToggle.checked = on;
}
applyLargeText(localStorage.getItem('autopmf_largetext') === '1');
largeTextToggle.addEventListener('change', () => applyLargeText(largeTextToggle.checked));

// ── Purple Theme toggle ──────────────────────────────────────────────────────
const purpleToggle = $('purple-theme-toggle');
function applyPurpleTheme(on) {
  appEl.classList.toggle('purple-theme', on);
  localStorage.setItem('autopmf_purple', on ? '1' : '0');
  purpleToggle.checked = on;
}
applyPurpleTheme(localStorage.getItem('autopmf_purple') === '1');
purpleToggle.addEventListener('change', () => applyPurpleTheme(purpleToggle.checked));

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
}

// ── Onboarding (first-run) ──────────────────────────────────────────────────
const ONBOARDED_KEY = 'autopmf_onboarded';

function showOnboarding() {
  const overlay = $('onboarding-overlay');
  overlay.style.display = 'flex';

  // Topic chips toggle
  overlay.querySelectorAll('#onboarding-topics .onboarding-chip').forEach(chip => {
    chip.addEventListener('click', () => chip.classList.toggle('active'));
  });

  // Region chips — multi-select (Global = reset)
  overlay.querySelectorAll('#onboarding-regions .onboarding-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (chip.dataset.region === 'Global') {
        overlay.querySelectorAll('#onboarding-regions .onboarding-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      } else {
        overlay.querySelector('#onboarding-regions .onboarding-chip[data-region="Global"]').classList.remove('active');
        chip.classList.toggle('active');
        if (!overlay.querySelector('#onboarding-regions .onboarding-chip.active')) {
          overlay.querySelector('#onboarding-regions .onboarding-chip[data-region="Global"]').classList.add('active');
        }
      }
    });
  });

  // "Get my news" button
  $('onboarding-go').addEventListener('click', () => {
    // Sanitize name: keep only letters (incl. Unicode), digits, spaces, hyphens, apostrophes
    const rawInput = $('onboarding-name').value.trim().slice(0, 50);
    const name = rawInput.replace(/[^\p{L}\p{N}\s'\-]/gu, '').trim();
    if (name) localStorage.setItem('autopmf_user_name', name);

    const topics = [...overlay.querySelectorAll('#onboarding-topics .onboarding-chip.active')].map(c => c.dataset.topic);
    const regionChips = [...overlay.querySelectorAll('#onboarding-regions .onboarding-chip.active')];
    const regions = regionChips.filter(c => c.dataset.region !== 'Global').map(c => c.dataset.region);
    const region = regions.length === 1 ? regions[0] : 'Global';

    state.preferences.topics = topics;
    state.preferences.regions = regions;
    state.preferences.region = region;
    localStorage.setItem('autopmf_prefs', JSON.stringify(state.preferences));

    // Sync customize screen UI
    document.querySelectorAll('#cust-topics .topic-chip').forEach(c => c.classList.toggle('active', topics.includes(c.dataset.topic)));
    document.querySelectorAll('#cust-regions .region-btn').forEach(c => {
      if (c.dataset.region === 'Global') c.classList.toggle('active', regions.length === 0);
      else c.classList.toggle('active', regions.includes(c.dataset.region));
    });

    finishOnboarding();
  });

  // "Skip" button
  $('onboarding-skip').addEventListener('click', finishOnboarding);
}

function finishOnboarding() {
  localStorage.setItem(ONBOARDED_KEY, '1');
  const overlay = $('onboarding-overlay');
  overlay.style.display = 'none';
  updateCategoryBar();
  loadNews();
  // Welcome toast with user's name so the name field feels purposeful
  const rawName = localStorage.getItem('autopmf_user_name') || '';
  // Re-sanitize at display time: only show greeting if name contains actual letters
  const userName = rawName.replace(/[^\p{L}\p{N}\s'\-]/gu, '').trim();
  if (userName && /\p{L}/u.test(userName)) {
    setTimeout(() => showToast(`Welcome, ${userName}! Your feed is ready.`), 400);
  }
  // Show feedback spotlight after feed has fully settled — long enough that
  // rapid refresh clicks won't trigger it mid-interaction
  if (!localStorage.getItem('autopmf_spotlight_seen')) {
    setTimeout(() => {
      if (!state.loading) showFeedbackSpotlight();
    }, 5000);
  }
}

function showFeedbackSpotlight() {
  const spotlight = $('spotlight-overlay');
  const fab = $('feedback-fab');
  if (!spotlight || !fab) return;
  fab.style.zIndex = '101';
  fab.style.position = 'relative';
  spotlight.style.display = 'flex';
  $('spotlight-dismiss').addEventListener('click', () => {
    spotlight.style.display = 'none';
    fab.style.zIndex = '';
    fab.style.position = '';
    localStorage.setItem('autopmf_spotlight_seen', '1');
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  initMode();
  updateCategoryBar();
  if (!localStorage.getItem(ONBOARDED_KEY)) {
    showOnboarding();
  } else {
    loadNews();
  }
}

init();
