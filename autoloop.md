# AutoLoop — Autonomous Product Evolution

AutoLoop is a fully autonomous improvement engine. Once started, it runs in a continuous loop: fetch feedback → decide → evolve → deploy → sleep → repeat. **No human intervention required between cycles.**

**Core principle:** `product.md` is the product. Evolving `product.md` IS evolving the product.

---

## How to Start

Run the `/autoloop` command. This is the **only** entry point — it handles setup, cycle creation, feedback fetching, building, deploying, and logging automatically.

The `/autoloop` command executes one cycle then exits. The **stop hook** (`hooks/stop-hook.sh`) polls for new feedback every 10 minutes and re-invokes `/autoloop` when feedback arrives.

---

## Architecture

```
/autoloop (entry point)
  ├─ setup-autoloop.sh        → creates state file (loop-active signal)
  ├─ /autoloop-prepare         → autoloop-cycle.sh prepare (creates branch)
  ├─ /autoloop-feedback        → autoloop-cycle.sh poll (fetch + JSON output)
  └─ /autoloop-deploy          → autoloop-cycle.sh ship/log/push

stop-hook.sh (between cycles)
  ├─ polls getFeedback.sh every 10 min
  ├─ detects PMF (3× NPS ≥ 9.0)
  └─ re-invokes /autoloop on new feedback
```

### Cycle Tracking

The **git branch name** is the source of truth for cycle numbers: `autoloop/cycle-N`. The `prepare` subcommand reads the last cycle from the Iteration Log below and creates the next branch.

### Everything in Git

All files are committed and tracked:
- `local_feedback.jsonl` — append-only JSONL archive of all feedback
- `results.tsv` — machine-readable experiment log
- `Feedback.txt` — human-readable feedback archive
- `product.md`, `autoloop.md`, `server.js`, `public/*` — product files

---

## Helper Scripts

All automation lives in `scripts/autoloop-cycle.sh`. **Never edit `getFeedback.sh`** — it is called internally by the scripts.

| Subcommand | Purpose |
|------------|---------|
| `prepare` | Creates `autoloop/cycle-<N+1>` branch — sets the cycle number for all subsequent commands |
| `poll` | Fetches unprocessed feedback via `getFeedback.sh`; sleeps on no-feedback; exits with JSON when new feedback arrives |
| `ship <msg>` | Commits all files, pushes, deploys to Vercel, verifies (reads cycle from branch) |
| `log <nps> <status> <desc>` | Appends row to results.tsv (reads cycle from branch) |
| `push` | Final push of the branch to save all work (logs, feedback, autoloop.md updates) |
| `status` | Shows branch, cycle, NPS trend, deploy health |

---

## Iteration Log

| # | Date | NPS | Key Change | Target |
|---|------|-----|-----------|--------|
| 0 | 2026-04-06 | — | Baseline: extracted product definition | 9.0 |
| 3 | 2026-04-06 | 2.0 | Removed fire emoji, professional trending badges | 9.0 |
| 4 | 2026-04-06 | 3.0 | Source names capped 20 chars, single-line footers | 9.0 |
| 5 | 2026-04-06 | 4.0 | Ask Claude sticky footer bar | 9.0 |
| 6 | 2026-04-06 | 5.0 | Dark mode with toggle in Settings | 9.0 |
| 7 | 2026-04-06 | — | Fix getFeedback.sh casing bug, image resilience via picsum proxy, session_id in feedback, implement dark mode toggle in Settings | 9.0 |
| 8 | 2026-04-06 | 5.0 | Fix card images hidden by gradient fallback overlay | 9.0 |
| 9 | 2026-04-06 | 6.0 | Ken Burns slow zoom on images in Instagram, TikTok, Video modes | 9.0 |
| 10 | 2026-04-07 | 4.0 | Search keyword highlighting in feed cards across all display modes | 9.0 |
| 11 | 2026-04-07 | 4.0 | Search results prioritise headline matches over body-only matches | 9.0 |
| 12 | 2026-04-08 | 5.5 | Fun empty-category messages, darker blue, rename Ask Claude to Ask the news | 9.0 |
| 13 | 2026-04-08 | 5.8 | Simplified feedback form, faster Ken Burns animation | 9.0 |
| 14 | 2026-04-08 | 6.5 | Fun empty-search messages, mobile safe-area fix, fix mark-processed bug | 9.0 |
| 15 | 2026-04-08 | 3.0 | Fix feedback FAB hidden on mobile by safe-area inset | 9.0 |
| 16 | 2026-04-08 | 5.0 | Fix blue bar on mobile — neutral body background | 9.0 |
| 17 | 2026-04-08 | 5.0 | Fix Ask the news — server timeout + client timeout + auto-scroll | 9.0 |
| 18 | 2026-04-08 | 5.0 | No-op — duplicate feedback from cycle 17 (mark-processed was missed) | 9.0 |
| 19 | 2026-04-08 | 3.5 | Remove bottom mode bar, add first-run onboarding for personalization | 9.0 |
| 20 | 2026-04-08 | 3.5 | No-op — duplicate feedback from cycle 19 (mark-processed was missed) | 9.0 |
| 21 | 2026-04-08 | 3.5 | Fix Vercel Blob cache causing duplicate feedback processing | 9.0 |
| 22 | 2026-04-08 | 7.0 | Category bar filters to only show selected topics after personalization | 9.0 |
| 23 | 2026-04-08 | 7.0 | No-op — duplicate feedback from cycle 22 (mark-processed was missed) | 9.0 |
| 24 | 2026-04-08 | 7.0 | Ask the news: shorter conversational responses, improved paragraph formatting | 9.0 |
| 25 | 2026-04-08 | 5.0 | Add share button in article detail — Web Share API on mobile, clipboard on desktop | 9.0 |
| 26 | 2026-04-08 | 5.0 | News source selector in Customize — filter feed by preferred sources | 9.0 |
| 27 | 2026-04-08 | 5.0 | Expand categories from 10 to 17 — Entertainment, Finance, Space, Education, Travel, Food, Opinion | 9.0 |

---

## Stop Conditions

1. **PMF reached:** 3 consecutive cycles with NPS ≥ 9.0. Log "PMF ACHIEVED" and stop.
2. **User interrupt:** The user says stop, pause, or cancel (or runs `/cancel-autoloop`).
3. **Deploy failure:** If `vercel --prod` fails twice in a row, stop and alert the user.

---

## Rules

1. **Never process the same feedback twice.** The server's `processed` flag is the boundary — `getFeedback.sh` only fetches unprocessed entries and marks them processed.
2. **One cycle = one commit.** Small, attributable changes only.
3. **No feedback = no changes.** Sleep and poll again. Don't invent improvements without user signal.
4. **If NPS drops**, do not fix forward. Identify and **revert** the change that caused the regression. Only resume new work once NPS has recovered.
5. **Sleep 600 seconds between every cycle**, including no-feedback cycles.

---

## File Reference

| File | Role | When to Edit |
|------|------|-------------|
| `product.md` | Product definition — governs all content and features | Every cycle with feedback |
| `local_feedback.jsonl` | Append-only JSONL archive of all feedback (committed to git) | Never — auto-appended by `getFeedback.sh` |
| `getFeedback.sh` | Fetches unprocessed feedback from server, marks processed | Never |
| `autoloop.md` | This file — loop instructions and iteration log | Update iteration log each cycle |
| `results.tsv` | Machine-readable experiment log (committed to git) | Append a row each cycle via `autoloop-cycle.sh log` |
| `scripts/autoloop-cycle.sh` | Orchestrator — prepare, poll, ship, log, push, status | Never (unless adding subcommands) |
| `server.js` | Express backend, Claude API calls | When feedback requires backend changes |
| `public/app.js` | Frontend logic | When feedback requires frontend changes |
| `public/index.html` | HTML structure | When feedback requires structural changes |
| `public/styles.css` | All styles | When feedback requires visual changes |
