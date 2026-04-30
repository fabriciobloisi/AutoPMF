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
# Default 3m between polls; set AUTOLOOP_SLEEP=600 for slower cadence
SLEEP_INTERVAL="${AUTOLOOP_SLEEP:-180}"
# Minimum feedback entries required before cycling.
# Set AUTOLOOP_MIN_FEEDBACK=5 to wait for at least 5 responses per cycle.
MIN_FEEDBACK="${AUTOLOOP_MIN_FEEDBACK:-1}"

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
        # || true: subshell capture drops stdout on non-zero; keep empty raw → sleep.
        raw=$(bash ./getFeedback.sh 2>/dev/null || true)
        if [[ -n "$raw" ]]; then
            echo "Fetched feedback (${#raw} bytes)."
            local trend
            trend=$(get_nps_trend)
            local regressing
            regressing=$(check_regression "$trend")

            # JSON via stdin — avoids bash/python breakage when comments contain quotes, $(), etc.
            export AUTOLOOP_POLL_CYCLE="$cycle"
            export AUTOLOOP_POLL_TREND="$trend"
            export AUTOLOOP_POLL_REGRESSING="$regressing"
            export AUTOLOOP_MIN_FEEDBACK="$MIN_FEEDBACK"
            printf '%s' "$raw" | python3 -c "
import json, os, sys

raw = sys.stdin.read()
cycle = int(os.environ['AUTOLOOP_POLL_CYCLE'])
trend_s = os.environ.get('AUTOLOOP_POLL_TREND', '')
regressing = os.environ.get('AUTOLOOP_POLL_REGRESSING', '') == 'true'

lines = raw.strip().split('\n')
entries = []
skipped = []
min_feedback = int(os.environ.get('AUTOLOOP_MIN_FEEDBACK', '1'))
for line in lines:
    line = line.strip()
    if not line:
        continue
    try:
        e = json.loads(line)
        grade = e.get('grade')
        # Guardrails: skip entries with missing/invalid grade or empty content
        if grade is None:
            skipped.append({'reason': 'missing_grade', 'entry': e})
            continue
        # Accept numeric strings (e.g. "8" from web forms) in addition to int/float
        try:
            grade = float(grade)
        except (TypeError, ValueError):
            skipped.append({'reason': 'invalid_grade', 'entry': e})
            continue
        if not (0 <= grade <= 10):
            skipped.append({'reason': 'invalid_grade', 'entry': e})
            continue
        comments = (e.get('comments', '') or '').strip()
        suggestion = (e.get('suggestion', '') or '').strip()
        # Skip entries with suspiciously short/spammy feedback
        if len(comments) < 2 and len(suggestion) < 2:
            skipped.append({'reason': 'empty_feedback', 'entry': e})
            continue
        entries.append({
            'timestamp': e.get('timestamp', ''),
            'grade': float(grade),
            'comments': comments,
            'suggestion': suggestion,
        })
    except Exception:
        pass

# Store skipped entries for future reference
if skipped:
    skipped_file = 'skipped_feedback.jsonl'
    with open(skipped_file, 'a') as sf:
        for s in skipped:
            sf.write(json.dumps(s) + '\n')

if not entries:
    json.dump({'has_new_feedback': False, 'skipped': len(skipped)}, sys.stdout)
    print()
    sys.exit(0)

# Dynamic threshold: wait for AUTOLOOP_MIN_FEEDBACK entries before cycling
if len(entries) < min_feedback:
    json.dump({'has_new_feedback': False, 'pending': len(entries), 'needed': min_feedback, 'skipped': len(skipped)}, sys.stdout)
    print()
    sys.exit(0)

grades = [e['grade'] for e in entries]
avg = round(sum(grades) / len(grades), 1)
trend = [float(x) for x in trend_s.split(',') if x]

json.dump({
    'has_new_feedback': True,
    'cycle': cycle,
    'entries': entries,
    'entry_count': len(entries),
    'avg_nps': avg,
    'nps_trend': trend,
    'regressing': regressing,
    'skipped': len(skipped),
}, sys.stdout, indent=2)
print()
"
            unset AUTOLOOP_POLL_CYCLE AUTOLOOP_POLL_TREND AUTOLOOP_POLL_REGRESSING
            exit 0
        fi

        echo "No new feedback (empty body — auth fail, curl timeout, or min_feedback not reached). Sleeping ${SLEEP_INTERVAL}s..."
        echo "  (tip: set AUTOLOOP_MIN_FEEDBACK=N to require N entries before cycling; currently ${MIN_FEEDBACK})"
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

    # Print NPS trend sparkline
    local trend
    trend=$(get_nps_trend)
    if [[ -n "$trend" ]]; then
        python3 -c "
t = [float(x) for x in '$trend'.split(',') if x]
if not t:
    exit(0)
bars = ' ▁▂▃▄▅▆▇█'
mn, mx = min(t), max(t)
rng = mx - mn if mx != mn else 1
sparkline = ''.join(bars[min(8, max(0, int((v - mn) / rng * 8)))] for v in t)
latest = t[-1]
arrow = '↑' if len(t) >= 2 and t[-1] > t[-2] else '↓' if len(t) >= 2 and t[-1] < t[-2] else '→'
print(f'  NPS trend: {sparkline} {latest} {arrow}')
"
    fi
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
        if curl -sf --connect-timeout 15 --max-time 120 -X POST \
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

# ─── ROLLBACK ────────────────────────────────────────────
# Usage: autoloop-cycle.sh rollback
#
# Hard-resets the current autoloop branch to the previous cycle.
# Used when NPS regresses after a deploy. Safe to call multiple times.

cmd_rollback() {
    local cycle
    cycle=$(get_cycle)
    [[ -z "$cycle" ]] && die "Not on an autoloop/cycle-N branch."
    [[ "$cycle" -le 1 ]] && die "Cannot rollback cycle 1 (no previous cycle)."

    local prev=$((cycle - 1))
    local prev_branch="autoloop/cycle-${prev}"

    echo "⚠️  Rolling back cycle $cycle → restoring from $prev_branch..."

    # Restore changed product files from the previous cycle branch
    for f in product.md server.js public/app.js public/styles.css public/index.html; do
        if git ls-files --error-unmatch "origin/$prev_branch:$f" &>/dev/null 2>&1 \
            || git show "origin/$prev_branch:$f" &>/dev/null 2>&1; then
            git show "origin/$prev_branch:$f" > "$f" 2>/dev/null && echo "  Restored $f"
        fi
    done

    git add product.md server.js public/app.js public/styles.css public/index.html
    git commit -m "AutoLoop rollback: revert cycle $cycle changes (NPS regression)"
    git push origin "autoloop/cycle-${cycle}"

    echo "Deploying rollback to Vercel..."
    vercel --prod --yes
    echo "Rollback deployed. Monitor NPS before creating a new cycle."
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


# ─── LEARN ────────────────────────────────────────────────
# Usage: autoloop-cycle.sh learn <cycle> <nps> <prev_nps> <description> [diff_summary]
#
# Appends a structured entry to learnings.md — the self-learning memory file.
# Inspired by Hermes Agent's MEMORY.md pattern: each cycle writes what it
# learned so the next cycle can build on it instead of starting blind.
#
# learnings.md is injected into autoloop-feedback.md as context for Claude,
# giving it the equivalent of Hermes's "execution traces" to understand
# WHY previous changes worked or failed before proposing new ones.

cmd_learn() {
    local cycle="${1:?Usage: learn <cycle> <nps> <prev_nps> <description>}"
    local nps="${2:?Usage: learn <cycle> <nps> <prev_nps> <description>}"
    local prev_nps="${3:?Usage: learn <cycle> <nps> <prev_nps> <description>}"
    shift 3
    local description="$*"
    [[ -z "$description" ]] && die "Description required"

    # LEARNINGS_FILE can be overridden for testing
    local learnings_file="${LEARNINGS_FILE:-learnings.md}"

    export AUTOLOOP_CYCLE="$cycle"
    export AUTOLOOP_NPS="$nps"
    export AUTOLOOP_PREV_NPS="$prev_nps"
    export AUTOLOOP_DESCRIPTION="$description"
    export AUTOLOOP_DIFF_SUMMARY="${AUTOLOOP_DIFF_SUMMARY:-}"
    export LEARNINGS_FILE="$learnings_file"

# LEARNINGS_UPDATE_START
python3 << 'PYEOF_LEARN'
import os
from datetime import datetime
from pathlib import Path

cycle = int(os.environ['AUTOLOOP_CYCLE'])
nps = float(os.environ['AUTOLOOP_NPS'])
prev_nps = float(os.environ['AUTOLOOP_PREV_NPS'])
description = os.environ['AUTOLOOP_DESCRIPTION']
diff_summary = os.environ.get('AUTOLOOP_DIFF_SUMMARY', '').strip()
learnings_file = Path(os.environ.get('LEARNINGS_FILE', 'learnings.md'))
today = datetime.now().strftime('%Y-%m-%d')

delta = round(nps - prev_nps, 1)
sign = '+' if delta >= 0 else ''
arrow = '\u2191' if delta > 0 else ('\u2193' if delta < 0 else '\u2192')
if delta <= -1.5:
    outcome = 'REGRESSION \u26a0\ufe0f'
elif delta >= 1.5:
    outcome = 'WIN \u2705'
else:
    outcome = 'neutral'

lines = [
    f'## Cycle {cycle} \u2014 {today}',
    f'**Change:** {description}',
    f'**NPS:** {prev_nps} \u2192 {nps} ({sign}{delta} {arrow}) \u2014 {outcome}',
]
if diff_summary:
    lines.append(f'**What changed:** {diff_summary}')

if delta <= -1.5:
    lines.append('**Lesson:** Regression. Avoid this direction or revert if NPS does not recover.')
elif delta >= 2.0:
    lines.append('**Lesson:** High-impact. Build on this pattern in future cycles.')
elif delta >= 0.5:
    lines.append('**Lesson:** Positive. Continue iterating in this direction.')
else:
    lines.append('**Lesson:** Minimal impact. Try a different approach next cycle.')

entry = '\n'.join(lines)

if not learnings_file.exists():
    header = '# AutoPMF Self-Learning Memory\n\n'
    header += '_Execution traces for the AutoLoop self-learning loop._\n'
    header += '_Inspired by Hermes Agent MEMORY.md: injected into every cycle so Claude builds on experience rather than starting blind._\n\n'
    header += '---\n\n'
    learnings_file.write_text(header + entry + '\n')
else:
    existing = learnings_file.read_text()
    learnings_file.write_text(existing + '\n---\n\n' + entry + '\n')

print(f'learnings.md updated: cycle {cycle}, NPS {prev_nps}->{nps} ({sign}{delta} {arrow})')
PYEOF_LEARN
# LEARNINGS_UPDATE_END
    unset AUTOLOOP_CYCLE AUTOLOOP_NPS AUTOLOOP_PREV_NPS AUTOLOOP_DESCRIPTION AUTOLOOP_DIFF_SUMMARY
}

# ─── ANALYZE-FEEDBACK ─────────────────────────────────────────────────────
# Usage: autoloop-cycle.sh analyze-feedback
#
# Reads local_feedback.jsonl and produces a pattern analysis:
# - What NPS < 5 users say (pain points to fix)
# - What NPS >= 8 users say (wins to amplify)
# - Most common suggestions
#
# Outputs JSON injected into the Claude context in autoloop-feedback.md.
# This is AutoPMF's mini-GEPA: understand WHY before deciding WHAT.

cmd_analyze_feedback() {
    local cycle
    cycle=$(get_cycle)
    [[ -z "$cycle" ]] && die "Not on an autoloop/cycle-N branch."

    [[ ! -f local_feedback.jsonl ]] && echo "{}" && return 0

# FEEDBACK_ANALYSIS_START
python3 -c "
import json, os, re
from collections import Counter
from pathlib import Path

feedback_file = Path(os.environ.get('FEEDBACK_JSONL', 'local_feedback.jsonl'))
if not feedback_file.exists():
    print('{}')
    exit(0)

entries = []
for line in feedback_file.read_text().splitlines():
    line = line.strip()
    if not line:
        continue
    try:
        e = json.loads(line)
        if e.get('grade') is not None:
            try:
                e['grade'] = float(e['grade'])
                entries.append(e)
            except (TypeError, ValueError):
                pass
    except Exception:
        pass

if not entries:
    print('{}')
    exit(0)

high = [e for e in entries if e['grade'] >= 8]
low  = [e for e in entries if e['grade'] <= 4]
mid  = [e for e in entries if 4 < e['grade'] < 8]

def extract_keywords(entry_list, max_words=10):
    stopwords = {'the','a','an','and','or','but','in','on','at','to','for','of',
                 'with','is','it','this','that','was','are','i','my','me','we',
                 'its','be','have','had','has','do','did','not','no','so','as',
                 'app','hermes','autopmf','news','article'}
    words = Counter()
    for e in entry_list:
        text = ' '.join(filter(None, [
            str(e.get('comments', '') or ''),
            str(e.get('suggestion', '') or ''),
        ])).lower()
        for w in re.findall(r'[a-z]{3,}', text):
            if w not in stopwords:
                words[w] += 1
    return [w for w, _ in words.most_common(max_words)]

def avg_nps(lst):
    return round(sum(e['grade'] for e in lst) / len(lst), 1) if lst else 0

suggestions = Counter()
for e in entries:
    s = str(e.get('suggestion','') or '').strip()
    if len(s) > 5:
        suggestions[s] += 1

analysis = {
    'total_entries': len(entries),
    'avg_nps': avg_nps(entries),
    'high_nps': {
        'count': len(high),
        'avg': avg_nps(high),
        'keywords': extract_keywords(high),
        'label': 'What satisfied users (NPS >= 8) value'
    },
    'low_nps': {
        'count': len(low),
        'avg': avg_nps(low),
        'keywords': extract_keywords(low),
        'label': 'What dissatisfied users (NPS <= 4) complain about'
    },
    'top_suggestions': [s for s, _ in suggestions.most_common(5)],
}
print(json.dumps(analysis, indent=2))
"
# FEEDBACK_ANALYSIS_END
}

# ─── Main dispatch ─────────────────────────────────────────

case "${1:-help}" in
    prepare)        cmd_prepare ;;
    poll)            cmd_poll ;;
    ship)            shift; cmd_ship "$@" ;;
    log)             shift; cmd_log "$@" ;;
    push)            cmd_push ;;
    mark-processed)  cmd_mark_processed ;;
    rollback)        cmd_rollback ;;
    learn)           shift; cmd_learn "$@" ;;
    analyze-feedback) cmd_analyze_feedback ;;
    status)          cmd_status ;;
    help|*)
        echo "Usage: autoloop-cycle.sh <command> [args]"
        echo ""
        echo "Commands:"
        echo "  prepare                       Create next cycle branch, print cycle number"
        echo "  poll                          Fetch feedback in loop; exit on new feedback (JSON)"
        echo "    env: AUTOLOOP_SLEEP=N       Sleep N seconds between polls (default: 180)"
        echo "    env: AUTOLOOP_MIN_FEEDBACK=N  Wait for at least N valid entries per cycle (default: 1)"
        echo "  ship <msg> [--dry-run]        Commit, push, deploy (reads cycle from branch)"
        echo "  log <nps> <status> <desc>     Append results.tsv row + print NPS sparkline"
        echo "  push                          Final push to save all work"
        echo "  mark-processed                Mark this cycle's feedback as processed on server"
        echo "  rollback                      Revert cycle changes after NPS regression"
        echo "  learn <c> <nps> <prev> <desc> Append entry to learnings.md (self-learning memory)"
        echo "  analyze-feedback              Analyze feedback patterns (mini-GEPA: WHY before WHAT)"
        echo "  status                        Show branch, NPS trend, deploy health"
        ;;
esac
