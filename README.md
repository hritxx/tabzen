# TabZen - AI Tab Manager & Reading Coach for Chrome & Brave

> An AI-powered Side Panel companion that tames tab debt, conquers reading backlogs, handles sleeping tabs with zero RAM wake-up, and organizes tabs into native color-coded groups using Google Gemini.

[![Browser](https://img.shields.io/badge/Browsers-Google%20Chrome%20%7C%20Brave-blue)](https://github.com/hritxx/tabzen)
[![Manifest](https://img.shields.io/badge/Manifest-V3-success)](https://github.com/hritxx/tabzen)
[![AI Engine](https://img.shields.io/badge/AI-Google%20Gemini%203.6%20Flash%20%26%20Pro-purple)](https://aistudio.google.com/)
[![Build](https://img.shields.io/badge/Build-Pure%20ESM%20(Zero%20Dependencies)-orange)](https://github.com/hritxx/tabzen)

---

## ⚡ Superpowers

- 🎯 **Daily Reading Triage ("Tinder for Tabs")**: Swipe through open tabs one by one with a fast 2-sentence AI takeaway and estimated read time.
  - **`⚡ Summarize & Close`**: AI extracts 3 bullet points, saves them to your local Vault, and closes the tab.
  - **`📦 Stash Vault`**: Saves link + takeaway to your offline Vault and closes the tab immediately.
  - **`⏳ Keep Open`**: Leaves tab open and advances to the next card.
  - **Filter Pill**: Toggle between `All Tabs` (sorted oldest/most neglected first) and `Stale (>24h)`.
- 💤 **Sleeping Tab Preservation (Zero RAM Re-activation)**:
  - Smartly detects tabs suspended by extensions like *Auto Tab Discard*, *The Great Suspender*, *Tab Suspender*, or native Brave/Chrome tab discard.
  - Unpacks the original URLs and titles, generates takeaways, and organizes them **without waking up or reloading sleeping tabs into memory**.
- 🪄 **Semantic Color Grouping & Regrouping**:
  - Clusters 100% of open tabs into native, color-coded Chrome & Brave Tab Groups.
  - Dissolves obsolete groups automatically upon re-clustering for clean reorganizations.
- 🪟 **Multi-Window Support & Desktop Consolidation**:
  - **`Current Window`**: Strictly groups tabs in the active window without touching other windows.
  - **`All Open Windows`**: Organizes tabs in-place across all desktop windows.
  - **`🪟 Pull & Group All Windows Into This Window`**: Pulls tabs scattered across multiple desktop windows into a unified window.
- 📦 **Searchable Markdown Vault**:
  - Search across all previously closed articles and summaries in real time.
  - 1-click **`📋 Copy Markdown`** or **`📥 Download MD`** for Obsidian, Notion, and Logseq.
- 🛡️ **Anti-Spam & Zero-Rate-Limit Defense**:
  - Built-in LRU summary cache (0 API calls for repeated tabs).
  - 1.2-second request serializer queue to stay well within Google AI Studio quota.
  - 250ms debounce and active request cancellation (`AbortController`) when navigating cards quickly.
  - Exponential backoff and auto-retry on HTTP 429.
- 🌟 **Gemini Series 3 & Live Model Discovery**:
  - Native support for **`gemini-3.6-flash`**, **`gemini-3.1-pro`**, **`gemini-3.8-flash`**, or custom model IDs.
  - Self-healing 404 auto-fallback: never crashes if a model ID is unavailable.
  - **`🔄 Load Available Models`** button in settings queries your API key directly for supported models.

---

## 🚀 Quick Start (Under 60 Seconds)

### 1. Clone the Repository
```bash
git clone git@github.com:hritxx/tabzen.git
# or https://github.com/hritxx/tabzen.git
cd tabzen
```

### 2. Load the Extension into Google Chrome or Brave

#### In Google Chrome:
1. Open Chrome and navigate to:
   ```text
   chrome://extensions
   ```
2. Toggle on **Developer mode** in the top-right corner.
3. Click the **Load unpacked** button in the top-left.
4. Select the `tabzen` directory.

#### In Brave Browser:
1. Open Brave and navigate to:
   ```text
   brave://extensions
   ```
2. Toggle on **Developer mode** (top-right).
3. Click **Load unpacked** (top-left) and select the `tabzen` directory.

### 3. Open the Side Panel & Add Your Gemini API Key
1. Click the **TabZen** extension icon in your browser toolbar (pin it for convenience).
2. The TabZen Side Panel will open alongside your web pages.
3. Click the **⚙️ Settings** icon in the header.
4. Paste your free Google Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey).
5. Click **Save Settings**!
*(Note: TabZen includes intelligent offline heuristic grouping so you can test grouping even before adding an API key!)*

---

## 🛠️ Usage Guide

### 1. Triage Deck
1. Switch to the **🎯 Triage** tab.
2. Select **All Tabs** (default) or **Stale (>24h)**.
3. Review the AI-generated takeaway and estimated reading time.
4. Click **⚡ Summarize & Close** to capture key insights into your Vault and free up memory, or **⏳ Keep Open** to move to the next tab.

### 2. Tab Groups & Clustering
1. Switch to the **📑 Groups** tab.
2. Choose your scope:
   - **Current Window**: Organizes tabs in the current window.
   - **All Open Windows**: Organizes tabs across all desktop windows.
3. Click **🪄 Organize with AI**.
4. To consolidate tabs from 3 or 4 windows into a single window, click **🪟 Pull & Group All Windows Into This Window**.

### 3. Reading Vault
1. Switch to the **📦 Vault** tab.
2. Type in the search box to filter by title, URL, takeaway, or bullet points.
3. Click **📋 Copy Markdown** or **📥 Download MD** to import your reading notes into Obsidian, Notion, or Roam.

---

## 🏗️ Architecture & Privacy

- **Zero Build Step**: Built exclusively with Vanilla ES Modules (ESM). No `npm install`, no build tools, no bloated `node_modules` — instant reload and low memory footprint (<150KB).
- **Privacy First**: 100% client-side. Tab history, notes, and vault items are saved only to your local browser storage (`chrome.storage.local`). No tracking or analytics.
- **Quota Protective**: In-memory LRU cache, request serialization, and `AbortController` request cancellation prevent API spamming and rate limits.

---

## 📂 Repository Structure

```
tabzen/
├── manifest.json            # Chromium Manifest V3 configuration
├── background/
│   └── service-worker.js    # Side panel behavior & tab activity tracking
├── sidepanel/
│   ├── index.html           # Side Panel markup (Triage, Groups, Vault, Settings)
│   ├── style.css            # Responsive Apple/Brave inspired styling
│   └── app.js               # Side Panel UI controller & event orchestrator
├── lib/
│   ├── gemini.js            # Gemini API client, rate limiter, cache & clustering
│   ├── tab-manager.js       # Chromium Tab & TabGroup API, suspender unpacker
│   └── vault.js             # Local vault storage, search, & markdown generator
└── icons/                   # 16px, 48px, 128px extension icons
```

---

## 📄 License

MIT License. Crafted with precision for high-efficiency tab management.
