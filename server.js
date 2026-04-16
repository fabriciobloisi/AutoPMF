import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import Anthropic from '@anthropic-ai/sdk';
import { put, get } from '@vercel/blob';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3200;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const FEEDBACK_BLOB = 'feedback/weather/feedback.jsonl';

const app = express();
app.set('trust proxy', 1);

// ── Security middleware ─────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'script-src': ["'self'", 'cdn.jsdelivr.net'],
      'img-src': ["'self'", 'data:', 'https:'],
    },
  },
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(join(__dirname, 'public')));

// ── Rate limiters ───────────────────────────────────────────────────────────
const askLimiter = rateLimit({ windowMs: 60_000, max: 10, message: { error: 'Too many requests, please try again later' } });
const feedbackLimiter = rateLimit({ windowMs: 60_000, max: 5, message: { error: 'Too many requests, please try again later' } });
const getFeedbackLimiter = rateLimit({ windowMs: 60_000, max: 10, message: { error: 'Too many requests, please try again later' } });

// ── Blob helpers ────────────────────────────────────────────────────────────

// Split a raw line that may contain multiple concatenated JSON objects
// (race condition artifact) into individual JSON strings.
function splitJsonLine(line) {
  const results = [];
  let depth = 0, start = 0, inString = false, escape = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const obj = line.slice(start, i + 1).trim();
        if (obj) results.push(obj);
        start = i + 1;
      }
    }
  }
  return results.length > 0 ? results : [line];
}

async function readFeedbackBlob() {
  const result = await get(FEEDBACK_BLOB, { access: 'private' });
  if (!result) return { content: '' };
  const content = await new Response(result.stream).text();
  return { content };
}

async function appendFeedbackEntry(entry) {
  const { content } = await readFeedbackBlob();
  // Normalize existing lines: split any concatenated JSON objects before appending
  const existingLines = content
    ? content.split('\n').flatMap(l => l.trim() ? splitJsonLine(l.trim()) : [])
    : [];
  existingLines.push(JSON.stringify(entry));
  const newContent = existingLines.join('\n');
  const opts = { access: 'private', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0 };
  await put(FEEDBACK_BLOB, newContent, opts);
}

// ── Auth middleware for feedback endpoints ───────────────────────────────────
function requireFeedbackSecret(req, res, next) {
  const secret = process.env.FEEDBACK_SECRET;
  const auth   = req.headers['authorization'] || '';
  const token  = auth.startsWith('Bearer ') ? auth.slice(7) : auth;

  if (!secret) return res.status(503).json({ error: 'FEEDBACK_SECRET env var not set on server' });

  const tokenBuf  = Buffer.from(token);
  const secretBuf = Buffer.from(secret);
  if (tokenBuf.length !== secretBuf.length || !timingSafeEqual(tokenBuf, secretBuf)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── POST /api/news ─ generate fresh news articles via Claude ────────────────
const anthropicClient = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;
const newsLimiter = rateLimit({ windowMs: 60_000, max: 5, message: { error: 'Too many requests, please try again later' } });

const NEWS_SCHEMA = `Return a JSON array of news article objects. Each object must have these fields:
- id: unique alphanumeric string
- headline: clear, compelling, factual (max 90 chars)
- hook: one punchy sentence (max 120 chars) — a hook, NOT a summary
- summary: 2-3 sentence balanced summary
- detail: rich long-form journalism, 6-9 sentences covering what happened, why it matters, context, expert perspective, what's next, human interest
- keyFacts: array of 3 concise facts
- quote: expert quote with attribution, e.g. "This changes everything — Dr. Sarah Chen, MIT"
- category: one of Technology, Business, World, Politics, Science, Sports, Health, Culture, Climate, AI, Entertainment, Finance, Space, Education, Travel, Food, Opinion
- source: short name max 20 chars (Reuters, AP, BBC, Bloomberg, FT, Guardian, Al Jazeera, DW, NHK, SCMP, Nature, Economist, Wired, TechCrunch, ArsTechnica, Verge, WSJ, NYT, WaPo, CNN)
- timeAgo: "Just now" or "X minutes ago" or "X hours ago"
- imageUrl: https://source.unsplash.com/800x500/?keyword1,keyword2,keyword3,keyword4 — use 4-6 specific photojournalistic keywords
- imageAlt: brief caption (10-15 words)
- imageGradient: array of 2 hex colors matching the category
- trending: boolean (max 2 true per batch)
- impact: "local" | "national" | "global"
- readTime: "X min read"
- region: "Global" | "North America" | "Europe" | "Asia" | "Latin America" | "Middle East" | "Africa" | "Oceania"
- tags: array of 3 lowercase tags

IMPORTANT: Return ONLY the JSON array, no markdown fences, no explanation.`;

const GRADIENT_MAP = {
  Technology: ['#0066CC', '#7B2FBE'], Business: ['#FF6B35', '#F7931E'], World: ['#1A936F', '#114B5F'],
  Politics: ['#4A4E69', '#22223B'], Science: ['#00B4D8', '#0077B6'], Sports: ['#52B788', '#1B4332'],
  Health: ['#E63946', '#C1121F'], Culture: ['#9B5DE5', '#F15BB5'], Climate: ['#2D6A4F', '#40916C'],
  AI: ['#7209B7', '#3A0CA3'], Entertainment: ['#E040FB', '#AA00FF'], Finance: ['#FF6D00', '#E65100'],
  Space: ['#1A237E', '#0D47A1'], Education: ['#00695C', '#004D40'], Travel: ['#0277BD', '#01579B'],
  Food: ['#BF360C', '#D84315'], Opinion: ['#4E342E', '#3E2723'],
};

app.post('/api/news', newsLimiter, async (req, res) => {
  if (!anthropicClient) return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured on server' });

  const { topics, count, regions } = req.body || {};
  const articleCount = Math.min(Math.max(Number(count) || 8, 3), 15);

  let topicInstruction = '';
  if (Array.isArray(topics) && topics.length > 0) {
    topicInstruction = `Focus on these categories: ${topics.join(', ')}. Distribute articles across them.`;
  } else {
    topicInstruction = 'Cover a diverse mix of categories.';
  }

  let regionInstruction = '';
  if (Array.isArray(regions) && regions.length > 0 && !regions.includes('Global')) {
    regionInstruction = ` Prioritize news from these regions: ${regions.join(', ')}.`;
  }

  try {
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const response = await anthropicClient.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      system: `You are a world-class news editor generating realistic, editorially diverse, globally representative news articles. Today is ${today}. Write as if these are real breaking and developing current events from today and this week. Reference current dates, recent events, and timely context. Be specific with names, places, numbers. Each article should feel like it belongs in a premium news app.`,
      messages: [{ role: 'user', content: `Generate exactly ${articleCount} news articles as a JSON array.\n\n${topicInstruction}${regionInstruction}\n\n${NEWS_SCHEMA}` }],
    });
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');

    // Parse JSON — handle potential markdown fences
    const cleaned = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
    const articles = JSON.parse(cleaned);

    // Validate and patch gradients
    for (const a of articles) {
      if (!a.imageGradient || a.imageGradient.length !== 2) {
        a.imageGradient = GRADIENT_MAP[a.category] || ['#636e72', '#2d3436'];
      }
    }

    res.json(articles);
  } catch (err) {
    console.error('News generation error:', err.message);
    res.status(500).json({ error: 'Failed to generate news' });
  }
});

// ── POST /api/ask ─ ask Claude about an article ──────────────────────────────

app.post('/api/ask', askLimiter, async (req, res) => {
  if (!anthropicClient) return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured on server' });
  const { question, article } = req.body || {};

  if (!question || typeof question !== 'string') return res.status(400).json({ error: 'Missing question' });
  if (question.length > 300) return res.status(400).json({ error: 'Question too long (max 300 chars)' });

  const truncate = (s, max) => (typeof s === 'string' ? s.slice(0, max) : '');
  const context = article
    ? `Article context:\nHeadline: ${truncate(article.headline, 200)}\nSummary: ${truncate(article.summary, 500)}\nDetail: ${truncate(article.detail, 2000)}\n\nUser question: ${question}`
    : question;

  try {
    const response = await anthropicClient.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 256,
      system: 'You are a knowledgeable news analyst. Answer in 2-3 short sentences max. Be conversational and natural — no bullet points, no markdown headers, no bold text. When referencing the article, quote key phrases in *italics*. Write like a smart friend explaining over coffee.',
      messages: [{ role: 'user', content: context }],
    });
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    res.json({ text });
  } catch (err) {
    console.error('Ask error:', err.message);
    res.status(500).json({ error: 'Failed to get answer' });
  }
});

// ── GET /get/feedback ─ returns feedback JSONL (requires Authorization header) ─
// Query params: ?processed=true|false  ?sessionId=xyz  ?since=ISO  ?limit=N
app.get('/get/feedback', getFeedbackLimiter, requireFeedbackSecret, async (req, res) => {
  try {
    const { content } = await readFeedbackBlob();
    if (!content) return res.status(404).json({ error: 'No feedback yet' });

    const { processed, sessionId, since, limit } = req.query;
    let lines = content.split('\n').filter(l => l.trim());

    if (processed !== undefined) {
      const wantProcessed = processed === 'true';
      // Match stats semantics: missing/false/null = unprocessed; only explicit true = processed
      lines = lines.filter(l => {
        try {
          const e = JSON.parse(l);
          return wantProcessed ? e.processed === true : e.processed !== true;
        } catch {
          return false;
        }
      });
    }
    if (sessionId) {
      lines = lines.filter(l => { try { return JSON.parse(l).sessionId === sessionId; } catch { return false; } });
    }
    if (since) {
      const sinceDate = new Date(since);
      lines = lines.filter(l => { try { return new Date(JSON.parse(l).timestamp) >= sinceDate; } catch { return false; } });
    }
    if (limit) {
      const n = Math.max(1, parseInt(limit, 10) || 50);
      lines = lines.slice(-n);
    }

    if (lines.length === 0) return res.status(404).json({ error: 'No matching feedback' });
    res.type('application/x-ndjson').send(lines.join('\n') + '\n');
  } catch (err) {
    console.error('Feedback read error:', err.message);
    res.status(500).json({ error: 'Failed to read feedback' });
  }
});

// ── GET /get/feedback/stats ─ aggregate feedback statistics ───────────────────
app.get('/get/feedback/stats', getFeedbackLimiter, requireFeedbackSecret, async (req, res) => {
  try {
    const { content } = await readFeedbackBlob();
    if (!content) return res.json({ total: 0, unprocessed: 0, averageNps: 0, npsDistribution: {}, uniqueSessions: 0, latestEntry: null, oldestEntry: null });

    const entries = content.split('\n').filter(l => l.trim()).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

    let total = 0, unprocessed = 0, gradeSum = 0, gradeCount = 0;
    const dist = { '0-3': 0, '4-6': 0, '7-8': 0, '9-10': 0 };
    const sessions = new Set();
    let oldest = null, latest = null;

    for (const e of entries) {
      total++;
      if (!e.processed) unprocessed++;
      if (e.grade != null) {
        gradeSum += e.grade;
        gradeCount++;
        if (e.grade <= 3) dist['0-3']++;
        else if (e.grade <= 6) dist['4-6']++;
        else if (e.grade <= 8) dist['7-8']++;
        else dist['9-10']++;
      }
      if (e.sessionId) sessions.add(e.sessionId);
      if (e.timestamp) {
        if (!oldest || e.timestamp < oldest) oldest = e.timestamp;
        if (!latest || e.timestamp > latest) latest = e.timestamp;
      }
    }

    res.json({
      total,
      unprocessed,
      averageNps: gradeCount ? Math.round((gradeSum / gradeCount) * 10) / 10 : 0,
      npsDistribution: dist,
      uniqueSessions: sessions.size,
      latestEntry: latest,
      oldestEntry: oldest,
    });
  } catch (err) {
    console.error('Feedback stats error:', err.message);
    res.status(500).json({ error: 'Failed to compute stats' });
  }
});

// ── GET /api/feedback/public-stats ─ aggregate stats (no auth) ──────────────
app.get('/api/feedback/public-stats', getFeedbackLimiter, async (req, res) => {
  try {
    const { content } = await readFeedbackBlob();
    if (!content) return res.json({ total: 0, averageNps: 0, npsDistribution: {}, uniqueSessions: 0, latestEntry: null, oldestEntry: null, daily: [] });

    const entries = content.split('\n').filter(l => l.trim()).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

    let total = 0, gradeSum = 0, gradeCount = 0;
    const dist = { '0-3': 0, '4-6': 0, '7-8': 0, '9-10': 0 };
    const sessions = new Set();
    let oldest = null, latest = null;
    const dayMap = {};

    for (const e of entries) {
      total++;
      if (e.grade != null) {
        gradeSum += e.grade;
        gradeCount++;
        if (e.grade <= 3) dist['0-3']++;
        else if (e.grade <= 6) dist['4-6']++;
        else if (e.grade <= 8) dist['7-8']++;
        else dist['9-10']++;
        if (e.timestamp) {
          const day = e.timestamp.slice(0, 10);
          if (!dayMap[day]) dayMap[day] = { sum: 0, count: 0 };
          dayMap[day].sum += e.grade;
          dayMap[day].count++;
        }
      }
      if (e.sessionId) sessions.add(e.sessionId);
      if (e.timestamp) {
        if (!oldest || e.timestamp < oldest) oldest = e.timestamp;
        if (!latest || e.timestamp > latest) latest = e.timestamp;
      }
    }

    // Individual grades in chronological order for the progress chart
    const grades = entries
      .filter(e => e.grade != null && e.timestamp)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .map(e => e.grade);

    res.json({
      total,
      averageNps: gradeCount ? Math.round((gradeSum / gradeCount) * 10) / 10 : 0,
      npsDistribution: dist,
      uniqueSessions: sessions.size,
      latestEntry: latest,
      oldestEntry: oldest,
      grades,
    });
  } catch (err) {
    console.error('Public stats error:', err.message);
    res.status(500).json({ error: 'Failed to compute stats' });
  }
});

// ── POST /api/feedback ─ appends feedback to Vercel Blob ────────────────────
app.post('/api/feedback', feedbackLimiter, async (req, res) => {
  const { grade, comments, suggestion, sessionId } = req.body || {};
  if (grade == null || typeof grade !== 'number' || grade < 0 || grade > 10) {
    return res.status(400).json({ error: 'Grade must be a number between 0 and 10' });
  }

  const safeComments   = typeof comments === 'string' ? comments.slice(0, 2000) : '';
  const safeSuggestion = typeof suggestion === 'string' ? suggestion.slice(0, 2000) : '';
  const safeSessionId  = typeof sessionId === 'string' ? sessionId.slice(0, 64) : 'unknown';

  const entry = {
    timestamp: new Date().toISOString(),
    sessionId: safeSessionId,
    grade,
    comments: safeComments || null,
    suggestion: safeSuggestion || null,
    processed: false,
    processedAt: null,
  };

  try {
    await appendFeedbackEntry(entry);
    res.json({ ok: true });
  } catch (err) {
    console.error('Feedback write error:', err.message);
    res.status(500).json({ error: 'Failed to save feedback' });
  }
});

// ── POST /api/feedback/mark-processed ─ marks unprocessed entries ───────────
app.post('/api/feedback/mark-processed', getFeedbackLimiter, requireFeedbackSecret, async (req, res) => {
  const maxRetries = 5;
  const { timestamps } = req.body || {};
  const scopeSet = Array.isArray(timestamps) && timestamps.length ? new Set(timestamps) : null;

  try {
    const { content } = await readFeedbackBlob();
    if (!content) return res.status(404).json({ error: 'No feedback to process' });

    const now = new Date().toISOString();
    const updatedLines = content.split('\n').flatMap(line => {
      if (!line.trim()) return [];
      // Split concatenated JSON objects caused by race conditions
      return splitJsonLine(line.trim()).map(rawObj => {
        try {
          const entry = JSON.parse(rawObj);
          if (!entry.processed && (!scopeSet || scopeSet.has(entry.timestamp))) {
            entry.processed = true;
            entry.processedAt = now;
          }
          return JSON.stringify(entry);
        } catch {
          return rawObj; // keep malformed lines as-is rather than dropping
        }
      });
    });

    const opts = { access: 'private', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0 };
    await put(FEEDBACK_BLOB, updatedLines.join('\n'), opts);
    return res.json({ ok: true, markedAt: now });
  } catch (err) {
    console.error('Mark processed error:', err.message);
    return res.status(500).json({ error: 'Failed to mark feedback as processed' });
  }
});

// ── Open-Meteo real weather integration ────────────────────────────────────

const WMO_PHRASES = {
  0:'Clear Sky',1:'Mainly Clear',2:'Partly Cloudy',3:'Overcast',
  45:'Fog',48:'Icy Fog',
  51:'Light Drizzle',53:'Drizzle',55:'Heavy Drizzle',
  56:'Freezing Drizzle',57:'Heavy Freezing Drizzle',
  61:'Light Rain',63:'Moderate Rain',65:'Heavy Rain',
  66:'Freezing Rain',67:'Heavy Freezing Rain',
  71:'Light Snow',73:'Moderate Snow',75:'Heavy Snow',77:'Snow Grains',
  80:'Light Showers',81:'Showers',82:'Heavy Showers',
  85:'Snow Showers',86:'Heavy Snow Showers',
  95:'Thunderstorm',96:'Thunderstorm & Hail',99:'Heavy Thunderstorm',
};

function wmoIcon(code, isDay = true) {
  if (code === 0)  return isDay ? 32 : 33;
  if (code === 1)  return isDay ? 34 : 33;
  if (code === 2)  return isDay ? 28 : 27;
  if (code === 3)  return 26;
  if (code === 45 || code === 48) return 20;
  if (code >= 51 && code <= 57)   return 11;
  if (code >= 61 && code <= 67)   return 12;
  if (code >= 71 && code <= 77)   return 16;
  if (code >= 80 && code <= 82)   return 11;
  if (code === 85 || code === 86) return 16;
  if (code >= 95)  return 4;
  return 28;
}

function degCard(deg) {
  return ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(((deg % 360) / 22.5)) % 16];
}
function uvLabel(v)  { return v<=2?'Low':v<=5?'Moderate':v<=7?'High':v<=10?'Very High':'Extreme'; }
function ccLabel(p)  { return p<=10?'Clear':p<=30?'Mostly Clear':p<=60?'Partly Cloudy':p<=85?'Mostly Cloudy':'Cloudy'; }
function moonName(v) {
  if (v<0.03||v>0.97) return 'New Moon';
  if (v<0.22) return 'Waxing Crescent'; if (v<0.28) return 'First Quarter';
  if (v<0.47) return 'Waxing Gibbous';  if (v<0.53) return 'Full Moon';
  if (v<0.72) return 'Waning Gibbous';  if (v<0.78) return 'Last Quarter';
  return 'Waning Crescent';
}
function moonPhaseForDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const jd = Date.UTC(y, m - 1, d) / 86400000 + 2440587.5;
  return ((jd - 2451550.1) % 29.530589 + 29.530589) % 29.530589 / 29.530589;
}
function dateToDow(dateStr) {
  const [y,m,d] = dateStr.split('-').map(Number);
  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(Date.UTC(y, m-1, d, 12)).getUTCDay()];
}

const wxCache = new Map();
const WX_TTL = 5 * 60 * 1000;
const WX_BLOB_TTL = 30 * 60 * 1000; // 30-minute persistent blob cache

async function fetchOMWeather(lat, lon) {
  const key = `wx_${(+lat).toFixed(2)}_${(+lon).toFixed(2)}`;

  // 1. In-memory cache (fastest, per-instance)
  const hit = wxCache.get(key);
  if (hit && Date.now() - hit.ts < WX_TTL) return hit.data;

  // 2. Try live Open-Meteo fetch
  const p = new URLSearchParams({
    latitude: lat, longitude: lon, timezone: 'auto', past_days: 1, forecast_days: 8,
    current: 'temperature_2m,relativehumidity_2m,apparent_temperature,is_day,precipitation,weathercode,cloudcover,windspeed_10m,winddirection_10m,windgusts_10m,pressure_msl,visibility,dewpoint_2m,uv_index',
    hourly: 'temperature_2m,apparent_temperature,relativehumidity_2m,weathercode,windspeed_10m,precipitation_probability',
    daily: 'weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,windspeed_10m_max,winddirection_10m_dominant,sunrise,sunset',
    wind_speed_unit: 'kmh',
  });
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?${p}`);
    if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
    const data = await r.json();
    wxCache.set(key, { ts: Date.now(), data });
    // Persist to Vercel Blob (fire-and-forget) so cold starts can serve cached data
    put(`weather/cache/${key}.json`, JSON.stringify({ ts: Date.now(), data }), {
      access: 'private', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0,
    }).catch(() => {});
    return data;
  } catch (liveErr) {
    // 3. Fall back to Vercel Blob persistent cache
    try {
      const result = await get(`weather/cache/${key}.json`, { access: 'private' });
      if (result) {
        const cached = JSON.parse(await new Response(result.stream).text());
        if (cached?.data && Date.now() - cached.ts < WX_BLOB_TTL) {
          wxCache.set(key, { ts: cached.ts, data: cached.data });
          return cached.data;
        }
      }
    } catch {}
    throw liveErr;
  }
}

const wxLimiter = rateLimit({ windowMs: 60_000, max: 30, message: { error: 'Too many requests' } });

const WEATHER_AQI = {
  airQualityIndex: 45, primaryPollutant: 'O₃',
  pollutants: {
    'PM2.5': { index: 12, amount: 8.2,  unit: 'µg/m³' },
    'PM10':  { index: 18, amount: 18.4, unit: 'µg/m³' },
    'O₃':    { index: 45, amount: 62.1, unit: 'ppb'    },
    'NO₂':   { index: 22, amount: 22.3, unit: 'ppb'    },
    'SO₂':   { index: 3,  amount: 1.2,  unit: 'ppb'    },
    'CO':    { index: 4,  amount: 0.4,  unit: 'ppm'    },
  },
};

const WEATHER_POLLEN = [
  { period: 'Today',     tree: 3, treeLabel: 'High',   grass: 1, grassLabel: 'Low',   ragweed: 0, ragweedLabel: 'None' },
  { period: 'Tomorrow',  tree: 3, treeLabel: 'High',   grass: 1, grassLabel: 'Low',   ragweed: 0, ragweedLabel: 'None' },
  { period: 'Fri',       tree: 2, treeLabel: 'Medium', grass: 2, grassLabel: 'Medium',ragweed: 0, ragweedLabel: 'None' },
  { period: 'Sat',       tree: 1, treeLabel: 'Low',    grass: 1, grassLabel: 'Low',   ragweed: 0, ragweedLabel: 'None' },
  { period: 'Sun',       tree: 2, treeLabel: 'Medium', grass: 1, grassLabel: 'Low',   ragweed: 0, ragweedLabel: 'None' },
];

const APRIL_2026 = (() => {
  const days = [];
  const his = [15,14,13,16,17,18,19,20,18,16,15,14,13,12,13,16,17,18,19,18,17,16,15,14,13,12,13,14,15,16];
  const los = [ 7, 6, 5, 6, 7, 8, 9,10, 9, 7, 6, 5, 5, 5, 6, 8, 9, 9,10, 9, 8, 7, 6, 5, 4, 4, 4, 5, 6, 7];
  const pp  = [ 0, 5,20,10, 0, 0, 0, 0,10,30,25,15,20,80,60,10, 0, 0, 0, 5,10,15,20,10,90,70,30,15, 5, 0];
  const ic  = [34,30,11,28,34,34,34,34,28,11,11,11,11, 1,11,28,34,34,34,30,28,28,11,28, 1, 1,11,28,30,34];
  const cond= ['Sunny','Partly Cloudy','Showers','Partly Cloudy','Sunny','Sunny','Sunny','Sunny','Partly Cloudy','Rain',
               'Rain','Showers','Showers','Heavy Rain','Showers','Partly Cloudy','Sunny','Sunny','Sunny','Partly Cloudy',
               'Partly Cloudy','Partly Cloudy','Showers','Partly Cloudy','Heavy Rain','Heavy Rain','Showers','Partly Cloudy','Partly Cloudy','Sunny'];
  for (let d = 1; d <= 30; d++) {
    days.push({ day: d, iconCode: ic[d-1], high: his[d-1], low: los[d-1], precip: pp[d-1], condition: cond[d-1] });
  }
  return days;
})();

const ALMANAC_APRIL = (() => {
  const days = [];
  for (let d = 1; d <= 30; d++) {
    days.push({ day: d, avgHigh: 13 + Math.round(d/5), avgLow: 5 + Math.round(d/7), avgPrecip: 2.1 });
  }
  return days;
})();

const HISTORY_DATA = (() => {
  const days = [];
  const start = new Date('2026-03-16');
  const precipArr = [0,0,3,15,0,0,8,22,0,0,0,5,12,0,0,0,20,8,0,0,3,0,18,0,0,10,5,0,0,7,0];
  for (let i = 0; i < 31; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const hi  = 10 + Math.round(Math.sin(i/4)*5) + (i%3);
    const lo  = hi - 7 - (i%3);
    const avg = Math.round((hi+lo)/2);
    const pp  = precipArr[i];
    days.push({
      date: d.toISOString().slice(0,10),
      maxTemp: hi, minTemp: lo, avgTemp: avg,
      precip: pp, humidity: 68 + (i%12), windMax: 15 + (i%10),
      iconCode: pp > 10 ? 1 : pp > 0 ? 11 : 34,
    });
  }
  return days;
})();

const SEARCH_DB = {
  amsterdam:  [{ displayName:'Amsterdam',  address:'North Holland, Netherlands', type:'City',    flag:'🇳🇱', countryCode:'NL', lat:52.3676, lon:4.9041,  locId:'EHAM', alt:2  }],
  london:     [{ displayName:'London',     address:'England, United Kingdom',    type:'City',    flag:'🇬🇧', countryCode:'UK', lat:51.5074, lon:-0.1278, locId:'EGLL', alt:11 }],
  paris:      [{ displayName:'Paris',      address:'Île-de-France, France',      type:'City',    flag:'🇫🇷', countryCode:'FR', lat:48.8566, lon:2.3522,  locId:'LFPG', alt:35 }],
  berlin:     [{ displayName:'Berlin',     address:'Berlin, Germany',            type:'City',    flag:'🇩🇪', countryCode:'DE', lat:52.5200, lon:13.4050, locId:'EDDB', alt:37 }],
  rotterdam:  [{ displayName:'Rotterdam',  address:'South Holland, Netherlands', type:'City',    flag:'🇳🇱', countryCode:'NL', lat:51.9244, lon:4.4777,  locId:'EHRD', alt:0  }],
  rome:       [{ displayName:'Rome',       address:'Lazio, Italy',               type:'City',    flag:'🇮🇹', countryCode:'IT', lat:41.9028, lon:12.4964, locId:'LIRF', alt:14 }],
  madrid:     [{ displayName:'Madrid',     address:'Community of Madrid, Spain', type:'City',    flag:'🇪🇸', countryCode:'ES', lat:40.4168, lon:-3.7038, locId:'LEMD', alt:582}],
  barcelona:  [{ displayName:'Barcelona',  address:'Catalonia, Spain',           type:'City',    flag:'🇪🇸', countryCode:'ES', lat:41.3851, lon:2.1734,  locId:'LEBL', alt:4  }],
  vienna:     [{ displayName:'Vienna',     address:'Austria',                    type:'City',    flag:'🇦🇹', countryCode:'AT', lat:48.2082, lon:16.3738, locId:'LOWW', alt:183}],
  prague:     [{ displayName:'Prague',     address:'Bohemia, Czech Republic',    type:'City',    flag:'🇨🇿', countryCode:'CZ', lat:50.0755, lon:14.4378, locId:'LKPR', alt:381}],
  'new york': [{ displayName:'New York',   address:'New York, USA',              type:'City',    flag:'🇺🇸', countryCode:'US', lat:40.7128, lon:-74.006, locId:'KJFK', alt:3  }],
  tokyo:      [{ displayName:'Tokyo',      address:'Kanto, Japan',               type:'City',    flag:'🇯🇵', countryCode:'JP', lat:35.6762, lon:139.6503,locId:'RJTT', alt:6  }],
};

app.get('/api/weather/current', wxLimiter, async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat) || 52.3676;
    const lon = parseFloat(req.query.lon) || 4.9041;
    const station = String(req.query.station || '').slice(0, 60) || `${lat.toFixed(2)}°N`;
    const d = await fetchOMWeather(lat, lon);
    const c = d.current, dl = d.daily;
    const today = new Date().toISOString().slice(0, 10);
    const ti = dl.time.findIndex(t => t === today);
    const tidx = ti >= 0 ? ti : 1;
    const isDay = c.is_day === 1;
    const pressCode = c.pressure_msl >= 1013 ? 1 : c.pressure_msl <= 1005 ? -1 : 0;
    res.json({
      stationName: station,
      obsTimeLocal: c.time + ':00',
      temperature: Math.round(c.temperature_2m),
      feelsLike: Math.round(c.apparent_temperature),
      humidity: c.relativehumidity_2m,
      dewPoint: Math.round(c.dewpoint_2m),
      windSpeed: Math.round(c.windspeed_10m),
      windDirectionCardinal: degCard(c.winddirection_10m),
      windDirection: c.winddirection_10m,
      windGust: Math.round(c.windgusts_10m),
      pressureMeanSeaLevel: Math.round(c.pressure_msl * 10) / 10,
      pressureTendencyTrend: pressCode > 0 ? 'Rising' : pressCode < 0 ? 'Falling' : 'Steady',
      pressureTendencyCode: pressCode,
      visibility: Math.round(c.visibility / 1000 * 10) / 10,
      uvIndex: Math.round(c.uv_index),
      uvDescription: uvLabel(c.uv_index),
      cloudCover: c.cloudcover,
      cloudCoverPhrase: ccLabel(c.cloudcover),
      iconCode: wmoIcon(c.weathercode, isDay),
      wxPhraseLong: WMO_PHRASES[c.weathercode] || 'Unknown',
      precip1Hour: Math.round((c.precipitation || 0) * 10) / 10,
      precip6Hour: 0,
      precip24Hour: Math.round((dl.precipitation_sum?.[tidx] || 0) * 10) / 10,
      snow24Hour: 0,
      sunriseTimeLocal: dl.sunrise?.[tidx] || '',
      sunsetTimeLocal: dl.sunset?.[tidx] || '',
      temperatureMax24Hour: Math.round(dl.temperature_2m_max?.[tidx] || 0),
      temperatureMin24Hour: Math.round(dl.temperature_2m_min?.[tidx] || 0),
      temperatureChange24Hour: tidx > 0
        ? Math.round((dl.temperature_2m_max[tidx] - dl.temperature_2m_max[tidx - 1]) * 10) / 10
        : 0,
      shortRangeForecast: `${WMO_PHRASES[c.weathercode] || 'Unknown'}. High ${Math.round(dl.temperature_2m_max?.[tidx] || 0)}°C today.`,
    });
  } catch (err) {
    console.error('Weather current error:', err.message);
    res.status(500).json({ error: 'Weather data unavailable' });
  }
});

app.get('/api/weather/forecast', wxLimiter, async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat) || 52.3676;
    const lon = parseFloat(req.query.lon) || 4.9041;
    const d = await fetchOMWeather(lat, lon);
    const dl = d.daily;
    const today = new Date().toISOString().slice(0, 10);
    const si = Math.max(0, dl.time.findIndex(t => t === today));
    const result = [];
    for (let i = 0; i < 7 && (si + i) < dl.time.length; i++) {
      const idx = si + i;
      const high = Math.round(dl.temperature_2m_max[idx]);
      const low  = Math.round(dl.temperature_2m_min[idx]);
      const precipChance = dl.precipitation_probability_max[idx] || 0;
      const windSpeed = Math.round(dl.windspeed_10m_max[idx]);
      const windDir = degCard(dl.winddirection_10m_dominant[idx] || 0);
      const code = dl.weathercode[idx];
      const phrase = WMO_PHRASES[code] || 'Unknown';
      let narrative = `${phrase}. High ${high}°C, low ${low}°C`;
      if (precipChance > 50) narrative += `. ${precipChance}% rain chance`;
      if (windSpeed > 25) narrative += `. Windy at ${windSpeed} km/h`;
      result.push({
        dow: dateToDow(dl.time[idx]),
        narrative,
        iconCode: wmoIcon(code, true),
        high, low, precipChance, windDir, windSpeed,
        moonPhase: moonName(moonPhaseForDate(dl.time[idx])),
      });
    }
    res.json(result);
  } catch (err) {
    console.error('Weather forecast error:', err.message);
    res.status(500).json({ error: 'Forecast unavailable' });
  }
});

app.get('/api/weather/hourly', wxLimiter, async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat) || 52.3676;
    const lon = parseFloat(req.query.lon) || 4.9041;
    const d = await fetchOMWeather(lat, lon);
    const h = d.hourly;
    const today = new Date().toISOString().slice(0, 10);
    const si = h.time.findIndex(t => t.startsWith(today));
    const startIdx = si >= 0 ? si : 24;
    const result = [];
    for (let i = 0; i < 24 && (startIdx + i) < h.time.length; i++) {
      const idx = startIdx + i;
      result.push({
        hour: i,
        iconCode: wmoIcon(h.weathercode[idx], i >= 6 && i <= 20),
        temp: Math.round(h.temperature_2m[idx]),
        feelsLike: Math.round(h.apparent_temperature[idx]),
        humidity: h.relativehumidity_2m[idx],
        windSpeed: Math.round(h.windspeed_10m[idx]),
        precipChance: h.precipitation_probability[idx] || 0,
      });
    }
    res.json(result);
  } catch (err) {
    console.error('Weather hourly error:', err.message);
    res.status(500).json({ error: 'Hourly data unavailable' });
  }
});

app.get('/api/weather/aqi', (req, res) => {
  res.json(WEATHER_AQI);
});

app.get('/api/weather/pollen', (req, res) => {
  res.json(WEATHER_POLLEN);
});

app.get('/api/weather/calendar', (req, res) => {
  const { month = 4, year = 2026 } = req.query;
  res.json(APRIL_2026);
});

app.get('/api/weather/almanac', (req, res) => {
  res.json(ALMANAC_APRIL);
});

app.get('/api/weather/history', (req, res) => {
  res.json(HISTORY_DATA);
});

app.get('/api/weather/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q) return res.json([]);
  const results = [];
  for (const [key, entries] of Object.entries(SEARCH_DB)) {
    if (key.includes(q) || entries.some(e => e.displayName.toLowerCase().includes(q))) {
      results.push(...entries);
    }
  }
  res.json(results.slice(0, 8));
});

app.listen(PORT, () => {
  console.log(`AutoPMF running at http://localhost:${PORT}`);
});
