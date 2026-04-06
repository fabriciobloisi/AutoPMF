# Auto PMF

Automate the Product Market Fit cycle. Feedback in, product out.

## Local Development

```bash
npm install
cp .env.example .env   # then fill in your keys
source .env && npm start
```

The app runs at `http://localhost:3200`. For watch mode: `source .env && npm run dev`

## Deploy to Vercel

### 1. Import in Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your GitHub repository
3. Vercel auto-detects the configuration from `vercel.json`

### 2. Add Environment Variables

In the Vercel dashboard under **Settings > Environment Variables**:

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key (starts with `sk-ant-`) used for all Claude requests |
| `FEEDBACK_SECRET` | Yes | A secret token you choose. Used as Bearer token to access `GET /get/feedback` |

### 3. Deploy

```bash
vercel --prod
```

## Feedback API

Users submit feedback through the app UI. To retrieve all collected feedback:

```bash
curl -H "Authorization: Bearer $FEEDBACK_SECRET" https://your-domain.com/get/feedback
```

## The AutoLoop — Self-Improving Cycle

AutoPMF continuously improves itself through a feedback-driven loop. Every 10 minutes, Claude reads user feedback, updates the app, and redeploys — no human in the loop.

```mermaid
graph LR
    A[Deploy to Vercel] --> B[Users browse news]
    B --> C[Users submit feedback]
    C --> D[Claude reads feedback]
    D --> E[Claude updates app]
    E --> F[Git commit & push]
    F --> A
    F --> G[Sleep 10 min]
    G --> D
```

### How it works

1. **Deploy** — Run `vercel --prod` to deploy
2. **Use** — Users browse the news feed, read articles, ask Claude questions
3. **Feedback** — Users rate the experience (0–10 NPS) and leave suggestions via the app's "End" button
4. **Read** — Claude fetches new feedback from `GET /get/feedback`
5. **Improve** — Claude brainstorms fixes and updates `mote.md` (the master prompt that controls all content)
6. **Ship** — Changes are committed, pushed, and deployed with `vercel --prod`
7. **Wait** — Sleep 10 minutes, then loop back to step 4

### Key files

| File | Role |
|------|------|
| `mote.md` | Master prompt — governs all news content and behaviour. Updated every iteration |
| `Feedback.txt` | Append-only log of user feedback |
| `autoloop.md` | Detailed AutoLoop instructions and iteration log |

### Target

The loop runs until 3 consecutive feedback batches average NPS 9+, indicating Product Market Fit.

## Notes

Additionally you can verify changes before pushing to prod using Claude's built-in browser and inspect tools.
