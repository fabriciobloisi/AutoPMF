#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────
# autoloop-cycle.sh — Orchestrator for AutoLoop mechanics
#
# The branch name autoloop/cycle-<N> is the source of truth
# for the current cycle number. All subcommands read it.
#
# Subcommands:
#   prepare   — Create autoloop/cycle-<N+1> branch, print cycle number
#   poll      — Fetch feedback; exit with JSON when new feedback arrives
#   ship      — Commit, push, deploy
#   log       — Append row to results.tsv
#   push      — Push branch to origin (final save)
#   status    — Quick health check
# ─────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

export PATH="/opt/homebrew/bin:$PATH"

RESULTS_FILE="results.tsv"
SLEEP_INTERVAL="${AUTOLOOP_SLEEP:-600}" # 600

# Load env vars
[[ -f .env ]] && { set -a; source .env; set +a; }
[[ -f .env.local ]] && { set -a; source .env.local; set +a; }

# ─── Helpers ───────────────────────────────────────────────

die() { echo "ERROR: $*" >&2; exit 1; }

now_iso() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
today() { date +"%Y-%m-%d"; }

# Read cycle number from current branch name (autoloop/cycle-<N>)
get_cycle() {
    local branch
    branch=$(git branch --show-current)
    if [[ "$branch" =~ ^autoloop/cycle-([0-9]+)$ ]]; then
        echo "${BASH_REMATCH[1]}"
    else
        echo ""
    fi
}

# Get last cycle number from autoloop.md iteration log
get_last_cycle() {
    python3 -c "
last = 0
in_table = False
for line in open('autoloop.md'):
    if '| # | Date | NPS |' in line:
        in_table = True; continue
    if in_table and line.startswith('|---'): continue
    if in_table and line.startswith('|'):
        cols = [c.strip() for c in line.split('|')]
        if len(cols) >= 2:
            try: last = max(last, int(cols[1]))
            except: pass
    elif in_table: break
print(last)
"
}

# Extract NPS trend from autoloop.md iteration log table
get_nps_trend() {
    python3 -c "
nps = []
in_table = False
for line in open('autoloop.md'):
    if '| # | Date | NPS |' in line:
        in_table = True; continue
    if in_table and line.startswith('|---'): continue
    if in_table and line.startswith('|'):
        cols = [c.strip() for c in line.split('|')]
        if len(cols) >= 4:
            try: nps.append(float(cols[3]))
            except: pass
    elif in_table: break
print(','.join(str(x) for x in nps) if nps else '')
"
}

# Detect NPS regression (last 2 lower than the 2 before them)
check_regression() {
    local trend="$1"
    python3 -c "
t = [float(x) for x in '$trend'.split(',') if x]
if len(t) >= 4 and all(t[-2+i] < t[-4+i] for i in range(2)):
    print('true')
else:
    print('false')
"
}

# ─── PREPARE ──────────────────────────────────────────────
# Creates autoloop/cycle-<N+1> branch. Prints the cycle number.
# This is the first step of every cycle — sets the cycle number
# that all subsequent commands read from the branch name.

cmd_prepare() {
    local last_cycle
    last_cycle=$(get_last_cycle)
    local next_cycle=$((last_cycle + 1))
    local branch="autoloop/cycle-${next_cycle}"

    if git rev-parse --verify "$branch" &>/dev/null; then
        echo "Branch $branch already exists, checking out..."
        git checkout "$branch"
    else
        echo "Creating branch $branch..."
        git checkout -b "$branch"
    fi

    echo "Cycle: $next_cycle"
}

# ─── POLL ──────────────────────────────────────────────────
# Runs getFeedback.sh in a loop. When new feedback is found,
# outputs structured JSON and exits 0. On no-feedback, sleeps.

cmd_poll() {
    local cycle
    cycle=$(get_cycle)
    [[ -z "$cycle" ]] && die "Not on an autoloop/cycle-N branch. Run 'prepare' first."

    echo "AutoLoop poll started — cycle $cycle (interval: ${SLEEP_INTERVAL}s)"
    while true; do
        echo "── $(now_iso) Fetching feedback..."

        # Fetch unprocessed entries from server (stdout = raw JSONL).
        # getFeedback.sh exits non-zero if mark-processed curl fails; without
        # || true, `raw=$(...) || raw=""` would discard captured JSON anyway.
        raw=$(bash ./getFeedback.sh 2>/dev/null || true)
        echo "raw: $raw"

        if [[ -n "$raw" ]]; then
            local trend
            trend=$(get_nps_trend)
            local regressing
            regressing=$(check_regression "$trend")

            python3 -c "
import sys, json

lines = '''$raw'''.strip().split('\n')
entries = []
for line in lines:
    line = line.strip()
    if not line: continue
    try:
        e = json.loads(line)
        if e.get('grade') is not None:
            entries.append({
                'timestamp': e.get('timestamp', ''),
                'grade': e['grade'],
                'comments': e.get('comments', '') or '',
                'suggestion': e.get('suggestion', '') or '',
            })
    except: pass

if not entries:
    json.dump({'has_new_feedback': False}, sys.stdout)
    sys.exit(0)

grades = [e['grade'] for e in entries]
avg = round(sum(grades)/len(grades), 1)
trend = [float(x) for x in '$trend'.split(',') if x]

json.dump({
    'has_new_feedback': True,
    'cycle': $cycle,
    'entries': entries,
    'entry_count': len(entries),
    'avg_nps': avg,
    'nps_trend': trend,
    'regressing': '$regressing' == 'true',
}, sys.stdout, indent=2)
print()
"
            exit 0
        fi

        echo "No new feedback. Sleeping ${SLEEP_INTERVAL}s..."
        sleep "$SLEEP_INTERVAL"
    done
}

# ─── SHIP ──────────────────────────────────────────────────
# Usage: autoloop-cycle.sh ship <message> [--dry-run]
#
# Commits, pushes, deploys to Vercel. Reads cycle from branch.

cmd_ship() {
    local message="${1:?Usage: ship <message>}"
    local dry_run=false
    [[ "${2:-}" == "--dry-run" ]] && dry_run=true

    local cycle
    cycle=$(get_cycle)
    [[ -z "$cycle" ]] && die "Not on an autoloop/cycle-N branch. Run 'prepare' first."

    local branch="autoloop/cycle-${cycle}"
    echo "Shipping cycle $cycle on branch $branch..."

    # Stage files — everything goes in git
    local files_to_add=(product.md autoloop.md)
    for f in server.js public/app.js public/styles.css public/index.html local_feedback.jsonl results.tsv Feedback.txt; do
        if [[ -f "$f" ]] && { git diff --name-only | grep -q "^${f}$" || git diff --cached --name-only | grep -q "^${f}$" || ! git ls-files --error-unmatch "$f" &>/dev/null; }; then
            files_to_add+=("$f")
        fi
    done

    echo "Staging: ${files_to_add[*]}"
    if $dry_run; then
        echo "[DRY RUN] Would commit: AutoLoop cycle ${cycle}: ${message}"
        echo "[DRY RUN] Would push to origin/$branch"
        echo "[DRY RUN] Would deploy with vercel --prod"
        return 0
    fi

    git add "${files_to_add[@]}"
    git commit -m "AutoLoop cycle ${cycle}: ${message}"
    git push origin "$branch"

    # Deploy
    echo "Deploying to Vercel..."
    vercel --prod --yes
    echo "Waiting 20s for deployment propagation..."
    sleep 20

    # Verify
    local deploy_status
    deploy_status=$(vercel ls --prod 2>&1 | head -10)
    if echo "$deploy_status" | grep -qi "Ready"; then
        echo "Deployment verified: Ready"
    else
        echo "First deploy check failed. Retrying..."
        vercel --prod --yes
        sleep 20
        deploy_status=$(vercel ls --prod 2>&1 | head -10)
        if echo "$deploy_status" | grep -qi "Ready"; then
            echo "Deployment verified on retry: Ready"
        else
            die "Deployment failed after 2 attempts. Manual intervention required."
        fi
    fi
}

# ─── LOG ───────────────────────────────────────────────────
# Usage: autoloop-cycle.sh log <nps> <status> <description>
#
# Reads cycle from branch. Appends row to results.tsv.

cmd_log() {
    local nps="${1:?Usage: log <nps> <status> <description>}"
    local status="${2:?Usage: log <nps> <status> <description>}"
    shift 2
    local description="$*"
    [[ -z "$description" ]] && die "Description required"

    local cycle
    cycle=$(get_cycle)
    [[ -z "$cycle" ]] && die "Not on an autoloop/cycle-N branch. Run 'prepare' first."

    local date_str
    date_str=$(today)

    # Append to results.tsv
    if [[ ! -f "$RESULTS_FILE" ]]; then
        printf "cycle\tdate\tnps\tstatus\tdescription\n" > "$RESULTS_FILE"
        echo "Created $RESULTS_FILE with header"
    fi
    printf "%s\t%s\t%s\t%s\t%s\n" "$cycle" "$date_str" "$nps" "$status" "$description" >> "$RESULTS_FILE"
    echo "Row appended to $RESULTS_FILE"

    # Print the autoloop.md table row
    echo ""
    echo "Add this row to the Iteration Log in autoloop.md:"
    echo "| ${cycle} | ${date_str} | ${nps} | ${description} | 9.0 |"
}

# ─── PUSH ─────────────────────────────────────────────────
# Final push of the branch to save all work (logs, autoloop.md updates).

cmd_push() {
    local cycle
    cycle=$(get_cycle)
    [[ -z "$cycle" ]] && die "Not on an autoloop/cycle-N branch. Run 'prepare' first."

    local branch="autoloop/cycle-${cycle}"

    # Stage and commit any remaining changes
    git add autoloop.md results.tsv local_feedback.jsonl Feedback.txt 2>/dev/null || true
    if ! git diff --cached --quiet 2>/dev/null; then
        git commit -m "AutoLoop cycle ${cycle}: update logs"
    fi

    git push origin "$branch"
    echo "Pushed $branch to origin. Cycle $cycle saved."
}

# ─── MARK-PROCESSED ───────────────────────────────────────
# Marks feedback entries for the current cycle as processed on the server.
# Called after a successful deploy so feedback isn't lost on failed cycles.

cmd_mark_processed() {
    local cycle
    cycle=$(get_cycle)
    [[ -z "$cycle" ]] && die "Not on an autoloop/cycle-N branch. Run 'prepare' first."

    : "${FEEDBACK_SECRET:?FEEDBACK_SECRET is not set}"
    : "${DEPLOY_URL:?DEPLOY_URL is not set}"

    # Extract timestamps of entries for this cycle that aren't yet processed
    local timestamps
    timestamps=$(python3 -c "
import json
ts = []
for line in open('local_feedback.jsonl'):
    line = line.strip()
    if not line: continue
    try:
        e = json.loads(line)
        if e.get('cycle') == $cycle and not e.get('processed'):
            ts.append(e['timestamp'])
    except: pass
print(json.dumps(ts))
" 2>/dev/null) || timestamps="[]"

    if [[ "$timestamps" == "[]" ]]; then
        echo "No unprocessed feedback for cycle $cycle to mark."
        return 0
    fi

    echo "Marking feedback as processed for cycle $cycle..."
    local attempt
    local max_attempts=3
    local mark_ok=false
    for attempt in $(seq 1 $max_attempts); do
        if curl -sf -X POST \
          -H "Authorization: Bearer $FEEDBACK_SECRET" \
          -H "Content-Type: application/json" \
          -d "{\"timestamps\":$timestamps}" \
          "${DEPLOY_URL}/api/feedback/mark-processed"; then
            mark_ok=true
            break
        fi
        echo "  mark-processed attempt $attempt/$max_attempts failed, retrying in ${attempt}s..."
        sleep "$attempt"
    done

    if [[ "$mark_ok" != "true" ]]; then
        echo "ERROR: Server mark-processed failed after $max_attempts attempts — skipping local update to keep state in sync."
        return 1
    fi

    # Update local_feedback.jsonl to reflect processed state
    python3 -c "
import json
from datetime import datetime, timezone
cycle = $cycle
lines = []
for line in open('local_feedback.jsonl'):
    line = line.strip()
    if not line: continue
    try:
        e = json.loads(line)
        if e.get('cycle') == cycle and not e.get('processed'):
            e['processed'] = True
            e['processedAt'] = datetime.now(timezone.utc).isoformat()
        lines.append(json.dumps(e))
    except:
        lines.append(line)
with open('local_feedback.jsonl', 'w') as f:
    f.write('\n'.join(lines) + '\n')
"

    echo "Feedback for cycle $cycle marked as processed."
}

# ─── STATUS ────────────────────────────────────────────────
# Quick health check: branch, cycle, NPS trend, deploy status.

cmd_status() {
    echo "=== AutoLoop Status ==="
    echo ""

    # Current branch & cycle
    local branch
    branch=$(git branch --show-current)
    echo "Branch: $branch"

    local cycle
    cycle=$(get_cycle)
    if [[ -n "$cycle" ]]; then
        echo "Cycle:  $cycle"
    else
        local next=$(($(get_last_cycle) + 1))
        echo "Cycle:  not on autoloop branch (next would be $next)"
    fi

    # NPS trend from autoloop.md
    echo ""
    echo "NPS Trend (from iteration log):"
    local trend
    trend=$(get_nps_trend)
    if [[ -n "$trend" ]]; then
        echo "  ${trend//,/ → }"
        local latest
        latest=$(echo "$trend" | awk -F',' '{print $NF}')
        echo "  Latest: $latest  |  Target: 9.0"
        local regressing
        regressing=$(check_regression "$trend")
        echo "  Regressing: $regressing"
    else
        echo "  No NPS data yet"
    fi

    # Deploy status
    echo ""
    echo "Vercel deployment:"
    vercel ls --prod 2>&1 | head -3 || echo "  Could not check Vercel status"
}

# ─── Main dispatch ─────────────────────────────────────────

case "${1:-help}" in
    prepare)        cmd_prepare ;;
    poll)            cmd_poll ;;
    ship)            shift; cmd_ship "$@" ;;
    log)             shift; cmd_log "$@" ;;
    push)            cmd_push ;;
    mark-processed)  cmd_mark_processed ;;
    status)          cmd_status ;;
    help|*)
        echo "Usage: autoloop-cycle.sh <command> [args]"
        echo ""
        echo "Commands:"
        echo "  prepare                       Create next cycle branch, print cycle number"
        echo "  poll                          Fetch feedback in loop; exit on new feedback (JSON)"
        echo "  ship <msg> [--dry-run]        Commit, push, deploy (reads cycle from branch)"
        echo "  log <nps> <status> <desc>     Append results.tsv row (reads cycle from branch)"
        echo "  push                          Final push to save all work"
        echo "  mark-processed                Mark this cycle's feedback as processed on server"
        echo "  status                        Show branch, NPS trend, deploy health"
        ;;
esac
