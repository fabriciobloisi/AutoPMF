# AutoLoop — Self-Learning Product Cycle

AutoLoop is the engine that makes AutoPMF self-improving. Each cycle reads user feedback, evaluates the current product against its aspirations, evolves `mote.md` to get closer to the ideal app, and redeploys. The loop runs until feedback scores consistently prove Product Market Fit.

**Core principle:** `mote.md` is the product. Evolving `mote.md` IS evolving the product. Every cycle should bring `mote.md` closer to defining — and delivering — a complete, winning news app.

---

## How to Run a Cycle

### Step 1 — Gather Signal

Run `./getFeedback.sh` to fetch the latest feedback from the deployed app. Only process entries **after the most recent `AUTOLOOP ITERATION` marker** in `Feedback.txt`. If no marker exists, process all entries.

**If there is no new feedback:** still proceed to Step 2. The loop can self-improve even without fresh feedback by evaluating `mote.md` against the aspirations and feature gaps it already tracks.

### Step 2 — Evaluate the Product

Read `mote.md` end-to-end. Score the current product definition on these axes:

| Axis | Question | Score 1-10 |
|------|----------|-----------|
| **Completeness** | Does `mote.md` fully describe every feature the app has? Are there features in the code that `mote.md` doesn't govern? | |
| **Content quality** | Will following these instructions produce genuinely compelling news? | |
| **Personalization depth** | Are user preferences meaningfully reflected in generation? | |
| **Visual richness** | Will the image/gradient rules produce beautiful results? | |
| **Engagement** | Do the hook/detail rules create articles people want to read? | |
| **Diversity** | Category mix, region coverage, source variety — is it balanced? | |
| **Feature gaps** | What's missing from the product that users expect from a news app? | |
| **Clarity** | Is `mote.md` unambiguous enough that Claude will follow it consistently? | |

Cross-reference these scores with user feedback. Where feedback complaints align with low scores, that's where to focus.

### Step 3 — Evolve mote.md

Make targeted improvements to `mote.md`. Each cycle should do **one or more** of:

1. **Sharpen existing rules** — make instructions more specific where content quality is inconsistent
2. **Add missing features** — move items from the "Feature Gaps & Aspirations" checklist into the "Current Feature Set" section (only when the app code supports them, or when the feature is purely content-driven and `mote.md` can express it)
3. **Refine the schema** — add fields, tighten constraints, improve examples (never remove fields the app depends on)
4. **Update aspirations** — add new feature gaps discovered from feedback, remove ones that have been addressed, reprioritize
5. **Improve content standards** — raise the bar based on what's working and what isn't

**Always update the "AutoLoop Evolution Log"** at the bottom of `mote.md` with what changed and why.

### Step 4 — Verify & Deploy

1. Create a branch:
   ```bash
   git checkout -b autoloop/cycle-N
   ```
2. Restart the server and visually confirm the news feed reflects improvements
3. Commit, push, and deploy:
   ```bash
   git add mote.md autoloop.md Feedback.txt
   git commit -m "AutoLoop cycle N: <one-line summary>

   NPS: X.X/10 → target Y.Y/10
   mote.md changes: <bullet list>"
   git push origin autoloop/cycle-N
   export PATH="/opt/homebrew/bin:$PATH" && vercel --prod
   ```

### Step 5 — Log & Continue

Update the iteration log below, then mark the feedback boundary in `Feedback.txt`:
```
── AUTOLOOP ITERATION N ── YYYY-MM-DD ──────────────────────────────
```

Wait for new feedback, then start the next cycle.

---

## Iteration Log

| # | Date | NPS | Key Change to mote.md | Target NPS |
|---|------|-----|-----------------------|------------|
| 0 | 2026-04-06 | — | Baseline: extracted product definition, separated from feedback mechanism | 7.0 |

---

## Convergence Rules

1. **`mote.md` is the only lever for content/behavior changes.** Do not edit `app.js`, `server.js`, or `styles.css` unless the improvement requires new functionality that `mote.md` cannot express.
2. **Never process the same feedback twice.** Always look for the most recent `AUTOLOOP ITERATION` marker.
3. **One cycle = one commit.** Keep changes small enough to attribute NPS movement to specific improvements.
4. **Target NPS 9+.** Stop iterating when 3 consecutive batches average ≥ 9.0. That's PMF.
5. **If NPS drops**, a recent change may have regressed something. Read feedback carefully and roll back or adjust before adding new features.
6. **Be conservative with schema changes.** The app depends on the JSON field names — never remove or rename fields without updating app code.
7. **Evolve even without feedback.** If no new feedback arrives, still evaluate `mote.md` against its own aspirations and tighten what you can.
8. **The feature gap list in `mote.md` is a living roadmap.** Each cycle should either check off an item, add a new one, or reprioritize. The goal is for `mote.md` to converge on the complete feature definition of a winning news app.

---

## File Reference

| File | Role | When to Edit |
|------|------|-------------|
| `mote.md` | Product definition — governs all content, features, and aspirations | Every cycle |
| `Feedback.txt` | User feedback log (appended by `getFeedback.sh`) | Append only (+ iteration markers) |
| `getFeedback.sh` | Fetches remote feedback | Never |
| `autoloop.md` | This file — cycle instructions and iteration log | Update iteration log each cycle |
| `server.js` | Express backend, Claude API calls | Only for new app-level features |
| `public/app.js` | Frontend rendering logic | Only for new app-level features |
| `public/styles.css` | All styles | Only for new app-level features |
