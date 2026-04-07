---
description: "Cancel an active AutoLoop cycle"
allowed-tools:
  - "Bash(rm .claude/autoloop-state.local.md)"
  - Read
---

# Cancel AutoLoop

Check if an AutoLoop is currently active:

1. Read `.claude/autoloop-state.local.md`
2. If it exists, note the current cycle number and report it
3. Delete the state file: `rm .claude/autoloop-state.local.md`
4. Report: "AutoLoop cancelled at cycle N."

If no state file exists, report: "No active AutoLoop to cancel."
