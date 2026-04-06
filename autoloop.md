# AutoLoop — Autonomous Product Evolution

AutoLoop is a fully autonomous improvement engine. Once started, it runs in a continuous loop: fetch feedback → decide → evolve → deploy → sleep → repeat. **No human intervention required between cycles.**

**Core principle:** `product.md` is the product. Evolving `product.md` IS evolving the product.

---

## Start Command

When the user says **"Start @autoloop.md"**, begin the loop below. Do not stop until PMF is reached or the user interrupts.

---

## The Loop

```
┌─────────────────────────────────────────┐
│              CYCLE START                │
│                                         │
│  1. FETCH  → ./getFeedback.sh           │
│  2. PARSE  → new feedback after marker? │
│       ├─ NO  → sleep 600, restart       │
│       └─ YES → continue                 │
│  3. PLAN   → what does feedback say?    │
│  4. BUILD  → change code + product.md   │
│  5. SHIP   → commit, push, deploy       │
│  6. LOG    → update logs + marker       │
│  7. SLEEP  → sleep 600                  │
│  8. GOTO 1                              │
└─────────────────────────────────────────┘
```

### Step 1 — FETCH

```bash
bash ./getFeedback.sh
```

This appends new feedback to `Feedback.txt`.

### Step 2 — PARSE

Read `Feedback.txt`. Find the **most recent `AUTOLOOP ITERATION` marker**. Only consider entries **after** that marker. If no marker exists, process all entries.

**If there is no new feedback after the marker:**
- Log: `── YYYY-MM-DDTHH:MM:SSZ — No Feedback in last Loop` (append to Feedback.txt)
- Run `sleep 600`
- Go back to Step 1

**If there is new feedback:** extract the grade, comments, and suggestion. Continue to Step 3.

### Step 3 — PLAN

Read `product.md` end-to-end. Answer these three questions (internally, do not output a table):

1. **What is the user asking for?** — Translate feedback into a concrete change.
2. **Is this a product.md change, a code change, or both?**
3. **Can I ship this in one small commit?** — If not, pick the smallest slice that addresses the core complaint.

If NPS dropped from the previous cycle, check whether the last change caused a regression before adding anything new.

### Step 4 — BUILD

Make the changes. Rules:

- **One concern per cycle.** Don't bundle unrelated improvements.
- **Always update `product.md`** — even if the fix is code-only, document the change in the Evolution Log at the bottom of `product.md`.
- **Never remove schema fields** the app depends on.
- **Never edit `getFeedback.sh`.**
- Code changes go in `public/app.js`, `public/styles.css`, `public/index.html`, or `server.js` as needed.

### Step 5 — SHIP

Determine the next cycle number N by reading the Iteration Log below (N = last cycle number + 1).

```bash
git checkout -b autoloop/cycle-N
git add product.md autoloop.md Feedback.txt <any changed app files>
git commit -m "AutoLoop cycle N: <one-line summary>

NPS: X.X/10 → target 9.0/10
Changes: <bullet list>"
git push origin autoloop/cycle-N
export PATH="/opt/homebrew/bin:$PATH" && vercel --prod
```

### Step 6 — LOG

1. Add a row to the **Iteration Log** table below.
2. Append the feedback boundary marker to `Feedback.txt`:
   ```
   ── AUTOLOOP ITERATION N ── YYYY-MM-DD ──────────────────────────────
   ```

### Step 7 — SLEEP

```bash
sleep 600
```

Then go back to **Step 1**. This is an infinite loop.

---

## Iteration Log

| # | Date | NPS | Key Change | Target |
|---|------|-----|-----------|--------|
| 0 | 2026-04-06 | — | Baseline: extracted product definition | 9.0 |
| 3 | 2026-04-06 | 2.0 | Removed fire emoji, professional trending badges | 9.0 |
| 4 | 2026-04-06 | 3.0 | Source names capped 20 chars, single-line footers | 9.0 |
| 5 | 2026-04-06 | 4.0 | Ask Claude sticky footer bar | 9.0 |
| 6 | 2026-04-06 | 5.0 | Dark mode with toggle in Settings | 9.0 |

---

## Stop Conditions

1. **PMF reached:** 3 consecutive cycles with NPS ≥ 9.0. Log "PMF ACHIEVED" and stop.
2. **User interrupt:** The user says stop, pause, or cancel.
3. **Deploy failure:** If `vercel --prod` fails twice in a row, stop and alert the user.

---

## Rules

1. **Never process the same feedback twice.** The `AUTOLOOP ITERATION` marker is the boundary.
2. **One cycle = one commit.** Small, attributable changes only.
3. **No feedback = no changes.** Sleep and poll again. Don't invent improvements without user signal.
4. **If NPS drops**, diagnose before adding features. The last change may have regressed something.
5. **Sleep 600 seconds between every cycle**, including no-feedback cycles.

---

## File Reference

| File | Role | When to Edit |
|------|------|-------------|
| `product.md` | Product definition — governs all content and features | Every cycle with feedback |
| `Feedback.txt` | User feedback log (appended by `getFeedback.sh`) | Only to add iteration markers |
| `getFeedback.sh` | Fetches remote feedback | Never |
| `autoloop.md` | This file — loop instructions and iteration log | Update iteration log each cycle |
| `server.js` | Express backend, Claude API calls | When feedback requires backend changes |
| `public/app.js` | Frontend logic | When feedback requires frontend changes |
| `public/index.html` | HTML structure | When feedback requires structural changes |
| `public/styles.css` | All styles | When feedback requires visual changes |
