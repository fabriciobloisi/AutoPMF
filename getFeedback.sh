#!/usr/bin/env bash
set -euo pipefail

# Load env vars if .env exists
if [ -f .env ]; then
  set -a; source .env; set +a
fi
if [ -f .env.local ]; then
  set -a; source .env.local; set +a
fi

: "${FEEDBACK_SECRET:?FEEDBACK_SECRET is not set}"
: "${DEPLOY_URL:?DEPLOY_URL is not set}"

# Read cycle number from branch name (autoloop/cycle-<N>)
cycle=""
branch=$(git branch --show-current 2>/dev/null) || branch=""
if [[ "$branch" =~ ^autoloop/cycle-([0-9]+)$ ]]; then
  cycle="${BASH_REMATCH[1]}"
fi

# Fetch only unprocessed feedback as JSONL
response=$(curl -sf -H "Authorization: Bearer $FEEDBACK_SECRET" "${DEPLOY_URL}/get/feedback?processed=false" 2>/dev/null) || response=""

if [[ -z "$response" ]]; then
  exit 0
fi

# Append to local archive with cycle number injected into each entry
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  if [[ -n "$cycle" ]]; then
    # Inject "cycle": N into each JSON line
    enriched=$(echo "$line" | python3 -c "
import sys, json
e = json.loads(sys.stdin.read())
e['cycle'] = $cycle
print(json.dumps(e))
" 2>/dev/null) || enriched="$line"
    echo "$enriched" >> local_feedback.jsonl
  else
    echo "$line" >> local_feedback.jsonl
  fi
done <<< "$response"

# Output raw JSONL to stdout — caller captures this directly
echo "$response"

# Extract timestamps of fetched entries to scope the mark-processed call
timestamps=$(echo "$response" | python3 -c "
import sys, json
ts = []
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try: ts.append(json.loads(line)['timestamp'])
    except: pass
print(json.dumps(ts))
" 2>/dev/null) || timestamps="[]"

# Mark only the fetched entries as processed on the server
curl -sf -X POST \
  -H "Authorization: Bearer $FEEDBACK_SECRET" \
  -H "Content-Type: application/json" \
  -d "{\"timestamps\":$timestamps}" \
  "${DEPLOY_URL}/api/feedback/mark-processed" >/dev/null 2>&1
