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

# Fetch feedback as JSONL
response=$(curl -sf -H "Authorization: Bearer $FEEDBACK_SECRET" "${DEPLOY_URL}/get/feedback")

# Append raw JSONL to local file
echo "$response" >> feedback.jsonl

# Pretty-print for terminal
echo "$response" | while IFS= read -r line; do
  echo "$line" | python3 -m json.tool 2>/dev/null || echo "$line"
done

# Mark all fetched entries as processed
curl -sf -X POST \
  -H "Authorization: Bearer $FEEDBACK_SECRET" \
  "${DEPLOY_URL}/api/feedback/mark-processed"

echo ""
echo "Feedback fetched and marked as processed."
