// TabZen Side Panel Controller (ES Module)

import {
  getSettings,
  saveSettings,
  getVaultItems,
  addToVault,
  removeFromVault,
  searchVault,
  generateMarkdown
} from "../lib/vault.js";

import {
  getManageableTabs,
  getStaleTabs,
  getActiveTabGroups,
  applyTabGroups,
  closeTab,
  closeTabGroup,
  openTab,
  activateTab,
  getPageSnippet
} from "../lib/tab-manager.js";

import {
  clusterTabsWithAI,
  getTabTakeaway,
  getDeepSummary
} from "../lib/gemini.js";

// State
let appSettings = null;
let triageQueue = [];
let currentTriageIndex = 0;
let cachedVaultItems = [];
let currentCardTabInfo = null;

// DOM Elements
const headerTabCount = document.getElementById("header-tab-count");
const navButtons = document.querySelectorAll(".nav-btn");
const viewPanels = document.querySelectorAll(".view-panel");

// Triage Elements
const triageBadge = document.getElementById("triage-badge");
const triageProgress = document.getElementById("triage-progress");
const triageCard = document.getElementById("triage-card");
const triageEmpty = document.getElementById("triage-empty");
const cardFavicon = document.getElementById("card-favicon");
const cardHostname = document.getElementById("card-hostname");
const cardAge = document.getElementById("card-age");
const cardTitle = document.getElementById("card-title");
const cardReadTime = document.getElementById("card-read-time");
const cardTakeaway = document.getElementById("card-takeaway");
const btnTriageSummarize = document.getElementById("btn-triage-summarize");
const btnTriageStash = document.getElementById("btn-triage-stash");
const btnTriageKeep = document.getElementById("btn-triage-keep");
const btnRefreshTriage = document.getElementById("btn-refresh-triage");

// Groups Elements
const btnAutoCluster = document.getElementById("btn-auto-cluster");
const groupsList = document.getElementById("groups-list");
const ungroupedList = document.getElementById("ungrouped-list");

// Vault Elements
const vaultBadge = document.getElementById("vault-badge");
const vaultSearchInput = document.getElementById("vault-search-input");
const vaultItemsContainer = document.getElementById("vault-items-container");
const vaultEmpty = document.getElementById("vault-empty");
const btnCopyMarkdown = document.getElementById("btn-copy-markdown");
const btnDownloadMarkdown = document.getElementById("btn-download-markdown");

// Settings Modal Elements
const btnOpenSettings = document.getElementById("btn-open-settings");
const btnCloseSettings = document.getElementById("btn-close-settings");
const settingsModal = document.getElementById("settings-modal");
const inputApiKey = document.getElementById("input-api-key");
const btnToggleKeyVisibility = document.getElementById("btn-toggle-key-visibility");
const selectStaleHours = document.getElementById("select-stale-hours");
const selectModel = document.getElementById("select-model");
const btnSaveSettings = document.getElementById("btn-save-settings");

// Toast
const toast = document.getElementById("toast");

/**
 * Show a floating toast message
 */
function showToast(message, durationMs = 2600) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => {
    toast.classList.add("hidden");
  }, durationMs);
}

/**
 * Format relative time (e.g. "3 days ago")
 */
function formatTimeAgo(timestamp) {
  if (!timestamp) return "Recently";
  const diffMs = Date.now() - timestamp;
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Initialize application
 */
async function initApp() {
  appSettings = await getSettings();
  setupEventListeners();
  await refreshTabCounts();
  await loadTriageQueue();
  await refreshGroupsView();
  await loadVault();
}

/**
 * Setup UI Event Listeners
 */
function setupEventListeners() {
  // Navigation
  navButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetView = btn.getAttribute("data-view");
      switchView(targetView);
    });
  });

  // Triage Card Actions
  btnTriageSummarize.addEventListener("click", handleTriageSummarize);
  btnTriageStash.addEventListener("click", handleTriageStash);
  btnTriageKeep.addEventListener("click", handleTriageKeep);
  btnRefreshTriage.addEventListener("click", async () => {
    await loadTriageQueue(true);
  });
  cardTitle.addEventListener("click", () => {
    if (currentCardTabInfo?.id) {
      activateTab(currentCardTabInfo.id);
    }
  });

  // Groups Actions
  btnAutoCluster.addEventListener("click", handleAutoCluster);

  // Vault Actions
  vaultSearchInput.addEventListener("input", () => {
    renderVaultItems(vaultSearchInput.value);
  });
  btnCopyMarkdown.addEventListener("click", handleCopyMarkdown);
  btnDownloadMarkdown.addEventListener("click", handleDownloadMarkdown);

  // Settings Modal
  btnOpenSettings.addEventListener("click", openSettingsModal);
  btnCloseSettings.addEventListener("click", closeSettingsModal);
  settingsModal.addEventListener("click", (e) => {
    if (e.target === settingsModal) closeSettingsModal();
  });
  btnToggleKeyVisibility.addEventListener("click", () => {
    if (inputApiKey.type === "password") {
      inputApiKey.type = "text";
      btnToggleKeyVisibility.textContent = "Hide";
    } else {
      inputApiKey.type = "password";
      btnToggleKeyVisibility.textContent = "Show";
    }
  });
  btnSaveSettings.addEventListener("click", handleSaveSettings);

  // Listen to tab events to update counts live
  chrome.tabs.onCreated.addListener(() => refreshTabCounts());
  chrome.tabs.onRemoved.addListener(() => {
    refreshTabCounts();
    refreshGroupsView();
  });
  chrome.tabs.onUpdated.addListener((_, info) => {
    if (info.status === "complete") refreshTabCounts();
  });
}

/**
 * Switch Active View
 */
function switchView(viewName) {
  navButtons.forEach(b => {
    if (b.getAttribute("data-view") === viewName) {
      b.classList.add("active");
    } else {
      b.classList.remove("active");
    }
  });

  viewPanels.forEach(p => {
    if (p.id === `view-${viewName}`) {
      p.classList.add("active");
    } else {
      p.classList.remove("active");
    }
  });

  if (viewName === "groups") {
    refreshGroupsView();
  } else if (viewName === "vault") {
    loadVault();
  }
}

/**
 * Update Header Tab Count
 */
async function refreshTabCounts() {
  const tabs = await getManageableTabs();
  headerTabCount.textContent = `${tabs.length} tabs`;
}

/**
 * Load and render Triage Queue
 */
async function loadTriageQueue(includeAll = false) {
  const staleHours = Number(appSettings.staleHours) || 24;
  triageQueue = includeAll ? await getManageableTabs() : await getStaleTabs(staleHours);
  currentTriageIndex = 0;
  triageBadge.textContent = String(triageQueue.length);

  renderCurrentTriageCard();
}

/**
 * Render the current card in the Triage Deck
 */
async function renderCurrentTriageCard() {
  if (triageQueue.length === 0 || currentTriageIndex >= triageQueue.length) {
    triageCard.classList.add("hidden");
    triageEmpty.classList.remove("hidden");
    triageProgress.textContent = "0 of 0";
    triageBadge.textContent = "0";
    currentCardTabInfo = null;
    return;
  }

  triageCard.classList.remove("hidden");
  triageEmpty.classList.add("hidden");

  const tab = triageQueue[currentTriageIndex];
  currentCardTabInfo = tab;

  triageProgress.textContent = `${currentTriageIndex + 1} of ${triageQueue.length}`;
  triageBadge.textContent = String(triageQueue.length - currentTriageIndex);

  cardTitle.textContent = tab.title || "Untitled Tab";
  cardFavicon.src = tab.favIconUrl || "../icons/icon-16.png";
  cardFavicon.onerror = () => { cardFavicon.src = "../icons/icon-16.png"; };

  try {
    const urlObj = new URL(tab.url);
    cardHostname.textContent = urlObj.hostname.replace(/^www\./, "");
  } catch {
    cardHostname.textContent = tab.url;
  }

  cardAge.textContent = formatTimeAgo(tab.lastAccessed);
  cardReadTime.textContent = "⏱️ Estimating...";
  cardTakeaway.textContent = "Analyzing page content with Gemini...";

  // Fetch page content and generate quick takeaway
  const content = await getPageSnippet(tab.id);
  const tabData = {
    id: tab.id,
    title: tab.title,
    url: tab.url,
    description: content.description,
    snippet: content.snippet
  };

  currentCardTabInfo = tabData;

  const result = await getTabTakeaway(appSettings.geminiApiKey, tabData);
  cardTakeaway.textContent = result.takeaway;
  cardReadTime.textContent = `⏱️ ${result.readTime}`;
  currentCardTabInfo.takeaway = result.takeaway;
  currentCardTabInfo.readTime = result.readTime;
}

/**
 * Action: Summarize & Close
 */
async function handleTriageSummarize() {
  if (!currentCardTabInfo) return;
  const originalText = btnTriageSummarize.innerHTML;
  btnTriageSummarize.innerHTML = "<span class="btn-icon">⏳</span><span class="btn-text">Summarizing...</span>";
  btnTriageSummarize.disabled = true;

  try {
    const deepResult = await getDeepSummary(appSettings.geminiApiKey, currentCardTabInfo);
    await addToVault({
      url: currentCardTabInfo.url,
      title: currentCardTabInfo.title,
      favIconUrl: currentCardTabInfo.favIconUrl,
      takeaway: deepResult.takeaway,
      bullets: deepResult.bullets,
      readTime: deepResult.readTime
    });

    await closeTab(currentCardTabInfo.id);
    showToast("⚡ Summarized and saved to Vault!");
    currentTriageIndex++;
    await renderCurrentTriageCard();
    await refreshTabCounts();
    await loadVault();
  } catch (err) {
    showToast("Error summarizing tab: " + err.message);
  } finally {
    btnTriageSummarize.innerHTML = originalText;
    btnTriageSummarize.disabled = false;
  }
}

/**
 * Action: Stash in Vault & Close
 */
async function handleTriageStash() {
  if (!currentCardTabInfo) return;
  try {
    await addToVault({
      url: currentCardTabInfo.url,
      title: currentCardTabInfo.title,
      favIconUrl: currentCardTabInfo.favIconUrl,
      takeaway: currentCardTabInfo.takeaway || "Stashed tab.",
      bullets: [],
      readTime: currentCardTabInfo.readTime || "3 min"
    });

    await closeTab(currentCardTabInfo.id);
    showToast("📦 Stashed to Vault!");
    currentTriageIndex++;
    await renderCurrentTriageCard();
    await refreshTabCounts();
    await loadVault();
  } catch (err) {
    showToast("Error stashing tab: " + err.message);
  }
}

/**
 * Action: Keep Open (Snooze)
 */
function handleTriageKeep() {
  currentTriageIndex++;
  renderCurrentTriageCard();
}

/**
 * Auto-Cluster Tabs with AI
 */
async function handleAutoCluster() {
  const originalText = btnAutoCluster.innerHTML;
  btnAutoCluster.innerHTML = "<span class="btn-icon">⏳</span><span>Clustering tabs with AI...</span>";
  btnAutoCluster.disabled = true;

  try {
    const tabs = await getManageableTabs();
    if (tabs.length === 0) {
      showToast("No active tabs to organize.");
      return;
    }

    const groupSpecs = await clusterTabsWithAI(appSettings.geminiApiKey, tabs);
    const applied = await applyTabGroups(groupSpecs);

    showToast(`🪄 Created ${applied.length} colored tab groups!`);
    await refreshGroupsView();
  } catch (err) {
    showToast("Clustering error: " + err.message);
  } finally {
    btnAutoCluster.innerHTML = originalText;
    btnAutoCluster.disabled = false;
  }
}

/**
 * Render Groups View
 */
async function refreshGroupsView() {
  const tabs = await getManageableTabs();
  const groups = await getActiveTabGroups();

  groupsList.innerHTML = "";
  ungroupedList.innerHTML = "";

  const groupedTabsMap = {};
  const ungroupedTabs = [];

  for (const tab of tabs) {
    if (tab.groupId && tab.groupId !== -1) {
      if (!groupedTabsMap[tab.groupId]) groupedTabsMap[tab.groupId] = [];
      groupedTabsMap[tab.groupId].push(tab);
    } else {
      ungroupedTabs.push(tab);
    }
  }

  // Render Brave Groups
  if (groups.length === 0) {
    groupsList.innerHTML = "<p style="font-size:12px; color:var(--text-secondary);">No tab groups created yet. Click Auto-Cluster above!</p>";
  } else {
    for (const group of groups) {
      const gTabs = groupedTabsMap[group.id] || [];
      const card = document.createElement("div");
      card.className = "group-item-card";

      const header = document.createElement("div");
      header.className = "group-item-header";

      const titleBadge = document.createElement("div");
      titleBadge.className = "group-title-badge";

      const dot = document.createElement("span");
      dot.className = `color-dot color-${group.color || "blue"}`;

      const titleText = document.createElement("span");
      titleText.textContent = `${group.title || "Group"} (${gTabs.length})`;

      titleBadge.appendChild(dot);
      titleBadge.appendChild(titleText);

      const closeGroupBtn = document.createElement("button");
      closeGroupBtn.className = "secondary-btn";
      closeGroupBtn.textContent = "Close Group";
      closeGroupBtn.addEventListener("click", async () => {
        await closeTabGroup(group.id);
        await refreshGroupsView();
        await refreshTabCounts();
      });

      header.appendChild(titleBadge);
      header.appendChild(closeGroupBtn);
      card.appendChild(header);

      // Tabs inside group
      for (const t of gTabs) {
        const row = document.createElement("div");
        row.className = "group-tab-row";

        const rowTitle = document.createElement("span");
        rowTitle.className = "tab-title-text";
        rowTitle.textContent = t.title;
        rowTitle.addEventListener("click", () => activateTab(t.id));

        const closeBtn = document.createElement("button");
        closeBtn.className = "btn-tab-close";
        closeBtn.textContent = "✕";
        closeBtn.title = "Close tab";
        closeBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          await closeTab(t.id);
          await refreshGroupsView();
          await refreshTabCounts();
        });

        row.appendChild(rowTitle);
        row.appendChild(closeBtn);
        card.appendChild(row);
      }

      groupsList.appendChild(card);
    }
  }

  // Render Ungrouped Tabs
  if (ungroupedTabs.length === 0) {
    ungroupedList.innerHTML = "<p style="font-size:12px; color:var(--text-secondary);">All tabs are grouped.</p>";
  } else {
    for (const t of ungroupedTabs) {
      const row = document.createElement("div");
      row.className = "group-tab-row";

      const rowTitle = document.createElement("span");
      rowTitle.className = "tab-title-text";
      rowTitle.textContent = t.title;
      rowTitle.addEventListener("click", () => activateTab(t.id));

      const closeBtn = document.createElement("button");
      closeBtn.className = "btn-tab-close";
      closeBtn.textContent = "✕";
      closeBtn.title = "Close tab";
      closeBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await closeTab(t.id);
        await refreshGroupsView();
        await refreshTabCounts();
      });

      row.appendChild(rowTitle);
      row.appendChild(closeBtn);
      ungroupedList.appendChild(row);
    }
  }
}

/**
 * Load Vault items
 */
async function loadVault() {
  cachedVaultItems = await getVaultItems();
  vaultBadge.textContent = String(cachedVaultItems.length);
  renderVaultItems(vaultSearchInput.value);
}

/**
 * Render filtered Vault items
 */
function renderVaultItems(query = "") {
  const filtered = searchVault(cachedVaultItems, query);
  vaultItemsContainer.innerHTML = "";

  if (filtered.length === 0) {
    vaultEmpty.classList.remove("hidden");
    return;
  }
  vaultEmpty.classList.add("hidden");

  for (const item of filtered) {
    const card = document.createElement("div");
    card.className = "vault-item-card";

    const titleEl = document.createElement("div");
    titleEl.className = "vault-item-title";
    titleEl.textContent = item.title;
    titleEl.addEventListener("click", () => openTab(item.url));

    const metaEl = document.createElement("div");
    metaEl.className = "vault-item-meta";
    let domain = item.url;
    try { domain = new URL(item.url).hostname; } catch {}
    metaEl.innerHTML = `<span>${domain} • ${formatTimeAgo(item.stashedAt)}</span><span>⏱️ ${item.readTime || "3 min"}</span>`;

    card.appendChild(titleEl);
    card.appendChild(metaEl);

    if (item.takeaway) {
      const takeawayEl = document.createElement("div");
      takeawayEl.className = "vault-item-takeaway";
      takeawayEl.textContent = item.takeaway;
      card.appendChild(takeawayEl);
    }

    if (item.bullets && item.bullets.length > 0) {
      const bulletsList = document.createElement("ul");
      bulletsList.className = "vault-bullets-list";
      for (const b of item.bullets) {
        const li = document.createElement("li");
        li.textContent = b;
        bulletsList.appendChild(li);
      }
      card.appendChild(bulletsList);
    }

    const footer = document.createElement("div");
    footer.className = "vault-card-footer";

    const openBtn = document.createElement("button");
    openBtn.className = "secondary-btn";
    openBtn.textContent = "Open Tab";
    openBtn.addEventListener("click", () => openTab(item.url));

    const delBtn = document.createElement("button");
    delBtn.className = "secondary-btn";
    delBtn.style.color = "var(--danger)";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", async () => {
      await removeFromVault(item.id);
      await loadVault();
      showToast("Removed from Vault");
    });

    footer.appendChild(openBtn);
    footer.appendChild(delBtn);
    card.appendChild(footer);

    vaultItemsContainer.appendChild(card);
  }
}

/**
 * Copy Vault to Markdown
 */
async function handleCopyMarkdown() {
  if (cachedVaultItems.length === 0) {
    showToast("Vault is empty.");
    return;
  }
  const md = generateMarkdown(cachedVaultItems);
  await navigator.clipboard.writeText(md);
  showToast("📋 Copied all vault summaries to clipboard!");
}

/**
 * Download Vault as Markdown file
 */
function handleDownloadMarkdown() {
  if (cachedVaultItems.length === 0) {
    showToast("Vault is empty.");
    return;
  }
  const md = generateMarkdown(cachedVaultItems);
  const dateStr = new Date().toISOString().split("T")[0];
  const blob = new Blob([md], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tabzen-vault-${dateStr}.md`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("📥 Downloaded vault markdown file!");
}

/**
 * Open Settings Modal
 */
function openSettingsModal() {
  inputApiKey.value = appSettings.geminiApiKey || "";
  selectStaleHours.value = String(appSettings.staleHours || 24);
  selectModel.value = appSettings.model || "gemini-2.5-flash";
  settingsModal.classList.remove("hidden");
}

/**
 * Close Settings Modal
 */
function closeSettingsModal() {
  settingsModal.classList.add("hidden");
}

/**
 * Save Settings
 */
async function handleSaveSettings() {
  const updated = await saveSettings({
    geminiApiKey: inputApiKey.value.trim(),
    staleHours: Number(selectStaleHours.value),
    model: selectModel.value
  });
  appSettings = updated;
  closeSettingsModal();
  showToast("Settings saved successfully!");
  await loadTriageQueue();
}

// Boot app
initApp();
