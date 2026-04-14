# AutoPMF — News App Product Definition
_Living document — refined every AutoLoop cycle_

## Purpose
AutoPMF is an AI-powered personalized news experience delivered as a mobile-first web app. This file is the single source of truth for what the app does, how content is generated, and what the product aspires to become. Claude reads this file for every news generation request.

## Vision
Create the best possible news experience — one that is accurate, balanced, contextual, beautifully presented with rich imagery, personalized to the user's interests, and global in perspective. The app should feel like a premium native news app, not a web prototype.

## Current Feature Set

### 1. AI-Generated News Feed
- Static `news.json` loads instantly on page load for immediate content
- **"Generate fresh news"** button at the bottom uses Claude API (`/api/news`) to dynamically generate additional articles with 20s timeout
- Articles are realistic, editorially diverse, and globally representative
- Each article includes headline, hook, summary, long-form detail, key facts, expert quote, metadata, and a curated image

### 2. Five Display Modes
| Mode | Experience |
|------|-----------|
| **Text** | Classic list — thumbnail left, headline + hook right. Scannable, information-dense |
| **Instagram** | Full-width hero image cards with headline overlay. Visual-first, scroll-friendly |
| **TikTok** | Full-screen immersive — one story at a time, swipe to navigate. Maximum engagement |
| **CNN** | Featured hero story + grid of secondary stories + deep-dive list. Editorial authority |
| **Widescreen** | 16:9 cinematic image cards. Wide, immersive visual layout |

### 3. Category Filtering & Search
- Horizontal scrollable category chips: All, Tech, AI, World, Business, Science, Climate, Health, Culture, Sports, Politics, Entertainment, Finance, Space, Education, Travel, Food, Opinion
- **Personalized category bar** — when the user has selected preferred topics (via onboarding or Customize), only those topics appear as chips (plus "All"). If no topics are selected, all chips are shown.
- Instant client-side filtering of the loaded feed
- **Search bar** — keyword search input below the category chips. Filters by headline, hook, summary, category, and tags in real-time. Clear button appears when typing. **Matching keywords are highlighted** in yellow across all display modes. **Results are ranked by relevance** — headline matches appear before body-only matches. **Fun empty-search messages** when no results found.

### 4. Article Detail View
- Full-screen modal with hero image, category/trending badges
- **Back button** — prominent "Back" pill button (chevron + label) in the top-left of the hero image. Standard mobile navigation pattern for clear discoverability.
- Rich content: headline, source + time + read-time, summary, long-form detail
- **Share button** — available both in the article hero area and on each feed card (text mode). Uses native Web Share API (WhatsApp, email, etc. on mobile) or copy to clipboard on desktop. Visual feedback (green flash) on clipboard copy.
- **Ask the news** — sticky footer bar at the bottom of every article with a labeled "ASK THE NEWS" prompt. Always visible without scrolling. Users ask follow-up questions and get inline AI responses. **Responses are short (2-3 sentences), conversational, and naturally formatted** — no bullet points, no markdown headers, no bold text. **Quotes key phrases from the article in italics.** Response auto-scrolls into view within the article container so the user immediately sees the answer.

### 5. Personalization & Customization
- **First-run onboarding** — on first visit, a welcome overlay ("Let's make it yours!") asks for your name, preferred topics, and region before showing any news. Preferences are saved to localStorage and applied immediately. Users can skip to get the default experience. After onboarding, a **spotlight coach mark** highlights the feedback button with a dim overlay and tooltip: "Explore the app and give feedback by pressing this button."
- **Topics** — select preferred categories to bias the feed
- **Region** — choose one or more geographic regions (Global, Americas, Europe, Asia, LatAm, Middle East, Africa). Multi-select supported — tap "Global" to reset.
- **News sources** — select preferred sources (Reuters, BBC, Bloomberg, Wired, etc.) in Customize. Only articles from selected sources appear in the feed. Leave all unselected to see everything. **"Select All" button** lets users select all sources then deselect specific ones to block/blacklist publishers.
- **Article count** — Short (5 total), Standard (8 total), or Long (15 total) feed lengths. Hint clarifies articles are spread across selected topics.
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
  "category": "Technology | Business | World | Politics | Science | Sports | Health | Culture | Climate | AI | Entertainment | Finance | Space | Education | Travel | Food | Opinion",
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
- Entertainment: ["#E040FB", "#AA00FF"]
- Finance:    ["#FF6D00", "#E65100"]
- Space:      ["#1A237E", "#0D47A1"]
- Education:  ["#00695C", "#004D40"]
- Travel:     ["#0277BD", "#01579B"]
- Food:       ["#BF360C", "#D84315"]
- Opinion:    ["#4E342E", "#3E2723"]
- Default:    ["#636e72", "#2d3436"]

## UI Design Rules
- **No emoji in badges or tags.** All badges (trending, category, impact) use clean uppercase text with letter-spacing. Professional, typographic style — never playful emoji.
- Tags should be short, lowercase, no special characters — e.g. `["trade policy", "tariffs", "china"]`

## Display Mode Content Guidance
- **Text**: thumbnail + headline + hook — image draws the eye first
- **Instagram**: full-width hero image, headline overlaid with dark gradient. Ken Burns zoom on images (6s cycle)
- **TikTok**: image fills entire screen, content overlaid at bottom. Ken Burns zoom on images (6s cycle)
- **CNN**: large hero for featured story, thumbnails for secondary
- **Widescreen**: 16:9 cinematic image cards. Ken Burns zoom on images (6s cycle)


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
| 22 | 2026-04-08 | Category bar filters to only show selected topics after personalization | User feedback (7/10): after personalizing, they don't want to see unselected categories. Category chips now hide non-selected topics when preferences are set. "All" chip always visible. |
| 24 | 2026-04-08 | Ask the news responses shorter and conversational, improved formatting | User feedback (7/10): responses were long and bot-formatted. Reduced max_tokens to 256, updated system prompt for conversational 2-3 sentence answers, render paragraphs properly in client. |
| 25 | 2026-04-08 | Share button in article detail — Web Share API on mobile, clipboard on desktop | User feedback (5/10): missing share option to send articles to friends via WhatsApp/email. Added share button in article hero with native share sheet on mobile and clipboard copy with green flash feedback on desktop. |
| 26 | 2026-04-08 | News source selector in Customize — filter feed by preferred sources | User feedback (5/10): wants to choose news sources like TechCrunch, CNN, Reuters. Added 20-source selector in Customize screen with chip toggles. Feed filters to selected sources only. |
| 27 | 2026-04-08 | Expanded categories from 10 to 17 — Entertainment, Finance, Space, Education, Travel, Food, Opinion | User feedback (5/10): too few news categories. Added 7 new categories across category bar, Customize, onboarding, with fun empty states and gradient colors. |
| 28 | 2026-04-08 | Ask the news: italic quotes from article, scroll response into view | User feedback (7/10): response requires scrolling, wants article quotes in italics. Updated prompt to quote key phrases in *italics*, render italic markdown in client, scroll response into view instead of to bottom. |
| 31 | 2026-04-08 | Multi-select categories, fix Ask the news auto-scroll | User feedback (7.5 avg): category bar should allow multi-select so feed shows all selected topics; Ask the news response should auto-focus to the new message. Changed category bar from single-select to toggle-based multi-select with "All" to reset. Fixed response scroll to use container-relative offset. |
| 33 | 2026-04-09 | Prominent "Back" button in article view | User feedback (4/10): not clear how to go back from an article. Replaced small X icon in top-right with labeled "Back" pill button (chevron + text) in top-left — standard mobile navigation pattern. |
| 34 | 2026-04-09 | Revert multi-select categories to single-select | User feedback (1.5 avg): category buttons "accrue rather than toggle" — multi-select from cycle 31 confused users. Reverted to original single-select behavior where tapping a category shows only that category. |
| 35 | 2026-04-09 | Color-coded category badges across all display modes | User feedback (7/10): category labels all look the same, need different colors for at-a-glance identification. Applied per-category colors (from gradient palette) to badges in Text, Instagram, TikTok, CNN, Video modes and article detail. |
| 36 | 2026-04-09 | Multi-select regions in Customize and onboarding | User feedback (7/10): wants to select multiple regions (e.g. Americas + Europe + Asia) instead of just one. Changed region selector to multi-select toggle with "Global" as reset. |
| 37 | 2026-04-09 | Share button on feed cards for better discoverability | User feedback (6/10): wanted share button but didn't find existing one in article view. Added share icon to each card footer in text mode, extracted reusable share helper. |
| 39 | 2026-04-09 | Clarify article count is total, not per topic | User feedback (5/10): expected 5 articles per topic but got 5 total. Updated labels to "5 total" and added hint: "Total articles in your feed — spread across your selected topics." |
| 40 | 2026-04-09 | New welcome message + feedback spotlight coach mark | User feedback (7/10): change welcome to "Let's make it yours!" and add spotlight to show where feedback button is. Updated onboarding subtitle, added post-onboarding coach mark with dim overlay highlighting the feedback FAB. |
| 41 | 2026-04-09 | Replace feedback power icon with chat bubble | User feedback (7/10): power icon (⏻) looks like a shutdown button. Replaced with chat bubble SVG — universally recognized for feedback/comments. Updated About modal reference. |
| 42 | 2026-04-09 | Fix region filtering — actually filter feed by selected regions | User feedback (6/10): region selection had no effect on feed. Added region filtering to applyFilter() — articles now filtered by selected regions. Supports both multi-select and legacy single-region preferences. |
| 47 | 2026-04-09 | Load more news button at bottom of feed | User feedback (3/10): too few articles, no way to get more. Added "Load more news" button at the bottom of the feed (all modes except TikTok) that refreshes for a new batch. |
| 48 | 2026-04-09 | Larger thumbnails in text mode (80px to 100px) | User feedback (3/10): "small images." Increased text mode card thumbnails from 80x80px to 100x100px for better visual impact. |
| 53 | 2026-04-09 | Select All / blacklist sources in Customize | User feedback (8/10): wants to blacklist certain publishers. Added "Select All" toggle to sources section — select all then deselect specific ones to block. Toggles between Select All / Clear All. |
| 54 | 2026-04-09 | Save articles for later — bookmark feature | User feedback (8/10): wants to save articles and get back to them. Added bookmark icon on text mode cards (orange when saved), "Saved" button in drawer menu to view bookmarked articles. Persisted in localStorage. |
| 57 | 2026-04-09 | Show more text in cards — headline 3 lines, summary 4 lines | User feedback (1/10): headlines and summaries truncated with "..." — wants to see full text. Increased headline line-clamp from 2 to 3 and summary from 2 to 4 for more readable cards. |
| 58 | 2026-04-09 | Rename Video mode to Widescreen, remove play button | User feedback (1/10): Video mode has play buttons but no actual videos — misleading. Renamed to "Widescreen", removed play button overlay and fake duration, changed icon. Keeps the nice 16:9 layout honestly. |
| 63 | 2026-04-09 | Lazy-load images for faster perceived load time | User feedback (1/10): "app loads very slow." Added loading="lazy" to all feed images so below-fold images don't block initial render. |
| 66 | 2026-04-09 | Fix Saved articles and card footer layout bugs | User feedback (4/10): Saved section didn't work (wrong selector), footer badges covering source text (overflow:hidden clipping buttons). Fixed nav-title selector, ensured feed screen shown, fixed footer flex layout. |
| 67 | 2026-04-09 | Cap trending badges to max 2 per feed | User feedback (3/10): too many trending articles. Added client-side cap — only the first 2 articles show "TRENDING" badge, rest hidden. Reduces visual clutter. |
| 68 | 2026-04-09 | Larger feedback slider for touch precision | User feedback (8/10): stats seemed wrong — user intended 9 but likely hit 8 due to small touch target. Increased slider thumb from 28px to 36px, track from 4px to 6px, value display from 24px to 32px for clearer feedback. |
| 69 | 2026-04-09 | Large Text accessibility toggle in Settings | User feedback (7/10): eyesight getting worse, wants colorblind/accessibility mode. Added "Large Text" toggle in Settings that increases font sizes ~20% across all views — headlines, summaries, badges, article detail. Persisted in localStorage. |
| 72 | 2026-04-10 | Infinite scroll — auto-load more news on scroll | User feedback (6/10): wants infinite scroll for more news. Replaced "Load more" button with IntersectionObserver sentinel that auto-triggers loadNews when user scrolls near bottom. |
| 75 | 2026-04-10 | Smooth fade transition on feed refresh | User feedback (6/10): "news are blinking" on refresh. Added opacity fade (0.3 → 1) during content swap to eliminate visual flash. |
| 76 | 2026-04-10 | Purple Theme toggle in Settings | User feedback (7/10): "can you make a purple theme." Added Purple Theme toggle — swaps primary blue (#0062CC) to purple (#7B2FBE) across nav, buttons, slider, and accents. Second user request for purple. |
| 79 | 2026-04-10 | Revert infinite scroll to manual Load More button | User feedback (3/10): articles flickering due to infinite scroll loop. IntersectionObserver sentinel kept re-triggering loadNews. Reverted to manual "Load more news" button for stability. |
| 83 | 2026-04-10 | Dynamic news generation via Claude API — fix Load More and refresh | User feedback (4/10): Load More button not working (re-fetched same static file), only 3 articles in filtered categories. Added `/api/news` endpoint for dynamic article generation. Refresh generates fresh articles, Load More appends new ones. Static news.json as fallback. |
| 85 | 2026-04-10 | Fresh news: date-aware generation + "Updated" timestamp | User feedback (4/10): "old news." Added today's date to Claude news prompt for timely articles. Feed shows "Updated HH:MM" timestamp. |
| 86 | 2026-04-10 | Fix feed not loading — static first, dynamic for Load More | User feedback (1/10): "News feed does not load." Dynamic API (cycle 83) was too slow on Vercel, no timeout caused infinite spinner. Reverted to static news.json for initial load (instant). Dynamic generation only via "Generate fresh news" button with 20s timeout. |
| 90 | 2026-04-14 | Article image scrolls with content; related articles section; switch dynamic news to Haiku model | User feedback (avg 6.1): article image fixed/occupying half screen; article detail is a dead-end; use Haiku for faster/cheaper dynamic generation. Hero image moved inside scrollable article body so it scrolls with text. Related Stories section shows 2-3 same-category articles at bottom of article detail. Dynamic news generation switched from Sonnet to Haiku (faster, cheaper). |
| 91 | 2026-04-14 | Fresh article on refresh; staggered card entrance animations | User feedback (avg 5.8): no micro-interactions; refresh feels stale. On each feed load, 1 fresh AI-generated article is fetched in background and prepended with "Just now" so the feed always feels live. Staggered fade-up animation on text-mode cards (35ms delay per card index). |
| 92 | 2026-04-14 | Disable refresh button during load; prevent duplicate feedback submissions | User feedback (avg 6.0): refresh button gave no loading feedback during rapid clicks; feedback submit button allowed silent duplicate submissions. Refresh button now disabled (not just spinner) during fetch. Feedback submit button stays disabled after success to prevent duplicates; only re-enabled on error so user can retry. |
| 93 | 2026-04-14 | Welcome toast after onboarding; close article before Customize; category overflow fade | User feedback (avg 5.8): name collected in onboarding but never surfaced; Customize panel unresponsive when article open; category tabs overflow with no visual affordance. Added welcome toast "Welcome, [Name]!" after onboarding submission. Drawer Customize now closes article first. Added right-edge fade gradient on category bar to signal overflow. |
| 94 | 2026-04-14 | Delay feedback spotlight until feed has settled | User feedback (7/10): spotlight tooltip hijacked screen mid rapid-click of refresh. Increased spotlight delay from 1.5s to 5s and added guard so it only shows when feed is not actively loading. |
| 95 | 2026-04-14 | Text labels on Save and Share card buttons | User feedback (avg 4/10): icon-only Save/Share buttons too small and unrecognizable, especially for older users. Added "Save" and "Share" text labels next to icons, increased minimum touch target to 32px height. |
| 96 | 2026-04-14 | All drawer actions close article first; fix Share button clipping | User feedback (avg 5.4): Settings/Stats/Progress/Saved panels failed to open when article overlay was active. Added closeArticle() to all drawer button handlers. Fixed card footer overflow so Share button is never clipped — metadata truncates instead. |
| 97 | 2026-04-14 | Strip HTML from username display; character counter in Ask the news | User feedback (8/10): username toast showed raw HTML tags when XSS payload entered. Strip HTML tags at both save and display time. Added character counter to Ask the news input — shows remaining chars when within 60 of limit, turns red at 30. |
| 98 | 2026-04-14 | Close article when drawer opens; character counter always visible | User feedback (avg 5.0): drawer buttons unclickable while article open (fixed/absolute z-index conflict on mobile). openDrawer() now calls closeArticle() first. Character counter in Ask the news now always visible (X/300 format), not only near limit. |
| 99 | 2026-04-14 | Stricter username sanitization — letters/spaces/hyphens only | User feedback (7/10): tag-stripping left inner text of XSS payload visible in greeting. Now sanitize to Unicode letters, digits, spaces, hyphens, apostrophes only. Greeting suppressed if no actual letters remain after sanitization. |
