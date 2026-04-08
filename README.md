# Auto PMF

Automate the Product Market Fit cycle. Feedback in, product out.

<p align="center">
  <img src="screenshots/homepage.png" alt="AutoPMF news feed" width="300" />
  <img src="screenshots/feedback.png" alt="AutoPMF feedback screen" width="300" />
</p>

## How Feedback Drives the Product

AutoPMF is built around one idea: **users shape the product, not developers**. The app serves an AI-curated news feed, and after browsing, users are asked to grade their experience on a 0–10 scale (NPS-style) and leave open-ended comments — what they liked, what felt off, and what they'd improve. A second prompt asks specifically for suggestions to make the service better.

This feedback is the engine of the entire system. When new user feedback arrives, an AI agent reads it, identifies patterns, and autonomously updates the app's master prompt (`product.md`) — the single file that governs what content is shown and how the app behaves. The changes are committed, pushed, and redeployed automatically. No human reviews or approves the changes. The cycle repeats until users consistently rate the experience 9+ out of 10, at which point the app has reached Product-Market Fit.

## Run It

### 1. Add permissions

Copy the following JSON into `.claude/settings.local.json` in your project root. This pre-approves the bash, git, deploy, and skill commands the loop needs so Claude can run autonomously without prompting you for each action:

```json
{
  "permissions": {
    "allow": [
      "Bash(export PATH=\"/opt/homebrew/bin:$PATH\")",
      "Bash(vercel env:*)",
      "Bash(vercel --prod --yes)",
      "Bash(bash:*)",
      "Bash(git checkout:*)",
      "Bash(git add:*)",
      "Bash(git commit -m ':*)",
      "Bash(git push:*)",
      "Bash(vercel --prod)",
      "WebFetch(domain:auto-pmf.vercel.app)",
      "Bash(vercel ls:*)",
      "mcp__Claude_Preview__preview_start",
      "Skill(autoloop-prepare)",
      "Skill(autoloop-prepare:*)",
      "Skill(autoloop-feedback)",
      "Skill(autoloop-feedback:*)",
      "Skill(autoloop-deploy)",
      "Skill(autoloop-deploy:*)"
    ]
  }
}
```

### 2. Start the loop

```
/autoloop
```

That's it. Claude runs a continuous session, looping through three phases:

1. **Prepare** — Reads the codebase, checks deployment health, establishes NPS baseline
2. **Feedback** — Polls for new feedback (blocks until it arrives), plans the change, builds it
3. **Deploy** — Commits, pushes, deploys to Vercel, logs the cycle

After deploying, it loops back to step 1 and waits for new feedback. Claude only uses tokens when there is actual work to do — the polling happens in a shell script, not in the LLM.

To stop the loop:

```
/cancel-autoloop
```

### Stop conditions

1. **PMF reached** — 3 consecutive cycles with NPS >= 9.0
2. **User cancel** — `/cancel-autoloop`
3. **Deploy failure** — 2 consecutive `vercel --prod` failures

```mermaid
graph LR
    A[Deploy to Vercel] --> B[Users browse news]
    B --> C[Users submit feedback]
    C --> D[Claude polls for feedback]
    D --> E[Claude plans changes]
    E --> F[Claude builds changes]
    F --> G[Git commit & push]
    G --> A
```

### Command structure

```
.claude/commands/
  autoloop.md              # /autoloop — orchestrates the forever loop
  autoloop-prepare.md      # Phase 1: read state, check deployment
  autoloop-feedback.md     # Phase 2: fetch, parse, plan, build
  autoloop-deploy.md       # Phase 3: commit, push, deploy, log
  cancel-autoloop.md       # /cancel-autoloop — stop the loop
scripts/
  setup-autoloop.sh        # Initialize state file on first run
  autoloop-cycle.sh        # Orchestrator: poll, ship, log, advance, status
```

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
| `DEPLOY_URL` | Yes | Your Vercel production URL (e.g. `https://autopmf.vercel.app`). Used by `getFeedback.sh` |
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

## Key Files

| File | Role |
|------|------|
| `product.md` | Master prompt — governs all news content and behaviour. Updated every iteration |
| `autoloop.md` | Iteration log, rules, and stop conditions |
| `local_feedback.jsonl` | Incremental feedback log (used by polling script) |
| `results.tsv` | Machine-readable experiment log (cycle, date, NPS, status, description) |
| `.claude/autoloop-state.local.md` | Loop state. Deleted on cancel or PMF |

## Notes

Additionally you can verify changes before pushing to prod using Claude's built-in browser and inspect tools.
