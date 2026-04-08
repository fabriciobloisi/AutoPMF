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

### 3. Category Filtering & Search
- Horizontal scrollable category chips: All, Tech, AI, World, Business, Science, Climate, Health, Culture, Sports, Politics
- Instant client-side filtering of the loaded feed
- **Search bar** — keyword search input below the category chips. Filters by headline, hook, summary, category, and tags in real-time. Clear button appears when typing. **Matching keywords are highlighted** in yellow across all display modes. **Results are ranked by relevance** — headline matches appear before body-only matches. **Fun empty-search messages** when no results found.

### 4. Article Detail View
- Full-screen modal with hero image, category/trending badges
- Rich content: headline, source + time + read-time, summary, long-form detail
- **Ask the news** — sticky footer bar at the bottom of every article with a labeled "ASK THE NEWS" prompt. Always visible without scrolling. Users ask follow-up questions and get inline AI responses

### 5. Personalization & Customization
- **First-run onboarding** — on first visit, a welcome overlay asks for your name, preferred topics, and region before showing any news. Preferences are saved to localStorage and applied immediately. Users can skip to get the default experience.
- **Topics** — select preferred categories to bias the feed
- **Region** — choose a geographic focus (Global, Americas, Europe, Asia, LatAm, Middle East, Africa)
- **Article count** — Short (5), Standard (8), or Long (15) feed lengths
- **Display mode** — persisted in localStorage across sessions (accessible via Customize screen)

### 6. User Feedback Loop
- NPS-style grading (0–10 slider)
- Free-text comments (single field — simple and focused)
- Each submission includes a persistent `sessionId` (random UUID per browser) so AutoLoop can distinguish repeat users from unique testers
- Feedback is stored and consumed by the AutoLoop to improve this file

### 7. UI & Polish
- iPhone-frame presentation on desktop, full-screen on mobile
- Status bar with live clock, signal/wifi/battery icons
- Navigation drawer with refresh, customize, about, settings, end
- Gradient color fallbacks per category when images fail to load
- Loading spinners, **fun category-specific empty states** with witty messages, error handling
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
- **Instagram**: full-width hero image, headline overlaid with dark gradient. Ken Burns zoom on images (6s cycle)
- **TikTok**: image fills entire screen, content overlaid at bottom. Ken Burns zoom on images (6s cycle)
- **CNN**: large hero for featured story, thumbnails for secondary
- **Video**: 16:9 image with play button overlay. Ken Burns zoom on images (6s cycle)


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
| 9 | 2026-04-06 | Ken Burns slow zoom animation on images in Instagram, TikTok, and Video modes | User feedback (6/10): everything felt boring and static. Added subtle 12s zoom animation to card images in visual modes for movement and life. |
| 10 | 2026-04-07 | Search bar added below category chips — keyword filter across headline, hook, summary, category, and tags | User feedback (3/10): "I need search". Added real-time search input with clear button. Works in combination with category filter. |
| 11 | 2026-04-07 | Search keyword highlighting in feed cards — matching text wrapped in yellow `<mark>` tags across all display modes | User feedback (4/10): search should highlight matching keywords in articles. Added highlight function for headline and summary in all 5 modes, with dark mode support. |
| 12 | 2026-04-07 | Search results prioritise headline matches over body-only matches | User feedback (4/10): title should be prioritised over main text in search. Added stable sort so headline matches rank first. |
| 13 | 2026-04-08 | Fun empty-category messages, darker blue theme, rename "Ask Claude" to "Ask the news" | User feedback (5.5 avg): empty categories need funny messages; blue too bright; "Ask Claude" should say "Ask the news". Added per-category witty empty states, darkened primary blue from #007AFF to #0062CC, renamed footer label. |
| 14 | 2026-04-08 | Simplified feedback form (removed suggestion field), faster Ken Burns animation (6s, 12% zoom) | User feedback (5.8 avg): feedback form too complex with separate suggestion field; image animations too slow/subtle. Streamlined to single comments field, doubled animation speed from 12s to 6s with increased zoom from 8% to 12%. |
| 15 | 2026-04-08 | Fun empty-search messages, mobile safe-area fix for iPhone, fix mark-processed server bug | User feedback (6.5 avg): search needs funny empty state; white area above app on iPhone 15; Ask the news not visible on mobile. Applied safe-area-inset-top/bottom for all mobile browsers (not just standalone), added ask footer bottom padding, colored body to match nav bar. Fixed server mark-processed bug (broken etag handling). |
| 16 | 2026-04-08 | Fix feedback FAB hidden on mobile by safe-area inset | User feedback (3.0): feedback button invisible on mobile. The FAB was positioned at top:6px but the nav bar gained safe-area padding in cycle 15, pushing it behind the notch. Added safe-area-inset-top offset to FAB on mobile. |
| 17 | 2026-04-08 | Fix blue bar on mobile — neutral body background instead of brand color | User feedback (5.0): visible blue strip on mobile from body background. Changed mobile body from #0062CC to #f2f2f7 (neutral gray matching content area). Dark mode uses #000. |
| 18 | 2026-04-08 | Fix Ask the news — increase server timeout, add client-side timeout with auto-scroll | User feedback (5.0): "Claude did not respond; something went wrong after asking the news." Vercel serverless function had 10s default timeout, too short for Claude API. Extended to 60s. Added 30s client-side abort with clear error message. Auto-scroll article body to show response. |
| 19 | 2026-04-08 | Remove bottom mode bar, add first-run onboarding for personalization | User feedback (3.5 avg): bottom mode bar wastes space, users want personalized news. Removed persistent mode bar (mode selection lives in Customize). Added first-run onboarding overlay asking name, topics, region — preferences saved to localStorage and applied immediately. |
| 21 | 2026-04-08 | Fix Vercel Blob cache causing duplicate feedback processing | Vercel Blob cacheControlMaxAge was 60s, causing stale reads during mark-processed. Set to 0 for immediate consistency. |
