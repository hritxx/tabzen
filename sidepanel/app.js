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
  getCurrentWindowId,
  getManageableTabs,
  getAllManageableTabs,
  getTriageTabs,
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
let appSettings = {
  geminiApiKey: "",
  model: "gemini-3.6-flash",
  staleHours: 24,
  autoPromptThreshold: 15
};
let organizeScope = "current"; // "current" | "all"
let triageFilterStaleOnly = false; // false = All tabs (oldest first), true = older than 24h
let triageQueue = [];
let currentTriageIndex = 0;
let cachedVaultItems = [];
let currentCardTabInfo = null;

// DOM Elements
const headerTabCount = document.getElementById("header-tab-count");
const navButtons = document.querySelectorAll(".nav-btn");
const viewPanels = document.querySelectorAll(".view-panel");

// Triage Elements
const btnTriageAll = document.getElementById("btn-triage-all");
const btnTriageStale = document.getElementById("btn-triage-stale");
const cardSleepingIndicator = document.getElementById("card-sleeping-indicator");
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
const btnScopeCurrent = document.getElementById("btn-scope-current");
const btnScopeAll = document.getElementById("btn-scope-all");
const btnAutoCluster = document.getElementById("btn-auto-cluster");
const clusterBtnLabel = document.getElementById("cluster-btn-label");
const btnConsolidateWindows = document.getElementById("btn-consolidate-windows");
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
const customModelContainer = document.getElementById("custom-model-container");
const inputCustomModel = document.getElementById("input-custom-model");
const btnSaveSettings = document.getElementById("btn-save-settings");

// Toast
const toast = document.getElementById("toast");

function showToast(message, durationMs = 2800) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => {
    toast.classList.add("hidden");
  }, durationMs);
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return "Recently";
  const diffMs = Date.now() - timestamp;
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// 1. Hook up all event listeners immediately so buttons are instantly responsive
setupEventListeners();

// 2. Boot background data loaders
initApp();

async function initApp() {
  try {
    appSettings = await getSettings();
  } catch (err) {
    console.warn("Could not load settings:", err);
  }

  try {
    await refreshTabCounts();
  } catch (err) {
    console.warn("Could not refresh tab counts:", err);
  }

  try {
    await loadTriageQueue();
  } catch (err) {
    console.warn("Could not load triage queue:", err);
  }

  try {
    await refreshGroupsView();
  } catch (err) {
    console.warn("Could not refresh groups:", err);
  }

  try {
    await loadVault();
  } catch (err) {
    console.warn("Could not load vault:", err);
  }
}

function setupEventListeners() {
  // Navigation tabs
  navButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetView = btn.getAttribute("data-view");
      switchView(targetView);
    });
  });

  // Triage Filter Actions
  if (btnTriageAll) {
    btnTriageAll.addEventListener("click", async () => {
      triageFilterStaleOnly = false;
      btnTriageAll.classList.add("active");
      btnTriageStale?.classList.remove("active");
      await loadTriageQueue();
    });
  }

  if (btnTriageStale) {
    btnTriageStale.addEventListener("click", async () => {
      triageFilterStaleOnly = true;
      btnTriageStale.classList.add("active");
      btnTriageAll?.classList.remove("active");
      await loadTriageQueue();
    });
  }

  // Triage Card Actions
  if (btnTriageSummarize) btnTriageSummarize.addEventListener("click", handleTriageSummarize);
  if (btnTriageStash) btnTriageStash.addEventListener("click", handleTriageStash);
  if (btnTriageKeep) btnTriageKeep.addEventListener("click", handleTriageKeep);
  if (btnRefreshTriage) btnRefreshTriage.addEventListener("click", async () => {
    await loadTriageQueue();
  });
  if (cardTitle) cardTitle.addEventListener("click", () => {
    if (currentCardTabInfo?.id) {
      activateTab(currentCardTabInfo.id);
    }
  });

  // Scope Toggle Actions
  if (btnScopeCurrent) {
    btnScopeCurrent.addEventListener("click", () => {
      organizeScope = "current";
      btnScopeCurrent.classList.add("active");
      btnScopeAll?.classList.remove("active");
      if (clusterBtnLabel) clusterBtnLabel.textContent = "Organize Current Window with AI";
      btnConsolidateWindows?.classList.add("hidden");
    });
  }

  if (btnScopeAll) {
    btnScopeAll.addEventListener("click", () => {
      organizeScope = "all";
      btnScopeAll.classList.add("active");
      btnScopeCurrent?.classList.remove("active");
      if (clusterBtnLabel) clusterBtnLabel.textContent = "Organize All Windows (In-Place)";
      btnConsolidateWindows?.classList.remove("hidden");
    });
  }

  // Groups Actions
  if (btnAutoCluster) btnAutoCluster.addEventListener("click", handleAutoCluster);
  if (btnConsolidateWindows) btnConsolidateWindows.addEventListener("click", handleConsolidateWindows);

  // Vault Actions
  if (vaultSearchInput) {
    vaultSearchInput.addEventListener("input", () => {
      renderVaultItems(vaultSearchInput.value);
    });
  }
  if (btnCopyMarkdown) btnCopyMarkdown.addEventListener("click", handleCopyMarkdown);
  if (btnDownloadMarkdown) btnDownloadMarkdown.addEventListener("click", handleDownloadMarkdown);

  // Settings Modal Actions
  if (btnOpenSettings) btnOpenSettings.addEventListener("click", openSettingsModal);
  if (btnCloseSettings) btnCloseSettings.addEventListener("click", closeSettingsModal);
  if (settingsModal) {
    settingsModal.addEventListener("click", (e) => {
      if (e.target === settingsModal) closeSettingsModal();
    });
  }
  if (btnToggleKeyVisibility) {
    btnToggleKeyVisibility.addEventListener("click", () => {
      if (inputApiKey.type === "password") {
        inputApiKey.type = "text";
        btnToggleKeyVisibility.textContent = "Hide";
      } else {
        inputApiKey.type = "password";
        btnToggleKeyVisibility.textContent = "Show";
      }
    });
  }
  if (selectModel) {
    selectModel.addEventListener("change", () => {
      if (selectModel.value === "custom") {
        customModelContainer?.classList.remove("hidden");
        inputCustomModel?.focus();
      } else {
        customModelContainer?.classList.add("hidden");
      }
    });
  }
  if (btnSaveSettings) btnSaveSettings.addEventListener("click", handleSaveSettings);

  // Browser Tab Events
  if (chrome?.tabs) {
    chrome.tabs.onCreated.addListener(() => refreshTabCounts());
    chrome.tabs.onRemoved.addListener(() => {
      refreshTabCounts();
      refreshGroupsView();
    });
    chrome.tabs.onUpdated.addListener((_, info) => {
      if (info.status === "complete") refreshTabCounts();
    });
  }
}

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

  if (viewName === "triage") {
    loadTriageQueue();
  } else if (viewName === "groups") {
    refreshGroupsView();
  } else if (viewName === "vault") {
    loadVault();
  }
}

async function refreshTabCounts() {
  const currentTabs = await getManageableTabs();
  const allTabs = await getAllManageableTabs();
  if (headerTabCount) {
    if (allTabs.length > currentTabs.length) {
      headerTabCount.textContent = `${currentTabs.length} tabs (${allTabs.length} total)`;
      headerTabCount.title = `${currentTabs.length} tabs in this window, ${allTabs.length} across all windows`;
    } else {
      headerTabCount.textContent = `${currentTabs.length} tabs`;
      headerTabCount.title = "Total open tabs";
    }
  }
}

async function loadTriageQueue() {
  const staleHours = Number(appSettings?.staleHours) || 24;
  triageQueue = await getTriageTabs(triageFilterStaleOnly, staleHours, organizeScope === "all");
  currentTriageIndex = 0;
  if (triageBadge) triageBadge.textContent = String(triageQueue.length);

  await renderCurrentTriageCard();
}

async function renderCurrentTriageCard() {
  if (!triageQueue || triageQueue.length === 0 || currentTriageIndex >= triageQueue.length) {
    triageCard.classList.add("hidden");
    triageEmpty.classList.remove("hidden");
    triageProgress.textContent = "0 of 0";
    if (triageBadge) triageBadge.textContent = "0";
    if (cardSleepingIndicator) cardSleepingIndicator.style.display = "none";
    currentCardTabInfo = null;
    return;
  }

  triageCard.classList.remove("hidden");
  triageEmpty.classList.add("hidden");

  const tab = triageQueue[currentTriageIndex];
  currentCardTabInfo = tab;

  triageProgress.textContent = `${currentTriageIndex + 1} of ${triageQueue.length}`;
  if (triageBadge) triageBadge.textContent = String(triageQueue.length - currentTriageIndex);

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
  
  // Show sleeping indicator if tab was discarded by auto-discard extension
  if (cardSleepingIndicator) {
    cardSleepingIndicator.style.display = tab.discarded ? "inline" : "none";
  }

  cardReadTime.textContent = "⏱️ Estimating...";
  cardTakeaway.textContent = "Analyzing page with Gemini...";

  try {
    // Only attempt DOM extraction if tab is active (NOT discarded/sleeping)
    let content = { description: "", snippet: "" };
    if (!tab.discarded) {
      content = await getPageSnippet(tab.id);
    }

    const tabData = {
      id: tab.id,
      title: tab.title,
      url: tab.url,
      favIconUrl: tab.favIconUrl,
      description: content.description,
      snippet: content.snippet,
      discarded: tab.discarded
    };

    currentCardTabInfo = tabData;

    const result = await getTabTakeaway(appSettings.geminiApiKey, tabData, appSettings.model);
    cardTakeaway.textContent = result.takeaway;
    cardReadTime.textContent = `⏱️ ${result.readTime}`;
    currentCardTabInfo.takeaway = result.takeaway;
    currentCardTabInfo.readTime = result.readTime;
  } catch (err) {
    console.warn("Triage analysis error:", err);
    cardTakeaway.textContent = `Summary: ${tab.title}`;
    cardReadTime.textContent = "⏱️ 3 min";
  }
}

async function handleTriageSummarize() {
  if (!currentCardTabInfo) return;
  const originalHtml = btnTriageSummarize.innerHTML;
  btnTriageSummarize.innerHTML = `<span class="btn-icon">⏳</span><span class="btn-text">Summarizing...</span>`;
  btnTriageSummarize.disabled = true;

  try {
    const deepResult = await getDeepSummary(appSettings.geminiApiKey, currentCardTabInfo, appSettings.model);
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
    showToast("Error: " + err.message);
  } finally {
    btnTriageSummarize.innerHTML = originalHtml;
    btnTriageSummarize.disabled = false;
  }
}

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
    showToast("Error: " + err.message);
  }
}

function handleTriageKeep() {
  currentTriageIndex++;
  renderCurrentTriageCard();
}

/**
 * Auto-Cluster Tabs:
 * - Includes both ungrouped tabs AND tabs already inside existing groups for a complete fresh reorganization.
 * - In "current" scope: strictly only affects current window.
 * - In "all" scope: organizes tabs across all windows.
 */
async function handleAutoCluster() {
  const originalHtml = btnAutoCluster.innerHTML;
  btnAutoCluster.innerHTML = `<span class="btn-icon">⏳</span><span>Clustering tabs with ${appSettings.model}...</span>`;
  btnAutoCluster.disabled = true;

  try {
    const currentWindowId = await getCurrentWindowId();
    // In "current" scope: strictly query current window
    // In "all" scope: query all windows
    const tabs = organizeScope === "all" ? await getAllManageableTabs() : await getManageableTabs(currentWindowId);
    
    if (tabs.length === 0) {
      showToast("No active tabs to organize.");
      return;
    }

    const groupSpecs = await clusterTabsWithAI(appSettings.geminiApiKey, tabs, appSettings.model);
    
    // In "current" scope: filterToWindowId = currentWindowId ensures other windows are NEVER touched
    const filterWinId = organizeScope === "all" ? null : currentWindowId;
    const applied = await applyTabGroups(groupSpecs, null, filterWinId);

    const scopeText = organizeScope === "all" ? "across all windows" : "in this window";
    showToast(`🪄 Organized ${tabs.length} tabs into ${applied.length} colored groups ${scopeText}!`);
    await refreshGroupsView();
    await refreshTabCounts();
  } catch (err) {
    showToast("Clustering error: " + err.message);
  } finally {
    btnAutoCluster.innerHTML = originalHtml;
    btnAutoCluster.disabled = false;
  }
}

/**
 * Consolidate all tabs from all open windows into the current window and group them
 */
async function handleConsolidateWindows() {
  if (!btnConsolidateWindows) return;
  const originalHtml = btnConsolidateWindows.innerHTML;
  btnConsolidateWindows.innerHTML = `<span>⏳ Consolidating & grouping with ${appSettings.model}...</span>`;
  btnConsolidateWindows.disabled = true;

  try {
    const currentWindowId = await getCurrentWindowId();
    const allTabs = await getAllManageableTabs();
    if (allTabs.length === 0) {
      showToast("No active tabs found.");
      return;
    }

    const groupSpecs = await clusterTabsWithAI(appSettings.geminiApiKey, allTabs, appSettings.model);
    // Consolidate into current window
    const applied = await applyTabGroups(groupSpecs, currentWindowId, null);

    showToast(`🪟 Consolidated & grouped ${allTabs.length} tabs into this window!`);
    await refreshGroupsView();
    await refreshTabCounts();
  } catch (err) {
    showToast("Consolidation error: " + err.message);
  } finally {
    btnConsolidateWindows.innerHTML = originalHtml;
    btnConsolidateWindows.disabled = false;
  }
}

async function refreshGroupsView() {
  const currentWindowId = await getCurrentWindowId();
  const tabs = organizeScope === "all" ? await getAllManageableTabs() : await getManageableTabs(currentWindowId);
  const groups = await getActiveTabGroups(organizeScope === "all" ? null : currentWindowId);

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

  // Render Groups
  if (groups.length === 0) {
    const emptyP = document.createElement("p");
    emptyP.style.cssText = "font-size:12px; color:var(--text-secondary);";
    emptyP.textContent = "No tab groups created yet. Click Auto-Cluster above!";
    groupsList.appendChild(emptyP);
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

      for (const t of gTabs) {
        const row = document.createElement("div");
        row.className = "group-tab-row";

        const rowTitle = document.createElement("span");
        rowTitle.className = "tab-title-text";
        rowTitle.textContent = t.discarded ? `💤 ${t.title}` : t.title;
        rowTitle.title = t.url;
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
    const emptyP = document.createElement("p");
    emptyP.style.cssText = "font-size:12px; color:var(--text-secondary);";
    emptyP.textContent = "All tabs are grouped.";
    ungroupedList.appendChild(emptyP);
  } else {
    for (const t of ungroupedTabs) {
      const row = document.createElement("div");
      row.className = "group-tab-row";

      const rowTitle = document.createElement("span");
      rowTitle.className = "tab-title-text";
      rowTitle.textContent = t.discarded ? `💤 ${t.title}` : t.title;
      rowTitle.title = t.url;
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

async function loadVault() {
  cachedVaultItems = await getVaultItems();
  if (vaultBadge) vaultBadge.textContent = String(cachedVaultItems.length);
  renderVaultItems(vaultSearchInput ? vaultSearchInput.value : "");
}

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

async function handleCopyMarkdown() {
  if (cachedVaultItems.length === 0) {
    showToast("Vault is empty.");
    return;
  }
  const md = generateMarkdown(cachedVaultItems);
  await navigator.clipboard.writeText(md);
  showToast("📋 Copied all vault summaries to clipboard!");
}

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

async function openSettingsModal() {
  if (!appSettings) {
    appSettings = await getSettings();
  }
  inputApiKey.value = appSettings.geminiApiKey || "";
  selectStaleHours.value = String(appSettings.staleHours || 24);
  
  const currentModel = appSettings.model || "gemini-3.6-flash";
  const knownOptions = Array.from(selectModel.options).map(o => o.value);
  if (knownOptions.includes(currentModel) && currentModel !== "custom") {
    selectModel.value = currentModel;
    customModelContainer?.classList.add("hidden");
  } else {
    selectModel.value = "custom";
    if (inputCustomModel) inputCustomModel.value = currentModel;
    customModelContainer?.classList.remove("hidden");
  }
  settingsModal.classList.remove("hidden");
}

function closeSettingsModal() {
  settingsModal.classList.add("hidden");
}

async function handleSaveSettings() {
  let chosenModel = selectModel.value;
  if (chosenModel === "custom") {
    chosenModel = inputCustomModel?.value?.trim() || "gemini-3.6-flash";
  }

  const updated = await saveSettings({
    geminiApiKey: inputApiKey.value.trim(),
    staleHours: Number(selectStaleHours.value),
    model: chosenModel
  });
  appSettings = updated;
  closeSettingsModal();
  showToast(`Settings saved! Active model: ${chosenModel}`);
  await loadTriageQueue();
}
