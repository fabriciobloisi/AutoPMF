# AutoLoop — Instructions for Iterating AutoPMF

AutoLoop is the feedback-driven improvement cycle for AutoPMF. Each iteration reads user feedback, summarises it, generates improvement ideas, updates `ControlNews.md`, and republishes — with the goal of continuously raising NPS until the product reaches Product Market Fit.

---

## How to Run an AutoLoop Iteration

### Step 1 — Read Feedback.txt

Open `Feedback.txt`. Only process feedback entries that appear **after the most recent AutoLoop Summary block** (marked with `── AUTOLOOP SUMMARY`). If no summary block exists, process all entries.

### Step 1b — No Feedback Case

If there are **no new feedback entries** after the most recent `AUTOLOOP SUMMARY` block, append the following line to `Feedback.txt` and stop:

```
── <ISO 8601 datetime> — No Feedback in last Loop
```

Do not update `ControlNews.md` or redeploy. Wait for new user feedback before the next iteration.

### Step 2 — Summarise the Feedback

Compute:
- **Number of feedback entries** processed in this batch
- **Average NPS** (Grade field, scale 0–10)
- **Common themes** — group comments and suggestions into recurring patterns
- **Top complaints** — rank by frequency
- **Top suggestions** — rank by frequency

Append the following block to `Feedback.txt` immediately after the last processed entry:

```
── AUTOLOOP SUMMARY ─────────────────────────────────────
Processed at: <ISO 8601 datetime>
Entries processed: <N>
Average NPS this batch: <X.X>/10
Cumulative NPS trend: <up/down/flat> vs previous iteration

Themes:
- <theme 1>: <brief description>
- <theme 2>: <brief description>
...

Top complaints:
1. <complaint>
2. <complaint>
...

Top suggestions:
1. <suggestion>
2. <suggestion>
...

Decision: <what will change in ControlNews.md and why>
─────────────────────────────────────────────────────────
```

### Step 3 — Generate Improvement Ideas

Before editing `ControlNews.md`, brainstorm at least **10 ideas** for improvement across these dimensions:

| Dimension | Questions to ask |
|-----------|-----------------|
| Content quality | Are articles too shallow? Too long? Missing context? |
| Personalisation | Are user preferences being respected? More granularity needed? |
| Visual experience | Are images vivid and relevant? Gradients appealing? |
| Article detail | Is the full-screen read experience immersive? |
| Category mix | Is the default feed well-balanced? Boring? Repetitive? |
| Freshness signals | Do timeAgo values feel realistic? Too many "Just now"? |
| Source credibility | Are sources varied and trustworthy? |
| Tags & filtering | Are tags useful for the category chips? |
| Tone & style | Too formal? Too casual? Accessible to a global audience? |
| Engagement hooks | Does each article make you want to read more? |

Score each idea by: **Impact** (1–5) × **Effort** (1–5, lower = easier). Pick the highest-scoring ideas that address the top complaints.

### Step 4 — Update ControlNews.md

Edit `ControlNews.md` to implement the chosen improvements. Always:

- Keep the **JSON schema** section intact (apps depend on it)
- Update the **AutoLoop Feedback Integration** section at the bottom with:
  - Previous feedback grade
  - Key issues identified
  - Changes made in this iteration
  - Target grade for next iteration
- Add a comment explaining *why* each change was made, not just what changed

### Step 5 — Verify & Republish

1. Restart the server (`node server.js`) and reload the app
2. Visually confirm the news feed reflects the changes
3. If deploying to Vercel: `vercel --prod`
4. Commit changes to GitHub with a message following this format:
   ```
   AutoLoop iteration N: <one-line description of main change>

   NPS: X.X/10 → target Y.Y/10
   Changes: <bullet list of key changes to ControlNews.md>
   ```

---

## Iteration Log

| # | Date | NPS | Key Change | Target NPS |
|---|------|-----|------------|------------|
| 0 | 2026-04-06 | — | Initial release | 7.0 |
| 1 | 2026-04-06 | 3.0 | Real images, full-screen articles, richer detail, tags | 9.0 |
| 2 | 2026-04-06 | 3.0 | hook, keyFacts, quote, geo diversity, inverted pyramid | 8.0 |
| 3 | 2026-04-06 | 5.0 | Default count 8→15, server cap 20→100, wildcard category | 8.0 |

---

## Rules for AutoLoop

1. **Never process the same feedback twice.** Always look for the most recent `AUTOLOOP SUMMARY` timestamp to know where to start.
2. **Be conservative with schema changes.** The app code depends on the JSON field names — never remove or rename fields without updating `app.js` too.
3. **One iteration = one commit.** Keep the change surface small so you can attribute NPS changes to specific improvements.
4. **Target NPS 9+** for Product Market Fit. Stop iterating when 3 consecutive batches average ≥ 9.0.
5. **If NPS drops**, read the new feedback carefully — a change you made may have introduced a regression. Roll it back or adjust before adding new features.
6. **ControlNews.md is the only lever for content changes.** Do not edit `app.js` or `server.js` unless the improvement requires new functionality that ControlNews.md cannot express.

---

## Quick Reference — What Each File Does

| File | Role | Edit? |
|------|------|-------|
| `ControlNews.md` | Master prompt — governs ALL news content and behaviour | Yes, every iteration |
| `Feedback.txt` | User feedback log + AutoLoop summaries | Append only |
| `autoloop.md` | This file — AutoLoop instructions | Update iteration log |
| `server.js` | Express backend, Claude API calls | Only for new features |
| `public/app.js` | Frontend rendering logic | Only for new features |
| `public/styles.css` | All styles | Only for new features |
