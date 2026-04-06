import express from 'express';
import { readFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3200;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const app = express();
const feedbackStore = [];   // in-memory fallback when filesystem is read-only (Vercel)

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

// ── GET /get/feedback ─ returns Feedback.txt (requires Authorization header) ─
app.get('/get/feedback', getFeedbackLimiter, async (req, res) => {
  const secret = process.env.FEEDBACK_SECRET;
  const auth   = req.headers['authorization'] || '';
  const token  = auth.startsWith('Bearer ') ? auth.slice(7) : auth;

  if (!secret) return res.status(503).json({ error: 'FEEDBACK_SECRET env var not set on server' });

  // Timing-safe comparison to prevent brute-force attacks
  const tokenBuf  = Buffer.from(token);
  const secretBuf = Buffer.from(secret);
  if (tokenBuf.length !== secretBuf.length || !timingSafeEqual(tokenBuf, secretBuf)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let fileContent = '';
  try {
    fileContent = await readFile(join(__dirname, 'Feedback.txt'), 'utf8');
  } catch (_) { /* file may not exist on Vercel */ }

  const memContent = feedbackStore.join('');
  const combined = fileContent + memContent;

  if (!combined) return res.status(404).json({ error: 'No feedback yet' });
  res.type('text/plain').send(combined);
});

// ── POST /api/feedback ─ appends feedback to Feedback.txt ───────────────────
app.post('/api/feedback', feedbackLimiter, async (req, res) => {
  const { grade, comments, suggestion } = req.body || {};
  if (grade == null || typeof grade !== 'number' || grade < 0 || grade > 10) {
    return res.status(400).json({ error: 'Grade must be a number between 0 and 10' });
  }

  const safeComments   = typeof comments === 'string' ? comments.slice(0, 2000) : '';
  const safeSuggestion = typeof suggestion === 'string' ? suggestion.slice(0, 2000) : '';

  const entry =
    `── ${new Date().toISOString()} ──────────────────────────────\n` +
    `Grade: ${grade}/10\n` +
    `Comments: ${safeComments || '(none)'}\n` +
    `Suggestion: ${safeSuggestion || '(none)'}\n\n`;

  try {
    await appendFile(join(__dirname, 'Feedback.txt'), entry, 'utf8');
  } catch (_) {
    // Vercel filesystem is read-only; store in memory so GET can retrieve it
    feedbackStore.push(entry);
  }
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`AutoPMF running at http://localhost:${PORT}`);
});
