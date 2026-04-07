---
description: "AutoLoop Phase 2: Fetch feedback, parse, plan, and build changes"
allowed-tools:
  - "Bash(bash scripts/autoloop-cycle.sh:*)"
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - WebSearch
---

# AutoLoop — Phase 2: Get & Process Feedback

## Step 1 — FETCH

Run the poll script (non-blocking — returns immediately if feedback exists):

```bash
bash scripts/autoloop-cycle.sh poll
```

This calls `getFeedback.sh` internally, fetches **unprocessed** entries from the server, marks them processed, appends to `local_feedback.jsonl`, and outputs structured JSON:

```json
{
  "has_new_feedback": true,
  "cycle": 11,
  "entries": [{"timestamp": "...", "grade": 5, "comments": "...", "suggestion": "..."}],
  "avg_nps": 5.0,
  "nps_trend": [2.0, 3.0, 4.0, 5.0, 5.0, 6.0],
  "regressing": false
}
```

**If `has_new_feedback` is false:**
EXIT immediately. Do not continue to Step 2. The stop hook will poll for new feedback.

**If `has_new_feedback` is true:** use the JSON output directly. Continue to Step 2.

## Step 2 — PLAN

Read `product.md` end-to-end. Answer these three questions (internally):

1. **What is the user asking for?** — Translate feedback into a concrete change.
2. **Is this a product.md change, a code change, or both?**
3. **Can I ship this in one small commit?** — If not, pick the smallest slice that addresses the core complaint.

**Revert check:** If the JSON output has `"regressing": true`, do NOT fix forward. Instead, identify which earlier change likely caused the regression, revert it, and confirm NPS recovers before making any new changes.

## Step 3 — BUILD

Make the changes. Rules:

- **Always update `product.md`** — even if the fix is code-only, document the change in the Evolution Log at the bottom of `product.md`.
- **Never remove schema fields** the app depends on.
- **Never edit `getFeedback.sh`.**
- Code changes go in `public/app.js`, `public/styles.css`, `public/index.html`, or `server.js` as needed.

## File Reference

| File | Role | When to Edit |
|------|------|-------------|
| `product.md` | Product definition — governs all content and features | Every cycle with feedback |
| `server.js` | Express backend, Claude API calls | When feedback requires backend changes |
| `public/app.js` | Frontend logic | When feedback requires frontend changes |
| `public/index.html` | HTML structure | When feedback requires structural changes |
| `public/styles.css` | All styles | When feedback requires visual changes |
