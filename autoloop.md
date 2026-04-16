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

The **git branch name** is the source of truth for cycle numbers: `notes/cycle-N`. The `prepare` subcommand reads the last cycle from the Iteration Log below and creates the next branch.

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
| `prepare` | Creates `notes/cycle-<N+1>` branch — sets the cycle number for all subsequent commands |
| `poll` | Fetches unprocessed feedback via `getFeedback.sh`; sleeps on no-feedback; exits with JSON when new feedback arrives — **always run BLOCKING (foreground), never background** |
| `ship <msg>` | Commits all files, pushes, deploys to Vercel, verifies (reads cycle from branch) |
| `log <nps> <status> <desc>` | Appends row to results.tsv (reads cycle from branch) |
| `push` | Final push of the branch to save all work (logs, feedback, autoloop.md updates) |
| `status` | Shows branch, cycle, NPS trend, deploy health |

---

## Iteration Log

| # | Date | NPS | Key Change | Target |
|---|------|-----|-----------|--------|
| 0 | 2026-04-15 | — | Baseline: fresh start with weather app | 9.0 |
| 1 | 2026-04-16 | 5.0 | Real weather data via Open-Meteo API (current, forecast, hourly) | 9.0 |
| 2 | 2026-04-16 | 5.4 | Error recovery UX: retry button, city-switch toast, font/spacing boost | 9.0 |
| 3 | 2026-04-16 | 4.0 | Debounce concurrent loads + auto-retry 15s on error | 9.0 |
| 4 | 2026-04-16 | 6.1 | Min 400ms loading display + city name in error state + larger tab targets | 9.0 |
| 5 | 2026-04-16 | 4.0 | Vercel Blob weather cache — 30-min fallback survives cold starts | 9.0 |
| 6 | 2026-04-16 | 5.6 | Fix 400: remove deprecated moonphase from Open-Meteo + city flag in loading/error | 9.0 |
| 7 | 2026-04-16 | 2.0 | Actionable error recovery: "Try a different city" button, Retry feedback, refresh spinner tied to load | 9.0 |

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
6. **`poll` is always blocking.** Run `bash scripts/autoloop-cycle.sh poll` in the foreground only — never with `run_in_background: true`. The session must wait for the command to return.

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
