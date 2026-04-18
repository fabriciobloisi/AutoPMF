# AutoPMF — Weather App Product Definition
_Living document — refined every AutoLoop cycle_

## Purpose
AutoPMF is a comprehensive weather dashboard delivered as a mobile-first web app. This file is the single source of truth for what the app does and what the product aspires to become. The weather experience is the primary screen; legacy feed and customization screens remain accessible via the drawer.

## Vision
Create the best possible weather experience — one that is data-rich, visually appealing, easy to navigate, and feels like a premium native weather app (think Weather Underground / Apple Weather). The app should present current conditions, forecasts, historical data, and environmental metrics in a clean, intuitive interface.

## Current Feature Set

### 1. Weather Dashboard (Primary Experience)
Accessible from the drawer menu. Contains five tabs at the bottom:

| Tab | Description |
|-----|-------------|
| **Today** | Current conditions hero (temperature, icon, phrase, feels-like, high/low), quick-stat row (humidity, wind, pressure, visibility), detailed condition cards (dew point, UV index, cloud cover, wind, pressure, 24h change), precipitation summary, sunrise/sunset arc, air quality index with pollutant breakdown, pollen forecast |
| **Forecast** | 7-day forecast cards (horizontally scrollable), temperature line chart (Chart.js), precipitation probability bar chart, moon phases row, hourly detail table (24 rows) |
| **Calendar** | Monthly calendar grid with per-day weather icons, temperatures, and precipitation bars. Tap a day for detail panel. Toggle historical averages overlay. Monthly summary stats (total precip, rainy/sunny days, averages, warmest/wettest day). Navigate between months |
| **History** | Date-range picker for historical observations. Summary cards (max/min temp, total rain, avg humidity, max wind). Temperature range line chart and daily precipitation bar chart. Sortable observations table. CSV export |
| **Search** | Current location card with coordinates and station info. City search with autocomplete. Recent searches list. Popular cities grid. Selecting a city reloads all weather data |

### 2. Weather Data
- Current conditions, 7-day forecast, and hourly data are fetched **live from Open-Meteo** (free, no API key) and cached 5 minutes server-side. Calendar, history, pollen and AQI remain mock data.
- Data models mirror Weather Underground / api.weather.com field names
- Default location: Amsterdam, NL (station EHAM)
- Endpoints: `/api/weather/current`, `/api/weather/forecast`, `/api/weather/hourly`, `/api/weather/aqi`, `/api/weather/pollen`, `/api/weather/calendar`, `/api/weather/almanac`, `/api/weather/history`, `/api/weather/search`
- Search database includes: Amsterdam, Rotterdam, London, Paris, Berlin, Rome, Madrid, Barcelona, Vienna, Prague, New York, Tokyo

### 3. Legacy Feed & Customization (Drawer)
The original news feed, article detail, customize, and onboarding screens are still present in the HTML and accessible via the drawer. These include:
- AI-generated news feed with static `news.json` + dynamic generation via Claude API
- Five display modes (Text, Instagram, TikTok, CNN, Widescreen)
- Category filtering, search, article detail with "Ask the news"
- Personalization (topics, regions, sources, article count)
- First-run onboarding

### 4. User Feedback Loop
- Persistent feedback FAB (chat bubble) visible on all screens
- NPS-style grading (0-10 slider) + free-text comments
- Each submission includes a persistent `sessionId` (random UUID per browser)
- Feedback stored in Vercel Blob (`feedback/weather/feedback.jsonl`)
- Stats screen and Progress screen show aggregate feedback data
- Feedback is consumed by AutoLoop to improve this product definition

### 5. UI & Polish
- iPhone-frame presentation on desktop, full-screen on mobile
- Status bar with live clock, signal/wifi/battery icons
- Navigation drawer with refresh, customize, saved, about, weather, stats, progress, settings
- Dark mode toggle in Settings (persisted in localStorage)
- Large text accessibility toggle
- Purple theme toggle
- Chart.js for temperature and precipitation visualizations
- Loading spinners, error states

---

## Weather API Schema

### Current Conditions
Key fields: `temperature`, `feelsLike`, `humidity`, `windSpeed`, `windDirectionCardinal`, `windDirection`, `pressureMeanSeaLevel`, `pressureTendencyTrend`, `visibility`, `uvIndex`, `uvDescription`, `cloudCover`, `cloudCoverPhrase`, `iconCode`, `wxPhraseLong`, `dewPoint`, `precip1Hour`, `precip6Hour`, `precip24Hour`, `snow24Hour`, `sunriseTimeLocal`, `sunsetTimeLocal`, `temperatureMax24Hour`, `temperatureMin24Hour`, `temperatureChange24Hour`, `shortRangeForecast`, `stationName`, `obsTimeLocal`

### Forecast (7-day array)
Fields per day: `dow`, `narrative`, `iconCode`, `high`, `low`, `precipChance`, `windDir`, `windSpeed`, `moonPhase`

### Hourly (24-item array)
Fields: `hour`, `iconCode`, `temp`, `feelsLike`, `humidity`, `windSpeed`, `precipChance`

### Air Quality
Fields: `airQualityIndex`, `primaryPollutant`, `pollutants` (object with PM2.5, PM10, O3, NO2, SO2, CO — each has `index`, `amount`, `unit`)

### Pollen (5-day array)
Fields per day: `period`, `tree`, `treeLabel`, `grass`, `grassLabel`, `ragweed`, `ragweedLabel`

### Calendar (monthly array)
Fields per day: `day`, `iconCode`, `high`, `low`, `precip`, `condition`

### History (date-range array)
Fields per day: `date`, `maxTemp`, `minTemp`, `avgTemp`, `precip`, `humidity`, `windMax`, `iconCode`

### Search results (array)
Fields: `displayName`, `address`, `type`, `flag`, `countryCode`, `lat`, `lon`, `locId`, `alt`

## Weather Icon Mapping
Icon codes 1-47 map to emoji weather icons. Key mappings:
- 1: Tornado, 4: Thunderstorms, 11-12: Rain/Showers, 15-16: Snow
- 26: Cloudy, 28-30: Partly Cloudy, 32: Sunny, 34: Mostly Sunny

## UI Design Rules
- Weather hero uses dark gradient background (`#1a3a5c` to `#0f2847`) with white text
- Temperature colors scale from blue (cold) through cyan/green/yellow to red (hot)
- AQI badges color-coded: green (good) through red/purple (unhealthy)
- Pollen levels color-coded: green (low) through red (very high)
- Cards use 12px border-radius, section labels are 11px uppercase
- Full dark mode support across all weather components

---

## AutoLoop Evolution Log
_Each cycle records what changed in this file and why._

| Cycle | Date | Change Summary | Rationale |
|-------|------|---------------|-----------|
| 0 | 2026-04-16 | PIVOT — Rewrote product.md from news app to weather app | Product pivoted to weather dashboard. Previous 99 cycles were on the news app. Weather screen with Today/Forecast/Calendar/History/Search tabs added in PIVOT commit. Mock weather APIs serve Amsterdam data. |
| 1 | 2026-04-16 | Real weather data via Open-Meteo API (NPS 5.0 baseline) | Replaced static mock data with live Open-Meteo API for current conditions, 7-day forecast, and hourly data. Frontend now passes lat/lon per location so any searched city shows real weather. Fallback to 500 error on API failure. Calendar, history, pollen remain mock. |
| 2 | 2026-04-16 | Error recovery UX, city-switch confirmation, font/spacing boost (NPS 5.4) | Added friendly error state with plain-language message and Retry button instead of bare 500 error. Added showToast("Switched to City") confirmation after city selection and fixed header update to use element ID. Increased body font sizes (11→12px labels, 13→14px stats, 14→15px list items) and padding for better mobile readability. |
| 3 | 2026-04-16 | Debounce concurrent loads + auto-retry on error (NPS 4.0 single entry) | Added loadBusy flag to prevent overlapping requests from rapid refresh taps. Refresh button silently drops taps while a load is in-flight. Auto-retries once after 15s on error so users don't need to manually tap Retry. |
| 4 | 2026-04-16 | Minimum 400ms loading display + city name in error state + larger tab bar (NPS 6.1) | Loading spinner now stays visible for at least 400ms so Retry tap always produces visible feedback. Error state now shows city name ("Can't load weather for London") confirming context switch even on failure. Tab bar height 50→56px, icons 18→20px, min tap target 44px for better touch accuracy. |
| 5 | 2026-04-16 | Vercel Blob weather cache — 30-min fallback survives cold starts (NPS 4.0 single entry) | Root-cause fix for recurring 500 errors: successful Open-Meteo responses are now persisted to Vercel Blob. On cold-start cache misses or live API failures, server falls back to the blob-cached data (up to 30 min stale) before returning an error. Eliminates 500s for most returning users. |
| 6 | 2026-04-16 | Fix 400 error from removed Open-Meteo moonphase field + city flag in loading/error screens (NPS 5.6) | Root cause of ALL 500 errors: Open-Meteo removed the 'moonphase' daily variable — every request was returning 400. Removed it from the API call and compute moon phase locally via Julian Date formula. Also: loading and error screens now show city flag (40px) and city name (20px bold) for unambiguous city switch confirmation. |
| 7 | 2026-04-16 | Actionable error recovery: "Try a different city" button, Retry feedback, refresh spinner tied to load (NPS 2.0) | Users saw error state with no visible confirmation that Retry or Refresh did anything. Added: (1) "Try a different city" secondary button in error state that switches to Search tab; (2) Retry button shows "Retrying…" and disables while request is in-flight; (3) Refresh header icon stays spinning until loadAll() resolves instead of fixed 1.2s; (4) Toast "Weather loaded ✓" on successful recovery from error state. |
| 8 | 2026-04-16 | Refresh toast, search input retention, labeled Remove button (NPS 6.7) | Three UX gaps: (1) "Refreshed ✓" toast after every successful non-initial reload so users know refresh worked; (2) showDefaults() now updates only #wx-sr without re-rendering the entire view — typed text in search input is preserved when fewer than 2 chars; (3) Recent search delete button changed from unlabeled "✕" to labeled "Remove" with red styling for clarity. |
| 9 | 2026-04-16 | Animated loading dots, larger spinner, refresh always acknowledges tap (NPS 8.0) | Loading feedback polish: animated three-dot ellipsis on loading text makes the load state visibly alive; spinner enlarged 28→36px and border thickened; refresh icon now always spins briefly on tap even when loadBusy is true (acknowledges rapid taps instead of silently dropping them). |
| 10 | 2026-04-16 | City-switch header animation, font/spacing boost, empty search validation (NPS 7.6) | City switch now animates the header title (scale pulse) for obvious visual confirmation beyond the toast. Quick-stat values bumped 14→16px, hero subtitle 14→15px, recent search rows 15→16px; stat card padding increased for more breathing room. doSearch() rejects all-punctuation/empty queries with "Enter a city name to search". |
| 12 | 2026-04-16 | "Updated X ago" in hero, longer toast (NPS 8.0) | Added persistent "Updated just now / Xm ago" indicator below station info in the weather hero — addresses user ask for feedback near the card, not just a temporary toast. Toast duration extended from 2.5s to 3.5s for more readable feedback. |
| 13 | 2026-04-16 | Fix city-switch race condition with generation counter + active tab border indicator (NPS 7.3) | Root cause of "Amsterdam remained shown after selecting London": if a load was in-flight when city switched, loadBusy blocked the new load and the old results (Amsterdam) overwrote the cache. Fixed with loadGeneration counter: selectLoc() increments generation and force-clears loadBusy; loadAll() discards results if generation changed mid-flight. Active tab now shows a 2.5px top border for clearer orientation. |
| 14 | 2026-04-16 | First-visit onboarding hint banner (NPS 7.0) | Added a dismissable banner at the top of the Today tab for first-time visitors: "Explore forecast, calendar & history in the tabs below · Search to switch cities". Shows only once (localStorage wx_welcomed). Addresses repeated feedback about lack of onboarding guidance. |
| 15 | 2026-04-16 | Expanded onboarding card, stronger active tab, typography/spacing boost (NPS 7.4) | Onboarding banner redesigned as a titled card with per-tab description chips (Today/Forecast/Calendar/History/Search) and a clear "Dismiss" button. Active tab now shows a filled background (7% blue tint) in addition to the 3px top border. Section labels bumped 12→13px, card labels 12→13px, card padding increased. Quick-stat labels 11→12px; sub-labels (sunrise, precipitation, pollen rows) bumped from 9-10px to 10-12px. Reduces cramped feel on mobile. |
| 16 | 2026-04-16 | Search UX: guided tip, example placeholder, same-city feedback, bigger popular cities (NPS 7.4) | Search input placeholder changed to "e.g. London, Tokyo, New York…". Added tip text below input: "Type a city name, then tap a result to switch location". Invalid-query message now shows "Try a city name like London or Berlin". Repeated taps on the already-selected city now show "Already showing [city]" toast instead of silently reloading. Popular city buttons enlarged (13→15px, more padding) for easier tapping. |
| 17 | 2026-04-16 | Refresh button persistent loading state (NPS 8.0) | Refresh button now stays visually dimmed (45% opacity) and spinning for the full duration of a load — no more snapping back immediately. Tapping while a load is in-flight flashes the button to 25% opacity to acknowledge the tap, then returns to full. Addresses user request for "stronger loading/disabled state" to make duplicate requests feel safer. |
| 18 | 2026-04-16 | City name in hero, bolder active tab (NPS 7.7) | Added prominent city name + flag line at top of weather hero (17px semi-bold) so users always know which city's weather is displayed — fixes reports of "still looked like Amsterdam after switching". Active tab label now font-weight 700 and slightly stronger background tint for more obvious selection state. |
| 19 | 2026-04-16 | "Updated just now" more visible + green flash on refresh (NPS 7.0) | wx-hero-updated bumped from 11px/45% to 13px/80% with font-weight 500 so the persistent refresh confirmation is clearly readable. After each non-first load, the label briefly flashes green (wx-just-refreshed class, 2s) to draw attention to the confirmation. Addresses user request for "clearer loading/success indicator so first-time users can tell the refresh did something". |
| 20 | 2026-04-16 | Drawer discoverability, press feedback, typography (NPS 7.6) | Onboarding banner now explicitly mentions "Tap ☰ top-left for Stats, Progress & Settings" so users discover the drawer. Popular cities and recent search items now have :active press state (blue flash) for instant tap feedback. Search result address 12→13px, forecast narrative 12→13px. Addresses grade 5 report of "could not get Stats/Progress/About to open". |
| 21 | 2026-04-16 | Revert green flash (regression fix) + tab press animation (NPS 8.0) | Reverted the wx-just-refreshed green flash (cycle 19) — jarring color change on the updated indicator. Kept the font/opacity boost. Added :active scale(0.92) press animation on tab buttons for immediate tap feedback. Addresses "clearer in-progress feedback for impatient taps". |
| 22 | 2026-04-16 | Tab content fade-in + richer hero gradient (NPS 8.0) | Added wx-fade-in animation (0.22s ease-out, translateY 6px→0) on all tab content panels for smooth premium tab switching. Hero gradient deepened to 3-stop blue for richer visual identity. Addresses recurring "richer motion / more visual personality" requests. |
| 23 | 2026-04-16 | Fix missing modal keyframes + search result selection highlight (NPS 7.1) | Root cause of "brittle settings": modal-in and sheet-up @keyframes were referenced but never defined — settings modal popped in without animation. Added both keyframes (modal-in: opacity fade, sheet-up: slide from bottom). Added 180ms blue highlight on search result tap before switching city, making selection feel confirmed. |
| 24 | 2026-04-16 | Refresh busy-tap spring-bounce animation (NPS 8.0) | Replaced flat opacity fade on repeated refresh taps with spring-bounce keyframe (scale 1→0.82→1.12→1, 0.35s) so rapid taps feel visibly acknowledged. Addresses "stronger in-progress indicator for repeated taps". |
| 25 | 2026-04-19 | Settings gear icon in header + stronger modal open animation + "Settings" toast (NPS 6.4 regression) | Multiple testers reported repeated clicks on Settings produced no visible modal because Settings is buried two clicks deep in the drawer. Added a visible ⚙ gear icon directly in the header (next to refresh) wired straight to openSettings(). Strengthened the modal entrance: backdrop now fades darker (rgba 0.55), sheet uses a bouncy 0.42s spring animation (translateY+scale overshoot), and a small "Settings" toast fires on open as fallback confirmation. Also adds modal-open body class for future hooks. |
| 26 | 2026-04-19 | Generic 404 handler hides Express routing (NPS 7.0) | Security tester noted `/admin` returned Express's default "Cannot GET /admin" — minor info leak that reveals framework and route behavior. Added a catch-all app.use() at the end of server.js that returns a neutral JSON `{error:"Not found"}` for /api/* paths and a plain dark-themed HTML "Page not found" page otherwise. No more echoing of request path back to the client. |
| 27 | 2026-04-19 | Fix About modal overflow + toast confirm (NPS 6.6) | Five of nine testers reported About AutoPMF "never visibly opened". Root cause: `.modal-sheet` had no max-height or overflow-y, so the tall About content (logo + diagram + multi-paragraph body) extended above the phone viewport from the bottom-anchored sheet position — users saw only a sliver or nothing. Added `max-height: 85vh` and `overflow-y: auto` to `.modal-sheet` so any length of content renders scrollable inside the sheet. Also mirrored the Settings confirmation pattern on About: showToast('About'), modal-open body class, and scroll-to-top on open. |
| 28 | 2026-04-19 | Larger header icon tap targets + stronger press state (NPS 7.0) | Rushed-user feedback: "header controls and tab buttons feel small, hard to find the right action quickly". Bumped `.icon-btn` from 40→44px (full Apple HIG tap-target size), added 2px gap between header actions for easier thumb separation, deepened the active-press background from rgba 0.1→0.18, and added a subtle scale(0.94) tactile press. Reduces accidental mis-taps and makes every header tap feel confirmed. |
| 29 | 2026-04-19 | Escape user-controlled strings in search "No results" reflection + recent searches (NPS 7.1) | Security tester showed the search UI reflected a raw `<script>alert(1)</script>` payload into the "No results for …" message via template-literal string interpolation. Since that string was being assigned to `innerHTML`, an `<img src=x onerror=…>` style payload would have executed. Added an `esc()` helper (escapes &, <, >, ", ') in weather.js and applied it to the echoed search query plus every innerHTML-rendered recent-search entry (which are persisted from user input via localStorage). Defensive-only change — no user-facing visual difference for normal city names. |
| 30 | 2026-04-19 | Per-tab intro helper line on Forecast/Calendar/History (NPS 7.0) | First-time visitor asked for "clearer empty-state or helper text explaining what to look for in Forecast/Calendar". Added a one-line muted italic `.wx-tab-intro` at the top of each non-Today tab: Forecast ("Look ahead 7 days and hour-by-hour · charts show trends at a glance"), Calendar ("Monthly overview · tap any day for details · toggle historical averages"), History ("Pick a date range to see past weather · tap columns to sort · export to CSV"). Helps new users understand each tab's purpose without a heavy tour. |
| 31 | 2026-04-19 | Forecast scroll-fade affordance + tighter 7-day strip + bolder day labels (NPS 7.2) | Two mobile testers reported the forecast card strip "shows slight horizontal overflow/scroll, makes the page feel less polished". Added a `.wx-fc-scroller` wrapper with a right-edge linear-gradient fade that signals the strip is intentionally swipeable instead of broken. Shrank card min-width 72→68px and gap 8→6px so 7 cards fit more comfortably. Bumped `.wx-fc-day` weight 600→700 and color #666→#3a3a3c (AAA contrast) addressing the aging-eyes ask for stronger contrast on secondary labels. |
