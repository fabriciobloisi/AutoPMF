import express from 'express';
import { readFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3200;

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(express.static(join(__dirname, 'public')));

// ── GET /api/control ─ returns ControlNews.md ────────────────────────────────
app.get('/api/control', async (_req, res) => {
  try {
    const content = await readFile(join(__dirname, 'ControlNews.md'), 'utf8');
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: 'Could not read ControlNews.md', detail: err.message });
  }
});

// ── POST /api/news ─ generates news articles via Claude ──────────────────────
app.post('/api/news', async (req, res) => {
  const { apiKey, systemPrompt, preferences } = req.body || {};
  if (!apiKey) return res.status(400).json({ error: 'Missing API key' });

  // Build the user request from preferences
  const topics = preferences?.topics?.length ? preferences.topics.join(', ') : 'general global';
  const region = preferences?.region || 'Global';
  const count  = Math.min(Math.max(Number(preferences?.count) || 8, 5), 20);
  const lang   = preferences?.language || 'English';

  const userMsg =
    `Generate exactly ${count} news articles. ` +
    `Topics: ${topics}. Region focus: ${region}. Language: ${lang}. ` +
    `Return only the JSON array, nothing else.`;

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      system: systemPrompt || 'You are a news aggregator AI. Return only valid JSON arrays of news items.',
      messages: [{ role: 'user', content: userMsg }],
    });

    const rawText = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    // Extract JSON array from response (strip markdown fences if Claude adds them)
    let jsonText = rawText.trim();
    const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonText = fenceMatch[1].trim();
    } else {
      const arrMatch = jsonText.match(/\[[\s\S]*\]/);
      if (arrMatch) jsonText = arrMatch[0];
    }

    const news = JSON.parse(jsonText);

    // Ensure every item has an id
    news.forEach((item, i) => {
      if (!item.id) item.id = `news-${Date.now()}-${i}`;
    });

    res.json({ news });
  } catch (err) {
    console.error('News generation error:', err.message);
    res.status(500).json({ error: 'Failed to generate news', detail: err.message });
  }
});

// ── POST /api/ask ─ ask Claude about an article ──────────────────────────────
app.post('/api/ask', async (req, res) => {
  const { apiKey, systemPrompt, question, article } = req.body || {};
  if (!apiKey) return res.status(400).json({ error: 'Missing API key' });

  const context = article
    ? `Article context:\nHeadline: ${article.headline}\nSummary: ${article.summary}\nDetail: ${article.detail}\n\nUser question: ${question}`
    : question;

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt || 'You are a knowledgeable news analyst. Answer questions about news articles concisely and accurately.',
      messages: [{ role: 'user', content: context }],
    });
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    res.json({ text });
  } catch (err) {
    console.error('Ask error:', err.message);
    res.status(500).json({ error: 'Failed to get answer', detail: err.message });
  }
});

// ── POST /api/feedback ─ appends feedback to Feedback.txt ───────────────────
app.post('/api/feedback', async (req, res) => {
  const { grade, comments, suggestion } = req.body || {};
  if (grade == null) return res.status(400).json({ error: 'Missing grade' });

  const entry =
    `── ${new Date().toISOString()} ──────────────────────────────\n` +
    `Grade: ${grade}/10\n` +
    `Comments: ${comments || '(none)'}\n` +
    `Suggestion: ${suggestion || '(none)'}\n\n`;

  try {
    await appendFile(join(__dirname, 'Feedback.txt'), entry, 'utf8');
  } catch (_) {
    // Vercel filesystem is read-only; log to console instead
    console.log('[FEEDBACK]', entry);
  }
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`AutoPMF running at http://localhost:${PORT}`);
});
