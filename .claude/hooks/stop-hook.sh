#!/usr/bin/env bash
set -euo pipefail

# ── AutoLoop Stop Hook ─────────────────────────────────────────
# Ralph Wiggum pattern: intercepts Claude's exit, polls for new
# feedback, sleeps if none, and re-injects the prompt when found.
#
# Exit 0 = allow Claude to stop (no loop active, PMF reached, etc.)
# Exit 2 = block exit and re-inject (new feedback found)
#
# Cycle tracking uses git branch names (autoloop/cycle-N).
# State file is only a "loop is active" signal + session isolation.
# ────────────────────────────────────────────────────────────────

STATE_FILE=".claude/autoloop-state.local.md"
POLL_INTERVAL=600    # 10 minutes between polls
MAX_POLLS=144        # 144 × 600s = 24 hours max wait

# ── Read hook input from stdin ──────────────────────────────────
HOOK_INPUT=$(cat)

# ── Guard: is there an active loop? ────────────────────────────
if [ ! -f "$STATE_FILE" ]; then
  exit 0
fi

# ── Parse state file ────────────────────────────────────────────
parse_field() {
  grep "^$1:" "$STATE_FILE" 2>/dev/null | head -1 | sed "s/^$1: *//" | tr -d '"'
}

ACTIVE=$(parse_field "active")
MAX_ITERATIONS=$(parse_field "max_iterations")
STATE_SESSION_ID=$(parse_field "session_id")

# Guard: loop not active
if [ "$ACTIVE" != "true" ]; then
  exit 0
fi

# Guard: session isolation — only the session that started the loop
# should be controlled by this hook
HOOK_SESSION_ID=$(echo "$HOOK_INPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get('session_id', ''))
except:
    print('')
" 2>/dev/null || echo "")

if [ -n "$STATE_SESSION_ID" ] && [ -n "$HOOK_SESSION_ID" ] && [ "$STATE_SESSION_ID" != "$HOOK_SESSION_ID" ]; then
  exit 0
fi

# ── Get current cycle from git branch name ─────────────────────
get_cycle() {
  local branch
  branch=$(git branch --show-current 2>/dev/null) || branch=""
  if [[ "$branch" =~ ^autoloop/cycle-([0-9]+)$ ]]; then
    echo "${BASH_REMATCH[1]}"
  else
    echo ""
  fi
}

CURRENT_CYCLE=$(get_cycle)

# ── Get iteration count from autoloop.md ───────────────────────
get_iteration_count() {
  grep '^|' autoloop.md 2>/dev/null \
    | grep -v '^| #' \
    | grep -v '^|---' \
    | wc -l | tr -d ' '
}

ITERATION_COUNT=$(get_iteration_count)

# ── Max iterations check ───────────────────────────────────────
if [ "$MAX_ITERATIONS" -gt 0 ] 2>/dev/null && [ "$ITERATION_COUNT" -ge "$MAX_ITERATIONS" ]; then
  echo "AutoLoop: max iterations ($MAX_ITERATIONS) reached. Stopping." >&2
  rm -f "$STATE_FILE"
  exit 0
fi

# ── PMF detection ──────────────────────────────────────────────
# Parse last 3 NPS values from autoloop.md iteration log table
check_pmf() {
  if [ ! -f "autoloop.md" ]; then
    return 1
  fi

  local nps_values
  nps_values=$(grep '^|' autoloop.md \
    | grep -v '^| #' \
    | grep -v '^|---' \
    | awk -F'|' '{gsub(/[ \t]/,"",$4); print $4}' \
    | grep -E '^[0-9]+\.?[0-9]*$' \
    | tail -3)

  local count
  count=$(echo "$nps_values" | wc -l | tr -d ' ')

  if [ "$count" -lt 3 ]; then
    return 1
  fi

  local qualifying
  qualifying=$(echo "$nps_values" | awk '$1 >= 9.0 {count++} END {print count+0}')

  if [ "$qualifying" -eq 3 ]; then
    return 0  # PMF achieved
  fi
  return 1
}

if check_pmf; then
  echo "AutoLoop: PMF ACHIEVED! 3 consecutive cycles with NPS >= 9.0. Stopping." >&2
  rm -f "$STATE_FILE"
  exit 0
fi

# ── Feedback polling loop ──────────────────────────────────────
# Wait for at least 1 new feedback entry before re-invoking Claude.
# Uses local_feedback.jsonl line count as the signal (getFeedback.sh appends to it).

BEFORE=0
if [ -f "local_feedback.jsonl" ]; then
  BEFORE=$(wc -l < local_feedback.jsonl | tr -d ' ')
fi

poll_count=0
new_feedback_found=false

while [ "$poll_count" -lt "$MAX_POLLS" ]; do
  # Fetch new feedback
  bash ./getFeedback.sh >/dev/null 2>&1 || true

  AFTER=0
  if [ -f "local_feedback.jsonl" ]; then
    AFTER=$(wc -l < local_feedback.jsonl | tr -d ' ')
  fi

  if [ "$AFTER" -gt "$BEFORE" ]; then
    new_feedback_found=true
    NEW_COUNT=$((AFTER - BEFORE))
    break
  fi

  # No new feedback — sleep and retry
  poll_count=$((poll_count + 1))
  sleep "$POLL_INTERVAL"
done

# If we exhausted all retries with no feedback, stop
if [ "$new_feedback_found" != "true" ]; then
  echo "AutoLoop: no feedback received in 24 hours. Stopping." >&2
  rm -f "$STATE_FILE"
  exit 0
fi

# ── Determine next cycle number ────────────────────────────────
if [ -n "$CURRENT_CYCLE" ]; then
  NEXT_CYCLE=$((CURRENT_CYCLE + 1))
else
  # Fallback: read last cycle from autoloop.md iteration log
  LAST_CYCLE=$(grep '^|' autoloop.md 2>/dev/null \
    | grep -v '^| #' \
    | grep -v '^|---' \
    | tail -1 \
    | awk -F'|' '{gsub(/[ \t]/,"",$2); print $2}' 2>/dev/null || echo "0")
  if ! [[ "$LAST_CYCLE" =~ ^[0-9]+$ ]]; then
    LAST_CYCLE=0
  fi
  NEXT_CYCLE=$((LAST_CYCLE + 1))
fi

# ── Block exit and re-inject ───────────────────────────────────
echo "AutoLoop: ${NEW_COUNT} new feedback entr$([ "$NEW_COUNT" -eq 1 ] && echo 'y' || echo 'ies') received. Next cycle: ${NEXT_CYCLE}." >&2
exit 2
