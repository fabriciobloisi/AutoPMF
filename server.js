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
  if (!result) return { content: '', etag: null };
  const content = await new Response(result.stream).text();
  return { content, etag: result.blob.etag };
}

async function appendFeedbackEntry(entry, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const { content, etag } = await readFeedbackBlob();
    const newContent = content
      ? content.trimEnd() + '\n' + JSON.stringify(entry)
      : JSON.stringify(entry);
    try {
      const opts = { access: 'private', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 };
      if (etag) opts.ifMatch = etag;
      await put(FEEDBACK_BLOB, newContent, opts);
      return;
    } catch (err) {
      if (attempt < retries && err.code === 'blob_store_condition_not_met') continue;
      throw err;
    }
  }
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

// ── POST /api/ask ─ ask Claude about an article ──────────────────────────────
const anthropicClient = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

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
      max_tokens: 1024,
      system: 'You are a knowledgeable news analyst. Answer questions about news articles concisely and accurately.',
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
app.get('/get/feedback', getFeedbackLimiter, requireFeedbackSecret, async (req, res) => {
  try {
    const { content } = await readFeedbackBlob();
    if (!content) return res.status(404).json({ error: 'No feedback yet' });
    res.type('application/x-ndjson').send(content);
  } catch (err) {
    console.error('Feedback read error:', err.message);
    res.status(500).json({ error: 'Failed to read feedback' });
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
  try {
    const { content, etag } = await readFeedbackBlob();
    if (!content) return res.status(404).json({ error: 'No feedback to process' });

    const now = new Date().toISOString();
    const updatedLines = content.split('\n').map(line => {
      if (!line.trim()) return line;
      const entry = JSON.parse(line);
      if (!entry.processed) {
        entry.processed = true;
        entry.processedAt = now;
      }
      return JSON.stringify(entry);
    });

    const opts = { access: 'private', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 };
    if (etag) opts.ifMatch = etag;
    await put(FEEDBACK_BLOB, updatedLines.join('\n'), opts);
    res.json({ ok: true, markedAt: now });
  } catch (err) {
    console.error('Mark processed error:', err.message);
    res.status(500).json({ error: 'Failed to mark feedback as processed' });
  }
});

app.listen(PORT, () => {
  console.log(`AutoPMF running at http://localhost:${PORT}`);
});
