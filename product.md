# AutoPMF — News App Product Definition
_Living document — refined every AutoLoop cycle_

## Purpose
AutoPMF is an AI-powered personalized news experience delivered as a mobile-first web app. This file is the single source of truth for what the app does, how content is generated, and what the product aspires to become. Claude reads this file for every news generation request.

## Vision
Create the best possible news experience — one that is accurate, balanced, contextual, beautifully presented with rich imagery, personalized to the user's interests, and global in perspective. The app should feel like a premium native news app, not a web prototype.

## Current Feature Set

### 1. AI-Generated News Feed
- Claude generates a batch of news articles on every refresh
- Articles are realistic, editorially diverse, and globally representative
- Each article includes headline, hook, summary, long-form detail, key facts, expert quote, metadata, and a curated image

### 2. Five Display Modes
| Mode | Experience |
|------|-----------|
| **Text** | Classic list — thumbnail left, headline + hook right. Scannable, information-dense |
| **Instagram** | Full-width hero image cards with headline overlay. Visual-first, scroll-friendly |
| **TikTok** | Full-screen immersive — one story at a time, swipe to navigate. Maximum engagement |
| **CNN** | Featured hero story + grid of secondary stories + deep-dive list. Editorial authority |
| **Video** | 16:9 image thumbnails with play button overlay. Feels like a video feed |

### 3. Category Filtering
- Horizontal scrollable category chips: All, Tech, AI, World, Business, Science, Climate, Health, Culture, Sports, Politics
- Instant client-side filtering of the loaded feed

### 4. Article Detail View
- Full-screen modal with hero image, category/trending badges
- Rich content: headline, source + time + read-time, summary, long-form detail
- **Ask Claude** — sticky footer bar at the bottom of every article with a labeled "ASK CLAUDE" prompt. Always visible without scrolling. Users ask follow-up questions and get inline AI responses

### 5. Personalization & Customization
- **Topics** — select preferred categories to bias the feed
- **Region** — choose a geographic focus (Global, Americas, Europe, Asia, LatAm, Middle East, Africa)
- **Article count** — Short (5), Standard (8), or Long (15) feed lengths
- **Display mode** — persisted in localStorage across sessions

### 6. User Feedback Loop
- NPS-style grading (0–10 slider)
- Free-text comments and suggestions
- Each submission includes a persistent `sessionId` (random UUID per browser) so AutoLoop can distinguish repeat users from unique testers
- Feedback is stored and consumed by the AutoLoop to improve this file

### 7. UI & Polish
- iPhone-frame presentation on desktop, full-screen on mobile
- Status bar with live clock, signal/wifi/battery icons
- Navigation drawer with refresh, customize, about, settings, end
- Gradient color fallbacks per category when images fail to load
- Loading spinners, empty states, error handling
- **Dark Mode** — toggle in Settings. Persisted in localStorage. Full dark theme across all views, modals, and display modes

---

## News Content Schema
Each news item must follow this exact JSON schema:

```json
{
  "id": "unique-alphanumeric-string",
  "headline": "Clear, compelling, factual headline (max 90 characters)",
  "hook": "One punchy sentence (max 120 chars) that makes the reader desperate to know more. NOT a summary — a hook.",
  "summary": "2-3 sentence balanced summary. Informative and readable.",
  "detail": "Rich, long-form journalism. 6-9 sentences. Include: (1) what happened and where, (2) why it matters personally and globally, (3) historical context, (4) expert perspective with attribution, (5) what happens next, (6) a human-interest or surprising angle.",
  "keyFacts": ["Concise fact 1", "Concise fact 2", "Concise fact 3"],
  "quote": "A compelling paraphrased quote from an expert with attribution — e.g. 'This changes everything — Dr. Sarah Chen, MIT'",
  "category": "Technology | Business | World | Politics | Science | Sports | Health | Culture | Climate | AI",
  "source": "Short source name, max 20 characters (use abbreviations: Reuters, AP, BBC, Bloomberg, FT, Guardian, Al Jazeera, DW, NHK, SCMP, Nature, Economist — never 'South China Morning Post', use 'SCMP')",
  "timeAgo": "Just now | X minutes ago | X hours ago | X days ago",
  "imageUrl": "https://source.unsplash.com/800x500/?keyword1,keyword2,keyword3,keyword4 — use 4-6 specific photojournalistic keywords",
  "imageAlt": "Brief descriptive caption (10-15 words)",
  "imageGradient": ["#hexcolor1", "#hexcolor2"],
  "trending": true or false,
  "impact": "local | national | global",
  "readTime": "X min read",
  "region": "Global | North America | Europe | Asia | Latin America | Middle East | Africa | Oceania",
  "tags": ["tag1", "tag2", "tag3"]
}
```


## Image Quality Rules
- Always use `https://source.unsplash.com/800x500/?` with 4-6 specific, visual, photojournalistic keywords
- Think like a photo editor at a major newspaper — vivid, concrete nouns and adjectives
- Examples: `climate,summit,leaders,protest` / `robot,laboratory,research,scientist` / `stadium,crowd,champion,trophy`
- `imageGradient` is the fallback — always provide it
- **Resilience:** The frontend proxies Unsplash URLs through picsum.photos for reliability. If Unsplash is down or rate-limited, images still load via picsum seeded by the keywords.

## Gradient Colors by Category
- Technology: ["#0066CC", "#7B2FBE"]
- Business:   ["#FF6B35", "#F7931E"]
- World:      ["#1A936F", "#114B5F"]
- Politics:   ["#4A4E69", "#22223B"]
- Science:    ["#00B4D8", "#0077B6"]
- Sports:     ["#52B788", "#1B4332"]
- Health:     ["#E63946", "#C1121F"]
- Culture:    ["#9B5DE5", "#F15BB5"]
- Climate:    ["#2D6A4F", "#40916C"]
- AI:         ["#7209B7", "#3A0CA3"]
- Default:    ["#636e72", "#2d3436"]

## UI Design Rules
- **No emoji in badges or tags.** All badges (trending, category, impact) use clean uppercase text with letter-spacing. Professional, typographic style — never playful emoji.
- Tags should be short, lowercase, no special characters — e.g. `["trade policy", "tariffs", "china"]`

## Display Mode Content Guidance
- **Text**: thumbnail + headline + hook — image draws the eye first
- **Instagram**: full-width hero image, headline overlaid with dark gradient
- **TikTok**: image fills entire screen, content overlaid at bottom
- **CNN**: large hero for featured story, thumbnails for secondary
- **Video**: 16:9 image with play button overlay


## AutoLoop Evolution Log
_Each cycle records what changed in this file and why._

| Cycle | Date | Change Summary | Rationale |
|-------|------|---------------|-----------|
| 0 | 2026-04-06 | Initial product definition extracted from app code | Baseline — separated product spec from feedback mechanism |
| 3 | 2026-04-06 | Removed all emoji from trending badges; replaced with clean uppercase "TRENDING" text. Removed imageEmoji from schema. Added professional badge styling rule. | User feedback (2/10): fire emoji felt unprofessional. Tags should be clean, typographic, no emoji. |
| 4 | 2026-04-06 | Added max 20-char rule for source names (use abbreviations). All footer/source lines forced to single-line with CSS nowrap + ellipsis. | User feedback (3/10): long publisher names cause footer to wrap to two lines. |
| 5 | 2026-04-06 | Moved Ask Claude to sticky footer bar with "ASK CLAUDE" label. Always visible at bottom of article view. | User feedback (4/10): Ask Claude was hidden, users couldn't find it. |
| 6 | 2026-04-06 | Added dark mode toggle in Settings. Full dark theme across all views, cards, modals, nav, article detail. Persisted in localStorage. | User feedback (5/10): no dark mode option. |
| 7 | 2026-04-06 | Fix getFeedback.sh casing bug; image resilience via picsum proxy; session_id tracking in feedback; implement dark mode with toggle in Settings | Feedback fetch was silently broken (wrong filename casing). Unsplash URLs unreliable at scale — picsum.photos is more resilient. Session IDs let AutoLoop distinguish repeat users from unique ones. Dark mode was claimed in iteration 6 but never implemented — now fully working with iOS-style toggle and comprehensive dark theme. |
| 8 | 2026-04-06 | Fix card images hidden by gradient fallback overlay; default remains light mode | Gradient fallback div was absolutely positioned on top of the real image in card views, hiding loaded photos. Fallback now hidden by default and only shown on image load error. Light mode is already the default — no change needed. |
