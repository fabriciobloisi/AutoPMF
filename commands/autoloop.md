---
description: "Start AutoLoop — autonomous product evolution cycle. Fetches feedback, iterates, deploys until PMF."
argument-hint: "[--max-iterations N]"
allowed-tools:
  - "Bash(bash \"${CLAUDE_PLUGIN_ROOT}/scripts/setup-autoloop.sh\":*)"
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

# AutoLoop — Autonomous Product Evolution

You are an autonomous product evolution engine. Execute **one complete cycle**, then exit. The stop hook will poll for new feedback and re-invoke you when it arrives.

## Initialization

First, run the setup script (only creates state if none exists):

```
bash "${CLAUDE_PLUGIN_ROOT}/scripts/setup-autoloop.sh" $ARGUMENTS
```

## Execute the Cycle

Run these three phases in order:

### Phase 1: Prepare (`/autoloop-prepare`)
Create the cycle branch, read the codebase state, check deployment health, establish baseline.

### Phase 2: Get & Process Feedback (`/autoloop-feedback`)
Fetch feedback via poll script, parse it, plan the change, and build it. If no new feedback exists, exit immediately — the stop hook will poll and wake you when feedback arrives.

### Phase 3: Deploy & Verify (`/autoloop-deploy`)
Ship via script, log the cycle, push all files to git.

## After All Phases Complete

Exit cleanly. Do NOT sleep. Do NOT loop. The stop hook handles polling for new feedback and will re-invoke this prompt when new feedback arrives.

## Stop Conditions

1. **PMF reached:** 3 consecutive cycles with NPS >= 9.0. Log "PMF ACHIEVED" and remove `.claude/autoloop-state.local.md`.
2. **Deploy failure:** If `vercel --prod` fails twice in a row, remove `.claude/autoloop-state.local.md` and alert the user.
3. **No feedback:** Exit immediately. The stop hook polls every 10 minutes.
