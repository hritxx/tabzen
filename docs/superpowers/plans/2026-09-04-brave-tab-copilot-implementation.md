# Brave Tab Copilot (TabZen) - Implementation Plan

**Spec Reference:** `docs/superpowers/specs/2026-09-04-brave-tab-copilot-design.md`  
**Date:** 2026-09-04  
**Status:** Complete (all tasks delivered; see deltas below)

---

## Overview

Build the **TabZen** Brave Extension (Manifest V3) as a zero-build vanilla ES modules project. Follow all MV3 and Chromium side-panel rules strictly:
- Real PNG icons for 16, 48, 128px
- `openPanelOnActionClick: true` in service worker
- No inline scripts or event handlers in HTML
- Modular ES6 code with clean separation of concerns

---

## Tasks Breakdown

### Task 1: Generate Extension Icons
- **Goal:** Create valid 16x16, 48x48, and 128x128 PNG icons under `icons/` using Python `Pillow`.
- **Files:** `icons/icon-16.png`, `icons/icon-48.png`, `icons/icon-128.png`
- **Verification:** Inspect file existence, dimensions, and non-zero byte size.

### Task 2: Manifest Declaration (`manifest.json`)
- **Goal:** Create Manifest V3 configuration with correct permissions (`tabs`, `tabGroups`, `sidePanel`, `storage`, `alarms`, `scripting`), host permissions (`https://generativelanguage.googleapis.com/*`, `<all_urls>`), and side panel registration.
- **Files:** `manifest.json`
- **Verification:** Validate JSON syntax and verify fields match MV3 requirements.

### Task 3: Background Service Worker
- **Goal:** Manage side panel behavior (`openPanelOnActionClick: true`), track tab activity timestamps in `chrome.storage.local`, maintain tab count badges, and setup periodic alarms for badge refreshes.
- **Files:** `background/service-worker.js`
- **Verification:** Verify no global state variables, handles `chrome.action.setBadgeText`, and catches any initialization errors.

### Task 4: Storage & Vault Library (`lib/vault.js`)
- **Goal:** Manage local persistence for:
  - Settings (Gemini API key, stale threshold hours)
  - Stashed items (add, delete, search filter)
  - Markdown generator (export formatted reading digests)
- **Files:** `lib/vault.js`
- **Verification:** Unit test helper functions for searching and markdown generation.

### Task 5: Tab & Group Management Library (`lib/tab-manager.js`)
- **Goal:** High-level wrapper over `chrome.tabs` and `chrome.tabGroups`:
  - Query all window tabs, filtering out internal (`chrome://`, `brave://`) and pinned tabs
  - Batch create native Brave Tab Groups with titles and valid colors
  - Close tabs and restore stashed tabs
- **Files:** `lib/tab-manager.js`
- **Verification:** Verify proper error checks and color mapping.

### Task 6: Gemini AI Client (`lib/gemini.js`)
- **Goal:** Direct HTTP client calling Google Generative Language API (default `gemini-3.6-flash`, custom IDs supported):
  - Batch tab clustering prompt (returns structured groups)
  - 2-sentence takeaway & read time prompt
  - Deep 3-bullet summary prompt
  - Fallback domain heuristic if API key is not yet set
- **Files:** `lib/gemini.js`
- **Verification:** Test mock responses and JSON extraction safety.

### Task 7: Side Panel HTML & CSS
- **Goal:** Modern, responsive UI with Apple/Brave aesthetics (supporting system dark and light modes):
  - Top header with tab counter and view switcher
  - Triage Deck card with animated transitions
  - Groups manager view
  - Searchable Vault view with instant filtering
  - Settings modal with API key input
- **Files:** `sidepanel/index.html`, `sidepanel/style.css`
- **Verification:** Semantic HTML, zero inline `<script>` or inline `onclick`, clean responsive CSS variables.

### Task 8: Side Panel Application Controller (`sidepanel/app.js`)
- **Goal:** Primary state machine:
  - View router (Triage, Groups, Vault)
  - Triage Deck interaction (Summarize & Close, Stash, Keep Open)
  - Auto-Cluster button handler with loading spinner
  - Real-time search in Vault
  - Copy and Download Markdown buttons
- **Files:** `sidepanel/app.js`
- **Verification:** Test all event listeners, error handling toasts, and state transitions.

### Task 9: Documentation & Setup Guide
- **Goal:** Complete `README.md` explaining how to load unpacked in Brave (`brave://extensions`), configure the free Google Gemini API key, and use the Triage Coach and Auto-Clustering.
- **Files:** `README.md`

### Task 10: End-to-End Verification
- **Goal:** Verify complete file tree, test all JavaScript files for syntax errors using Node syntax check (`node --check <file>`), and confirm extension is ready for loading in Brave.

---

## Delivered deltas (beyond the original plan)

- Multi-window support: current-window / all-windows scope + pull-and-consolidate.
- Sleeping-tab preservation: extension-suspender URL unpacking, zero-RAM takeaways for discarded tabs.
- Quota defense: LRU summary cache, 1.2s request serializer, 250ms card debounce + `AbortController` cancellation, 429 backoff with retry, 404 model auto-fallback, live model discovery.
- Follow-up work is tracked in `docs/superpowers/specs/2026-09-03-tabzen-code-review-improvements.md`.
