# TabZen

AI tab organizer and reading triage for Chrome and Brave. A side-panel companion that groups open tabs into native color-coded tab groups, walks you through stale tabs one by one, and keeps a searchable vault of everything you close.

No build step, no dependencies. Pure ES modules, Manifest V3.

## Features

- **Triage** — Full scrollable list of open tabs, oldest first. Tap any row to expand it: on-demand AI takeaway, then summarize-and-close, stash, or keep. Browsing the list makes zero API calls.
- **Organize** — One-click semantic grouping into native tab groups. Scope to the current window, all windows, or pull every window into one.
- **Vault** — Searchable local archive of closed articles with Markdown export for Obsidian, Notion, and Logseq.
- **Efficient** — Sleeping and suspended tabs are handled without waking them. Summary caching, request pacing, and quota backoff keep Gemini API usage low.

## Setup

1. Clone the repo:
   ```bash
   git clone git@github.com:hritxx/tabzen.git
   cd tabzen
   ```
2. Open `chrome://extensions` (or `brave://extensions`), enable **Developer mode**, click **Load unpacked**, and select this directory.
3. Click the TabZen toolbar icon to open the side panel, then **Settings** and paste a free Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey).

Grouping works without an API key via an offline heuristic; AI takeaways require one.

## Usage

- **Triage tab** — Filter `All Tabs` or `Stale`, scope `This window` or `All windows`. Tap a row to expand it, then `Summarize & Close` (AI bullets saved to Vault), `Stash` (save link and close), or `Keep` (next tab).
- **Groups tab** — Pick a scope and click `Organize with AI`. Use `Pull & Group All Windows Into This Window` to consolidate scattered windows.
- **Vault tab** — Search saved items, reopen or delete them, `Copy Markdown` or `Download MD` to export.

## Privacy

Everything stays local. Tabs, settings (including your API key), and vault items live only in `chrome.storage.local`. No analytics, no external calls except to the Google Gemini API.

Two permissions deserve an explanation:

- `<all_urls>` — required to extract a short text snippet from the active tab for summaries. Sleeping tabs are never touched.
- `alarms` — refreshes the tab-count badge hourly.

## Project structure

```
tabzen/
├── manifest.json
├── background/service-worker.js   # Side-panel behavior, tab tracking, badge
├── sidepanel/                     # index.html, style.css, app.js (UI controller)
├── lib/
│   ├── gemini.js                  # Gemini client, rate limiting, cache, clustering
│   ├── tab-manager.js             # Tabs/groups API wrappers, suspender handling
│   └── vault.js                   # Settings, vault storage, search, Markdown export
└── icons/
```

## Docs

- Design spec: `docs/superpowers/specs/2026-09-04-brave-tab-copilot-design.md`
- Improvement spec (implemented): `docs/superpowers/specs/2026-09-03-tabzen-code-review-improvements.md`

## License

MIT.
