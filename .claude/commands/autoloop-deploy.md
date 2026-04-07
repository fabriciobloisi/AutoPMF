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

**If deployment fails after 2 attempts:**
1. Remove `.claude/autoloop-state.local.md` (stops the loop)
2. Alert the user about the deploy failure
3. EXIT

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

## Step 3 — PUSH

Save all log updates to git:

```bash
bash scripts/autoloop-cycle.sh push
```

This stages `autoloop.md`, `results.tsv`, `local_feedback.jsonl`, commits if there are changes, and pushes the branch.

## Step 4 — EXIT

Exit cleanly. Do NOT sleep. Do NOT loop. The stop hook will handle polling for new feedback.
