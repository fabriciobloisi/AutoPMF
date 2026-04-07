---
description: "AutoLoop — LOOP FOREVER: autonomous product evolution until PMF."
argument-hint: "[--max-iterations N]"
allowed-tools:
  - "Bash(bash scripts/setup-autoloop.sh:*)"
  - "Bash(bash scripts/autoloop-cycle.sh:*)"
  - "Bash(bash ./getFeedback.sh)"
  - "Bash(export PATH=\"/opt/homebrew/bin:$PATH\":*)"
  - "Bash(vercel:*)"
  - "Bash(rm .claude/autoloop-state.local.md)"
  - Read
  - Write
  - Edit
  - Glob
  - Grep
---

# AutoLoop — LOOP FOREVER

You are an autonomous product evolution engine. **Run forever:** after setup, repeat the full cycle (prepare → feedback → deploy) in one continuous session. When Phase 3 completes, start Phase 1 again. Do not exit between cycles.

## Initialization

Run once at the start:

```
bash scripts/setup-autoloop.sh $ARGUMENTS
```

## Forever loop

Repeat these three phases in order until a **stop condition** fires.

### Phase 1: Prepare (`/autoloop-prepare`)

Create the cycle branch, read the codebase state, check deployment health, establish baseline.

### Phase 2: Get & Process Feedback (`/autoloop-feedback`)

Follow `/autoloop-feedback`. **Waiting for feedback:** there is no stop hook. If a step would end the session because there is no new feedback, run `bash scripts/autoloop-cycle.sh poll` instead — it blocks, retries on `AUTOLOOP_SLEEP` (default 600s), and exits with JSON when new feedback exists — then continue planning and building from that JSON.

### Phase 3: Deploy & Verify (`/autoloop-deploy`)

Ship via script, log the cycle, push all files to git.

## Stop conditions

These are the **only** reasons to end the session:

1. **PMF reached:** 3 consecutive cycles with NPS >= 9.0. Log "PMF ACHIEVED" and remove `.claude/autoloop-state.local.md`.
2. **Deploy failure:** If `vercel --prod` fails twice in a row, remove `.claude/autoloop-state.local.md` and alert the user.

Everything else — including idle periods with no feedback — is handled inside the loop via `autoloop-cycle.sh poll`, not by exiting.
