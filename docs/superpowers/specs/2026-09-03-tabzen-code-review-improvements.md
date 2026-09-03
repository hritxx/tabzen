# TabZen — Code Review & Improvement Spec

**Date:** 2026-09-03
**Status: Implemented** (P0-1–P0-4, P1-1–P1-6, P2-1–P2-9, P2-12; verified with `node --check` + a pure-function smoke test)
**Remaining:** P2-10 narrowed to a README privacy note (done); P2-11 test harness/CI still open.
**Scope:** `manifest.json`, `background/service-worker.js`, `lib/gemini.js`, `lib/tab-manager.js`, `lib/vault.js`, `sidepanel/app.js`, `sidepanel/index.html`
**Method:** Full file reads + `node --check` (all pass) + manifest JSON validation (passes) + cross-referencing docs vs. code.
**Related:** `docs/superpowers/specs/2026-09-04-brave-tab-copilot-design.md`, `docs/superpowers/plans/2026-09-04-brave-tab-copilot-implementation.md`

Overall: the codebase is in good shape — clean ESM separation, real P0-grade thinking on rate limiting (serializer queue, 429 backoff, AbortController, debounce) and sleeping-tab protection. Findings below are ordered by severity. Nothing here requires an architecture rewrite.

---

## P0 — Fix (correctness bugs)

### P0-1. "All Open Windows" groups view only shows the current window's groups
- **Where:** `lib/tab-manager.js:188-192`, `sidepanel/app.js:613-614`
- **Problem:** `getActiveTabGroups(targetWindowId = null)` treats `null` as "fall back to current window" (`targetWindowId !== null ? … : await getCurrentWindowId()`). But `refreshGroupsView()` passes `null` to mean "all windows" when `organizeScope === "all"`. Result: tabs list covers all windows (`getAllManageableTabs`) while the groups list covers only the current window — groups from other windows render with count `(0)` or not at all.
- **Fix:** Adopt one sentinel convention. Recommended: `undefined` = current window (default), `null` = all windows, in both `getManageableTabs` and `getActiveTabGroups`. E.g.:
  ```js
  export async function getActiveTabGroups(targetWindowId = undefined) {
    if (targetWindowId === null) return await chrome.tabGroups.query({});
    const windowId = targetWindowId ?? await getCurrentWindowId();
    ...
  }
  ```
- **Acceptance:** With 2+ windows grouped, scope "All Open Windows" lists every window's groups with correct tab counts.

### P0-2. `JSON.parse(raw)` crashes on Markdown-fenced model output (3 sites)
- **Where:** `lib/gemini.js:214` (clustering), `:363` (takeaway), `:418` (deep summary)
- **Problem:** Even with `responseMimeType: "application/json"`, Gemini frequently wraps output in ```` ```json … ``` ```` fences. A fence → `JSON.parse` throws → clustering silently degrades to heuristic, takeaways degrade to title echo. This is the most likely cause of "AI grouping didn't work" reports.
- **Fix:** Add one `extractJson(text)` helper (strip fences, slice from first `{` to last `}`) and use it at all three call sites. For clustering, additionally validate `tabIds` are numbers for known tabs and coerce/ignore the rest before the missing-tab backfill.
- **Acceptance:** Fenced, leading-prose, and trailing-prose model outputs all parse; unknown/garbage still falls back to heuristic without throwing to UI.

### P0-3. Vault row renders AI-controlled string via `innerHTML`
- **Where:** `sidepanel/app.js:765` (`metaEl.innerHTML = … ${item.readTime} …`)
- **Problem:** `readTime` originates from the model (`getTabTakeaway`/`getDeepSummary` pass `parsed.readTime` through uncapped). A malicious or glitchy model string containing HTML executes in the side panel. Low severity (self-XSS, local data), but trivial to fix.
- **Fix:** Build the meta row with `textContent` / `createElement` instead of `innerHTML`. Same pass: cap `readTime` (e.g. 16 chars) and `takeaway` length when persisting to vault.
- **Acceptance:** Vault renders model-supplied `<img onerror=…>` / `<script>` payloads as inert text.

### P0-4. Fresh-install default model disagrees across three files
- **Where:** `background/service-worker.js:19` (`gemini-2.5-flash`) vs `lib/vault.js:6` (migrates to `gemini-3.6-flash`) vs `sidepanel/app.js:37` (`gemini-3.6-flash`)
- **Problem:** Works by accident today (migration in `getSettings` heals it on first panel open), but any code path reading raw storage before migration sees a dead model ID, and the drift will bite again on the next model rename.
- **Fix:** Single source of truth: export `DEFAULT_MODEL = "gemini-3.6-flash"` from `lib/gemini.js`, import/use it in `service-worker.js` (via shared import — service worker is already `"type": "module"`), `vault.js`, and `app.js`. Keep one migration function (`normalizeModelName`) instead of the duplicated inline check in `vault.js:6`.
- **Acceptance:** `grep gemini-2.5-flash` hits only docs/history; fresh install stores the default model directly.

---

## P1 — Harden (robustness, data safety, UX)

### P1-1. "LRU" summary cache is actually FIFO; keys are untracked-param sensitive
- **Where:** `lib/gemini.js:5-20`, `:342`, `:394`
- **Problem:** `getCachedSummary` never refreshes recency, so eviction is insertion-order (FIFO), not LRU. Keys use the raw URL, so `?utm_*` / `#hash` variants of the same article each burn an API call.
- **Fix:** On cache hit, `delete` + `set` to refresh position (true LRU). Normalize cache keys: strip hash, drop known tracking params (`utm_*`, `fbclid`, `gclid`), lowercase host.
- **Acceptance:** Revisiting a cached tab is a hit regardless of tracking params; cache size stays ≤ 300 with hot entries surviving.

### P1-2. Vault grows unbounded against `chrome.storage.local` quota (~5–10 MB)
- **Where:** `lib/vault.js:31-46`
- **Problem:** No cap, no pagination, no quota handling. A heavy triage user eventually hits `QUOTA_BYTES` and `chrome.storage.local.set` starts failing — losing both new vault items and settings writes.
- **Fix:** Cap vault (e.g. 500 items, evict oldest with a toast), wrap `set` in try/catch surfacing a "vault full" message, and render the vault list windowed (first N + "show more") instead of full DOM per keystroke.
- **Acceptance:** Writing item #501 evicts the oldest with user feedback; `set` failures surface instead of silent loss.

### P1-3. `getPageSnippet` doesn't know about extension-suspended tabs
- **Where:** `lib/tab-manager.js:359-366`, `sidepanel/app.js:437-439`
- **Problem:** The library only skips `tab.discarded`. Extension-suspended tabs (`chrome-extension://…?uri=…`) are *active* pages, so a direct `getPageSnippet(suspendedTabId)` injects into the suspender UI — scraping the suspender's chrome instead of the article, and waking work the feature exists to avoid. `app.js` guards this today, but the invariant lives in the wrong layer.
- **Fix:** Move the guard into `getPageSnippet`: return empty when `parseSuspendedTab(tab)` is non-null. Also pre-filter `chrome://`, `brave://`, `devtools://`, Web Store URLs *before* `executeScript` to avoid noisy permission errors.
- **Acceptance:** `getPageSnippet` on any suspended/restricted tab returns `{ description: "", snippet: "" }` with no injection attempt.

### P1-4. Grouping output quality: single-tab groups + heuristic group explosion
- **Where:** `lib/tab-manager.js:239-328`, `applyTabGroups`
- **Problem:** (a) `chrome.tabs.group` is called even for 1-tab partitions — a "group" of one is visual noise. (b) The heuristic fallback creates one `🌐 {Domain}` group per leftover domain; 100 stray tabs → dozens of groups, while the AI path promises 2–8.
- **Fix:** Skip grouping partitions of size 1 (leave ungrouped). Cap heuristic output: merge domain buckets smaller than 2 tabs into a single `🌐 Misc Browsing`-style bucket (naming exception to the AI prompt's no-generic rule, which applies to the model, not the offline fallback) and cap total fallback groups (~8).
- **Acceptance:** Clustering 50 random tabs never yields 1-tab groups or more than ~8 fallback groups.

### P1-5. Model migration in `vault.js` is overbroad; logic duplicated
- **Where:** `lib/vault.js:6`, `lib/gemini.js:60-73`
- **Problem:** `model.includes("2.5")` matches any custom ID containing that substring (e.g. a future `gemini-4-2.5-tools`), force-migrating user config. The canonical mapping already lives in `normalizeModelName`.
- **Fix:** Delete the inline check; `getSettings` should just call `normalizeModelName(settings.model)` and persist only if changed. (Subsumed by P0-4's single-source-of-truth work — do together.)
- **Acceptance:** Custom model IDs survive settings load untouched unless they match a known legacy mapping.

### P1-6. 429 backoff blocks the shared serializer queue
- **Where:** `lib/gemini.js:27-41`, `:137-146`
- **Problem:** The 2.5s/5s cooldown `sleep`s inside `enqueueRateLimitedRequest`, stalling *all* queued takeaways behind one rate-limited call. Correct behavior, worst-case latency.
- **Fix (small):** Add ±20% jitter to backoff to avoid thundering-herd retries; consider a separate lightweight lane for single-tab takeaways vs. batch clustering. Do not raise `MIN_REQUEST_INTERVAL_MS` — 1.2s is already conservative.
- **Acceptance:** Sustained triage under quota pressure recovers without freezing the card deck longer than the backoff itself.

---

## P2 — Hygiene (small, independent, any order)

| # | Where | Issue | Fix |
|---|-------|-------|-----|
| P2-1 | `sidepanel/app.js:341-348` | `switchView` fires async loaders without `await`/catch — unhandled rejections if storage/tabs fail | `void loadTriageQueue().catch(...)` (same for groups/vault) or make `switchView` async |
| P2-2 | `sidepanel/app.js:108-115` | Overlapping `showToast` calls share one timer — an early timer hides a later message prematurely | Store timer id, `clearTimeout` on each call |
| P2-3 | `background/service-worker.js:29` | `checkStaleTabs` alarm created only `onInstalled` — lost on profiles where alarms clear / worker reinstalls | Also (re)create on `chrome.runtime.onStartup` |
| P2-4 | `background/service-worker.js:86` | Badge counts filter only `chrome://`/`brave://`, but triage filters `devtools://` + `chrome-extension://` too — header badge and triage counts disagree | Reuse one `isCountableTab` predicate in both places |
| P2-5 | `lib/vault.js:55-65` | `searchVault` assumes `bullets` entries are strings (`b.toLowerCase()`) — a malformed stored item throws on every keystroke | Guard with `String(b ?? "")` |
| P2-6 | `lib/vault.js:67-89` | `generateMarkdown` doesn't escape `]` in titles — breaks exported links | Escape `[\]` in title (one-liner) |
| P2-7 | `lib/vault.js:33` | Vault IDs use `Math.random` | Use `crypto.randomUUID()` with timestamp fallback |
| P2-8 | `sidepanel/app.js:480-509` | `handleTriageSummarize` uses whatever snippet the takeaway pass captured; clicking fast after card render sends an empty snippet to the deep summary | If `!currentCardTabInfo.snippet && !discarded`, `await getPageSnippet(id)` fresh (with timeout) before `getDeepSummary` |
| P2-9 | `sidepanel/index.html:53,118,213` | Inline `style=` attributes (filter row, scope label, fetch-models button) | Move to `style.css` classes |
| P2-10 | `manifest.json:6-13,14-17` | `<all_urls>` + `alarms` widen review surface and the privacy story | Either justify in README/Privacy (`<all_urls>` powers snippet extraction; `alarms` powers hourly badge) or evaluate narrowing (`activeTab` + on-demand snippet; drop alarm, badge on tab events only) |
| P2-11 | repo-wide | No tests, lint, or CI — regressions caught manually | Add `node --check` script + a tiny Node test harness for pure functions (`normalizeModelName`, `clusterTabsHeuristic`, `searchVault`, `generateMarkdown`, `extractJson` after P0-2); wire to `git push` via a pre-push hook or GH Action |
| P2-12 | `sidepanel/app.js:278-284` | Post-fetch `selectModel.value` assignment can silently fail if the value isn't an option (falls back to first option visually but stored model differs) | After populating, verify `selectModel.value` took; else select `custom` + fill `inputCustomModel` |

---

## Suggested sequencing

1. **Batch A (one sitting):** P0-1, P0-2, P0-3 — each is a small, isolated diff with immediate user-visible payoff.
2. **Batch B:** P0-4 + P1-5 (same files, same theme: model identity).
3. **Batch C:** P1-1, P1-3, P1-4 (quality-of-clustering pass; test with 30+ mixed tabs incl. suspended ones).
4. **Batch D:** P1-2, P1-6, P2 items opportunistically.

## What was deliberately *not* flagged

- `MIN_REQUEST_INTERVAL_MS = 1200` + serializer + debounce + AbortController: keep as-is; well-judged for AI Studio free tier.
- Zero-build ESM, no `node_modules`: keep; matches side-panel reload ergonomics.
- `chrome.tabs.ungroup` before regroup: keep; correct for clean reorganization.
- `formatTab` falling back to `Date.now()`: acceptable; new tabs sort as "just now".
