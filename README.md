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

### 2. Set Up Blob Storage

```bash
vercel blob create-store feedback --access private
vercel env pull   # pulls BLOB_READ_WRITE_TOKEN into .env.local
```

### 3. Add Environment Variables

In the Vercel dashboard under **Settings > Environment Variables**:

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key (starts with `sk-ant-`) used for all Claude requests |
| `FEEDBACK_SECRET` | Yes | A secret token you choose. Used as Bearer token to access `GET /get/feedback` |
| `BLOB_READ_WRITE_TOKEN` | Yes | Auto-created when linking the blob store. Used for Vercel Private Blob Storage |

### 4. Deploy

```bash
vercel --prod
```

## Feedback API

Feedback is stored as JSONL in Vercel Private Blob Storage. To retrieve all collected feedback:

```bash
curl -H "Authorization: Bearer $FEEDBACK_SECRET" https://your-domain.com/get/feedback
```

To mark all entries as processed:

```bash
curl -X POST -H "Authorization: Bearer $FEEDBACK_SECRET" https://your-domain.com/api/feedback/mark-processed
```

Or use the helper script which does both:

```bash
./getFeedback.sh
```

## The AutoLoop — Self-Improving Cycle

### Run it
Prompt Claude code or similair agents with `Start the @autoloop.md`

### Inner working

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
5. **Improve** — Claude brainstorms fixes and updates `product.md` (the master prompt that controls all content)
6. **Ship** — Changes are committed, pushed, and deployed with `vercel --prod`
7. **Wait** — Sleep 10 minutes, then loop back to step 4

### Key files

| File | Role |
|------|------|
| `product.md` | Master prompt — governs all news content and behaviour. Updated every iteration |
| `Feedback.txt` | Historical feedback archive (legacy) |
| `autoloop.md` | Detailed AutoLoop instructions and iteration log |

### Target

The loop runs until 3 consecutive feedback batches average NPS 9+, indicating Product Market Fit.

## Notes

Additionally you can verify changes before pushing to prod using Claude's built-in browser and inspect tools.

### Suggested Permission file

```json
{
  "permissions": {
    "allow": [
      "Bash(export PATH=\"/opt/homebrew/bin:$PATH\")",
      "Bash(vercel env:*)",
      "Bash(vercel --prod --yes)",
      "Bash(ANTHROPIC_API_KEY=test-key node -e \":*)",
      "Bash(bash:*)",
      "Bash(git checkout:*)",
      "Bash(git add:*)",
      "Bash(git commit -m ':*)",
      "Bash(git push:*)",
      "Bash(vercel --prod)",
    ]
  }
}
```

