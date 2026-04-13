---
description: "AutoLoop Phase 3: Ship, log, and push — all via autoloop-cycle.sh scripts"
allowed-tools:
  - "Bash(bash scripts/autoloop-cycle.sh:*)"
  - "Bash(rm .claude/autoloop-state.local.md)"
  - Read
  - Write
  - Edit
---

# AutoLoop — Phase 3: Deploy & Verify

## Step 1 — SHIP

Commit all changes, push the branch, deploy to Vercel, and verify:

```bash
bash scripts/autoloop-cycle.sh ship "<one-line summary of the change>"
```

This stages all modified files (including `product.md`, `autoloop.md`, `local_feedback.jsonl`, `results.tsv`, and any changed app files), commits with the cycle number, pushes the branch, deploys via `vercel --prod`, and verifies **Ready** status. Retries once on deploy failure.

**If deployment succeeds**, mark the feedback that drove this cycle as processed:

```bash
bash scripts/autoloop-cycle.sh mark-processed
```

This ensures feedback is only marked processed after the change is live. If the cycle had failed, the feedback stays unprocessed and will be picked up by the next cycle.

**If deployment fails after 2 attempts:**
1. Remove `.claude/autoloop-state.local.md` (stops the loop)
2. Alert the user about the deploy failure
3. EXIT (feedback remains unprocessed — it will be retried next cycle)

## Step 2 — LOG

1. **Iteration Log** — Add a row to the Iteration Log table in `autoloop.md`:
   ```
   | N | YYYY-MM-DD | X.X | Key change description | 9.0 |
   ```

2. **Results TSV** — Run the log script to append a row to `results.tsv`:
   ```bash
   bash scripts/autoloop-cycle.sh log <nps> <status> "<description>"
   ```
   Where status is `keep` or `revert`.

## Step 2.5 — RECORD LEARNING (Self-Learning Loop)

After logging the NPS result, record the lesson in `learnings.md`:

```bash
bash scripts/autoloop-cycle.sh learn <cycle> <nps> <prev_nps> "<description>"
```

This writes a structured entry to `learnings.md` with the NPS delta and lesson learned.
Next cycle, Claude reads this file to build on what worked and avoid what failed.

**This is the self-learning loop: each cycle teaches the next one.**

---

## Step 3 — PUSH

Save all log updates to git:

```bash
bash scripts/autoloop-cycle.sh push
```

This stages `autoloop.md`, `results.tsv`, `local_feedback.jsonl`, commits if there are changes, and pushes the branch.

## Step 4 — EXIT

Exit cleanly. Do NOT sleep. Do NOT loop. The stop hook will handle polling for new feedback.
