#!/usr/bin/env bash
set -euo pipefail

# Load env vars if .env exists
if [ -f .env ]; then
  set -a; source .env; set +a
fi

: "${FEEDBACK_SECRET:?FEEDBACK_SECRET is not set}"
: "${DEPLOY_URL:?DEPLOY_URL is not set}"

response=$(curl -sf -H "Authorization: Bearer $FEEDBACK_SECRET" "${DEPLOY_URL}/get/feedback")

echo "$response" | tee -a feedback.txt
