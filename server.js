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
const FEEDBACK_BLOB = 'feedback/news/feedback.jsonl';

const app = express();
app.set('trust proxy', 1);

// ── Security middleware ─────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
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
async function readFeedbackBlob() {
  const result = await get(FEEDBACK_BLOB, { access: 'private' });
  if (!result) return { content: '' };
  const content = await new Response(result.stream).text();
  return { content };
}

async function appendFeedbackEntry(entry) {
  const { content } = await readFeedbackBlob();
  const newContent = content
    ? content.trimEnd() + '\n' + JSON.stringify(entry)
    : JSON.stringify(entry);
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
    const updatedLines = content.split('\n').map(line => {
      if (!line.trim()) return line;
      const entry = JSON.parse(line);
      if (!entry.processed && (!scopeSet || scopeSet.has(entry.timestamp))) {
        entry.processed = true;
        entry.processedAt = now;
      }
      return JSON.stringify(entry);
    });

    const opts = { access: 'private', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0 };
    await put(FEEDBACK_BLOB, updatedLines.join('\n'), opts);
    return res.json({ ok: true, markedAt: now });
  } catch (err) {
    console.error('Mark processed error:', err.message);
    return res.status(500).json({ error: 'Failed to mark feedback as processed' });
  }
});

app.listen(PORT, () => {
  console.log(`AutoPMF running at http://localhost:${PORT}`);
});
