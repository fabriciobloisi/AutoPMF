---
description: "AutoLoop Phase 1: Create cycle branch, read codebase state, check deployment, establish baseline"
allowed-tools:
  - "Bash(bash scripts/autoloop-cycle.sh:*)"
  - "Bash(export PATH=\"/opt/homebrew/bin:$PATH\":*)"
  - Read
  - Glob
  - Grep
---

# AutoLoop — Phase 1: Prepare

## Steps

1. **Create cycle branch** — Run:
   ```bash
   bash scripts/autoloop-cycle.sh prepare
   ```
   This reads the last cycle number from the autoloop.md iteration log, creates `autoloop/cycle-<N+1>` branch, and checks it out. The branch name is the source of truth for cycle tracking.

2. **Read all in-scope files** — Read and understand the current state of:
   - `product.md` — the product definition
   - `server.js` — Express backend
   - `public/app.js` — frontend logic
   - `public/index.html` — HTML structure
   - `public/styles.css` — all styles
   - `autoloop.md` — iteration log and rules

3. **Verify deployment target** — Run:
   ```bash
   bash scripts/autoloop-cycle.sh status
   ```
   Confirm the most recent deployment shows **Ready** and note the current NPS trend.

4. **Establish baseline** — Note the current NPS from the most recent Iteration Log entry in `autoloop.md`.

5. **Report** — Output a brief summary: cycle number (from branch name), current NPS, deployment status.
