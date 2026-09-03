# TabZen - AI Tab Manager & Reading Coach for Brave Browser

> An AI-powered Brave Side Panel companion to end tab-hoarding, tame your reading backlog, and organize tabs into native color-coded groups.

![Platform](https://img.shields.io/badge/Platform-Brave%20%7C%20Chromium-orange)
![Manifest](https://img.shields.io/badge/Manifest-V3-blue)
![AI](https://img.shields.io/badge/AI-Google%20Gemini%202.5%20Flash-indigo)
![Build](https://img.shields.io/badge/Build-Zero%20Dependencies%20(Pure%20ESM)-success)

---

## 💡 The Problem TabZen Solves

1. **Tab Debt**: Leaving 40+ tabs open because "I will read this later".
2. **Cognitive Overload**: Inability to quickly locate active project tabs amidst news, articles, and documentation.
3. **Fear Of Missing Out (FOMO)**: Hesitation to close tabs for fear of losing valuable articles or references forever.

TabZen lives in **Brave's Side Panel** right alongside your browsing session, providing:
- 🎯 **Daily Reading Triage ("Tinder for Tabs")**: Walks you through stale tabs (>24h untouched) one by one with a fast AI takeaway and estimated read time.
  - `⚡ Summarize & Close`: Generates 3 executive takeaways, archives them to your local Vault, and closes the tab.
  - `📦 Stash Vault`: Saves link + takeaway to your offline Vault and closes the tab immediately.
  - `⏳ Keep Open`: Leaves tab open and advances to next card.
- 🪄 **1-Click AI Auto-Clustering**: Uses Gemini 2.5 Flash to categorize all open tabs into native Brave color-coded Tab Groups (e.g., *Dev & Frameworks*, *AI Research*, *News & Blogs*).
- 📦 **Zero-FOMO Searchable Vault**: Local database of all closed reading material with instant keyword search, 1-click **Restore Tab**, and **Export to Markdown** for Obsidian and Notion.

---

## 🚀 Quick Start: Install in Brave (Under 60 Seconds)

### 1. Load the Extension into Brave
1. Open **Brave Browser** and navigate to:
   ```text
   brave://extensions
   ```
2. Toggle on **Developer mode** in the top-right corner.
3. Click the **Load unpacked** button in the top-left.
4. Select this directory:
   ```text
   /Users/hriteekroy1869/projects/brave-tab-copilot
   ```
5. You will see **TabZen - AI Tab Manager & Reading Coach** appear with its custom icon!

### 2. Open the Side Panel
- Click the **TabZen icon** in your Brave extension toolbar (pin it for quick access).
- Or click the **Brave Sidebar** icon and select **TabZen**.

### 3. Add Your Free Gemini API Key
1. Click the `⚙️` (Settings) icon in the top right of TabZen.
2. Get a free API key with one click from [Google AI Studio](https://aistudio.google.com/app/apikey).
3. Paste the key into TabZen and click **Save Settings**.
*(Note: Even without an API key, TabZen includes heuristic domain clustering so you can test it immediately!)*

---

## 🛠️ Feature Walkthrough

### 1. 🎯 Triage Deck
- TabZen automatically filters tabs that haven't been focused or visited in >24 hours (configurable to 12h, 48h, or 7 days).
- For each card, Gemini produces:
  - **Estimated read time** (e.g. `⏱️ 4 min read`)
  - **AI Takeaway** highlighting the key thesis of the article
- 1-click decisions:
  - **⚡ Summarize & Close**: AI extracts 3 bullet points, saves to your vault, and closes the tab.
  - **📦 Stash Vault**: Closes tab and archives URL.
  - **⏳ Keep Open**: Skips to the next card.

### 2. 📑 Active Groups & Auto-Clustering
- Click **🪄 Auto-Cluster Tabs with AI**.
- TabZen analyzes all open tabs in your window, clusters them by topic, and assigns them native Brave colored group headers.
- Expand, collapse, or close entire groups with one click.

### 3. 📦 Stash Vault & Markdown Export
- Search across all previously closed articles, summaries, and URLs in real time.
- Click any title or `Open Tab` to reopen it anytime.
- Click `📋 Copy Markdown` or `📥 Download MD` to generate structured notes:
  ```markdown
  ### [PostgreSQL Indexing: The Definitive Guide](https://...)
  *Saved on 9/4/2026 • Read time: 6 min*

  > **TL;DR:** Comparison of B-Tree vs BRIN indexes for large time-series logs.

  **Key Highlights:**
  - Partial indexes save space by omitting NULL rows.
  - Multi-column index column order matters for range queries.
  ```

---

## 🏗️ Architecture & Privacy

- **Zero Build Step**: Native Manifest V3 using modern ES modules. No `npm install`, no `webpack`, no bundle bloat.
- **Privacy-First**: No analytics or telemetry. All tab history and stashed articles remain locally on your machine in `chrome.storage.local`.
- **API Efficiency**: Uses `gemini-2.5-flash` for sub-second responses and batches tabs to consume negligible tokens.

---

## 📂 Project Structure
```
projects/brave-tab-copilot/
├── manifest.json                  # Chromium MV3 manifest
├── README.md                      # Documentation & user guide
├── background/
│   └── service-worker.js          # Tab access tracking & side panel trigger
├── sidepanel/
│   ├── index.html                 # Semantic UI structure
│   ├── style.css                  # Apple/Brave light & dark responsive design
│   └── app.js                     # State machine & user event handlers
├── lib/
│   ├── gemini.js                  # Direct Gemini 2.5 Flash API client
│   ├── tab-manager.js             # Brave Tab and TabGroups API wrapper
│   └── vault.js                   # Local storage, search, & markdown generator
├── icons/                         # 16x16, 48x48, 128x128 extension icons
└── docs/                          # Superpowers specs and implementation plans
```
