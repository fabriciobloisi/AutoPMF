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

// ── Weather Mock API (field names match weather.js WU-style expectations) ─────

const WEATHER_CURRENT = {
  stationName: 'Amsterdam Schiphol',
  obsTimeLocal: '2026-04-15T23:04:00+02:00',
  temperature: 13, temperatureMax24Hour: 19, temperatureMin24Hour: 8,
  feelsLike: 11, dewPoint: 8,
  humidity: 74,
  precip1Hour: 0.0, precip6Hour: 0.0, precip24Hour: 0.0, snow24Hour: 0,
  windSpeed: 10, windDirectionCardinal: 'S', windDirection: 180, windGust: 18,
  pressureMeanSeaLevel: 1017.9, pressureTendencyTrend: 'Steady', pressureTendencyCode: 0,
  visibility: 10,
  uvIndex: 0, uvDescription: 'Low',
  cloudCover: 40, cloudCoverPhrase: 'Partly Cloudy',
  iconCode: 29, wxPhraseLong: 'Partly Cloudy',
  sunriseTimeLocal: '2026-04-15T06:26:00+02:00', sunsetTimeLocal: '2026-04-15T20:35:00+02:00',
  shortRangeForecast: 'Partly cloudy skies, mild temperatures near 13°C with southerly breeze.',
  temperatureChange24Hour: 2,
};

const WEATHER_FORECAST = [
  { dow: 'Wed', narrative: 'Partly cloudy with a pleasant 19°C high. Light south winds.', iconCode: 34, high: 19, low: 8, precipChance: 10, windDir: 'S', windSpeed: 10, moonPhase: 'Waxing Crescent' },
  { dow: 'Thu', narrative: 'Rain likely with heavy periods. High near 16°C.', iconCode: 12, high: 16, low: 9, precipChance: 80, windDir: 'SW', windSpeed: 20, moonPhase: 'First Quarter' },
  { dow: 'Fri', narrative: 'Mostly sunny skies return. High 19°C.', iconCode: 34, high: 19, low: 8, precipChance: 15, windDir: 'NW', windSpeed: 12, moonPhase: 'Waxing Gibbous' },
  { dow: 'Sat', narrative: 'Showers likely especially morning. High 15°C.', iconCode: 11, high: 15, low: 7, precipChance: 60, windDir: 'W', windSpeed: 16, moonPhase: 'Waxing Gibbous' },
  { dow: 'Sun', narrative: 'Partly cloudy, chance of afternoon showers. High 14°C.', iconCode: 28, high: 14, low: 6, precipChance: 30, windDir: 'SW', windSpeed: 11, moonPhase: 'Waxing Gibbous' },
  { dow: 'Mon', narrative: 'Heavy rain expected. Windy with gusts to 45 km/h. High 12°C.', iconCode: 1, high: 12, low: 6, precipChance: 90, windDir: 'SW', windSpeed: 28, moonPhase: 'Full Moon' },
  { dow: 'Tue', narrative: 'Clearing skies after overnight rain. High 13°C.', iconCode: 30, high: 13, low: 4, precipChance: 20, windDir: 'N', windSpeed: 9, moonPhase: 'Waning Gibbous' },
];

const WEATHER_HOURLY = (() => {
  const hrs = [];
  const temps =  [10,9,9,9,8,8,9,10,11,12,13,15,17,18,19,19,18,17,16,15,14,13,13,13];
  const feels =  [ 8,7,7,7,6,6,7, 8, 9,10,11,13,15,16,17,17,16,15,14,13,12,11,11,11];
  const icons =  [29,29,29,33,33,33,34,34,34,30,30,28,28,28,34,34,30,30,28,28,28,29,29,29];
  const precip = [ 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 5,10,10,10, 5, 5, 5, 5,10,10,10, 5, 5, 5];
  const wind =   [ 6, 6, 5, 5, 5, 4, 5, 6, 7, 8, 9,10,11,11,10,10, 9, 9, 8, 8, 7, 7, 7, 6];
  const hum =    [78,79,80,80,81,81,80,79,78,77,76,74,72,70,68,67,68,70,72,74,75,76,77,78];
  for (let h = 0; h < 24; h++) {
    hrs.push({ hour: h, iconCode: icons[h],
      temp: temps[h], feelsLike: feels[h], humidity: hum[h],
      windSpeed: wind[h], precipChance: precip[h],
    });
  }
  return hrs;
})();

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

app.get('/api/weather/current', (req, res) => {
  const { lat, lon } = req.query;
  // For mock purposes return Amsterdam data for any coordinates
  res.json(WEATHER_CURRENT);
});

app.get('/api/weather/forecast', (req, res) => {
  res.json(WEATHER_FORECAST);
});

app.get('/api/weather/hourly', (req, res) => {
  res.json(WEATHER_HOURLY);
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
