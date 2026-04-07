#!/usr/bin/env bash
set -euo pipefail

# ── AutoLoop Setup ──────────────────────────────────────────────
# Initializes the loop state file. Called once by /autoloop on first run.
# Creates .claude/autoloop-state.local.md as a "loop is active" signal
# for the stop hook. Cycle tracking is handled by git branch names.

STATE_FILE=".claude/autoloop-state.local.md"

# If state file already exists and is active, just report and exit
if [ -f "$STATE_FILE" ]; then
  echo "AutoLoop already active. Use /cancel-autoloop to stop."
  exit 0
fi

# Parse arguments
MAX_ITERATIONS=0  # 0 = unlimited
while [[ $# -gt 0 ]]; do
  case "$1" in
    --max-iterations)
      MAX_ITERATIONS="${2:-0}"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

# Get session ID from environment (Claude Code sets this)
SESSION_ID="${CLAUDE_CODE_SESSION_ID:-$(date +%s)}"

# Ensure .claude directory exists
mkdir -p .claude

# Write state file (loop-active signal for stop hook)
cat > "$STATE_FILE" << EOF
---
active: true
max_iterations: ${MAX_ITERATIONS}
session_id: "${SESSION_ID}"
started_at: "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
---
EOF

echo "AutoLoop initialized."
echo "  Max iterations: ${MAX_ITERATIONS} (0 = unlimited)"
echo "  State file: ${STATE_FILE}"
echo "  Cycle tracking: via git branch name (autoloop/cycle-N)"
