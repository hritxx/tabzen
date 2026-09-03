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
  getDeepSummary,
  fetchAvailableModels,
  DEFAULT_MODEL
} from "../lib/gemini.js";

// State
let appSettings = {
  geminiApiKey: "",
  model: DEFAULT_MODEL,
  staleHours: 24,
  autoPromptThreshold: 15
};
let organizeScope = "current"; // "current" | "all"
let triageFilterStaleOnly = false; // false = All tabs (oldest first), true = older than stale threshold
let triageAllWindows = false; // triage window scope, independent of the Groups scope
let triageQueue = [];
let selectedTriageId = null;
let cachedVaultItems = [];
let vaultShowAll = false;
const VAULT_RENDER_LIMIT = 200;
let currentTakeawayAbortController = null;

// DOM Elements
const headerTabCount = document.getElementById("header-tab-count");
const navButtons = document.querySelectorAll(".nav-btn");
const viewPanels = document.querySelectorAll(".view-panel");

// Triage Elements
const btnTriageAll = document.getElementById("btn-triage-all");
const btnTriageStale = document.getElementById("btn-triage-stale");
const btnTriageScopeWindow = document.getElementById("btn-triage-scope-window");
const btnTriageScopeAll = document.getElementById("btn-triage-scope-all");
const triageBadge = document.getElementById("triage-badge");
const triageProgress = document.getElementById("triage-progress");
const triageList = document.getElementById("triage-list");
const triageEmpty = document.getElementById("triage-empty");
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
const optgroupStandardModels = document.getElementById("optgroup-standard-models");
const btnFetchModels = document.getElementById("btn-fetch-models");
const customModelContainer = document.getElementById("custom-model-container");
const inputCustomModel = document.getElementById("input-custom-model");
const btnSaveSettings = document.getElementById("btn-save-settings");

// Toast
const toast = document.getElementById("toast");
let toastTimer = null;

function showToast(message, durationMs = 2800) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove("hidden");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add("hidden");
    toastTimer = null;
  }, durationMs);
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return "Unknown";
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
    updateStalePillLabel();
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
      await setTriageFilter(false);
    });
  }

  if (btnTriageStale) {
    btnTriageStale.addEventListener("click", async () => {
      await setTriageFilter(true);
    });
  }

  // Triage window-scope actions (independent of the Groups scope)
  if (btnTriageScopeWindow) {
    btnTriageScopeWindow.addEventListener("click", async () => {
      triageAllWindows = false;
      btnTriageScopeWindow.classList.add("active");
      btnTriageScopeAll?.classList.remove("active");
      await loadTriageQueue();
    });
  }

  if (btnTriageScopeAll) {
    btnTriageScopeAll.addEventListener("click", async () => {
      triageAllWindows = true;
      btnTriageScopeAll.classList.add("active");
      btnTriageScopeWindow?.classList.remove("active");
      await loadTriageQueue();
    });
  }

  // Triage Card Actions are wired per-row in renderTriageList()
  if (btnRefreshTriage) btnRefreshTriage.addEventListener("click", async () => {
    // The empty-state button promises "all tabs": reset the stale filter
    // instead of reloading an empty stale queue (previous dead end).
    await setTriageFilter(false);
  });
  // Scope Toggle Actions
  if (btnScopeCurrent) {
    btnScopeCurrent.addEventListener("click", () => {
      organizeScope = "current";
      btnScopeCurrent.classList.add("active");
      btnScopeAll?.classList.remove("active");
      if (clusterBtnLabel) clusterBtnLabel.textContent = "Organize current window";
      btnConsolidateWindows?.classList.add("hidden");
    });
  }

  if (btnScopeAll) {
    btnScopeAll.addEventListener("click", () => {
      organizeScope = "all";
      btnScopeAll.classList.add("active");
      btnScopeCurrent?.classList.remove("active");
      if (clusterBtnLabel) clusterBtnLabel.textContent = "Organize all windows";
      btnConsolidateWindows?.classList.remove("hidden");
    });
  }

  // Groups Actions
  if (btnAutoCluster) btnAutoCluster.addEventListener("click", handleAutoCluster);
  if (btnConsolidateWindows) btnConsolidateWindows.addEventListener("click", handleConsolidateWindows);

  // Vault Actions
  if (vaultSearchInput) {
    vaultSearchInput.addEventListener("input", () => {
      vaultShowAll = false;
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
  if (btnFetchModels) {
    btnFetchModels.addEventListener("click", async () => {
      const key = inputApiKey.value.trim() || appSettings.geminiApiKey;
      if (!key) {
        showToast("Please enter an API key first.");
        return;
      }
      btnFetchModels.textContent = "Loading...";
      btnFetchModels.disabled = true;
      try {
        const models = await fetchAvailableModels(key);
        if (models && models.length > 0 && optgroupStandardModels) {
          optgroupStandardModels.innerHTML = "";
          for (const m of models) {
            const opt = document.createElement("option");
            opt.value = m;
            opt.textContent = m;
            optgroupStandardModels.appendChild(opt);
          }
          if (models.includes(appSettings.model)) {
            selectModel.value = appSettings.model;
          } else if (models.includes(DEFAULT_MODEL)) {
            selectModel.value = DEFAULT_MODEL;
          } else {
            selectModel.value = models[0];
          }
          // If the assignment didn't take (value not among options),
          // fall back to the custom input so the model isn't lost.
          if (!selectModel.value) {
            selectModel.value = "custom";
            if (inputCustomModel) inputCustomModel.value = appSettings.model;
          }
          customModelContainer?.classList.add("hidden");
          showToast(`Loaded ${models.length} models.`);
        } else {
          showToast("Could not retrieve models. Please check your API key.");
        }
      } catch (err) {
        showToast("Fetch error: " + err.message);
      } finally {
        btnFetchModels.textContent = "Load models";
        btnFetchModels.disabled = false;
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
    loadTriageQueue().catch(err => console.warn("Triage load error:", err));
  } else if (viewName === "groups") {
    refreshGroupsView().catch(err => console.warn("Groups refresh error:", err));
  } else if (viewName === "vault") {
    loadVault().catch(err => console.warn("Vault load error:", err));
  }
}

async function refreshTabCounts() {
  const currentTabs = await getManageableTabs();
  const allTabs = await getAllManageableTabs();
  
  const currentSleeping = currentTabs.filter(t => t.discarded).length;
  const allSleeping = allTabs.filter(t => t.discarded).length;

  if (headerTabCount) {
    if (allTabs.length > currentTabs.length) {
      const sleepStr = allSleeping > 0 ? ` · ${allSleeping} sleeping` : "";
      headerTabCount.textContent = `${currentTabs.length} tabs (${allTabs.length} total${sleepStr})`;
      headerTabCount.title = `${currentTabs.length} tabs in this window (${currentSleeping} sleeping), ${allTabs.length} across all windows (${allSleeping} sleeping)`;
    } else {
      const sleepStr = currentSleeping > 0 ? ` · ${currentSleeping} sleeping` : "";
      headerTabCount.textContent = `${currentTabs.length} tabs${sleepStr}`;
      headerTabCount.title = `${currentTabs.length} open tabs, ${currentSleeping} sleeping in background`;
    }
  }
}

async function loadTriageQueue() {
  const staleHours = Number(appSettings?.staleHours) || 24;
  triageQueue = await getTriageTabs(triageFilterStaleOnly, staleHours, triageAllWindows);
  for (const item of triageQueue) {
    if (item.takeawayState === undefined) item.takeawayState = "idle";
  }
  selectedTriageId = triageQueue.length > 0 ? triageQueue[0].id : null;
  updateTriageCounts();
  renderTriageList(false);
}

function updateTriageCounts() {
  const remaining = triageQueue ? triageQueue.length : 0;
  if (triageBadge) triageBadge.textContent = String(remaining);
  if (triageProgress) {
    triageProgress.textContent = remaining === 1 ? "1 tab" : `${remaining} tabs`;
  }
}

async function setTriageFilter(staleOnly) {
  triageFilterStaleOnly = staleOnly;
  if (staleOnly) {
    btnTriageStale?.classList.add("active");
    btnTriageAll?.classList.remove("active");
  } else {
    btnTriageAll?.classList.add("active");
    btnTriageStale?.classList.remove("active");
  }
  await loadTriageQueue();
}

function updateStalePillLabel() {
  if (!btnTriageStale) return;
  const hours = Number(appSettings?.staleHours) || 24;
  const label = hours % 24 === 0 ? `Stale (>${hours / 24}d)` : `Stale (>${hours}h)`;
  btnTriageStale.textContent = label;
}

function getSelectedTriageItem() {
  if (!triageQueue || selectedTriageId === null) return null;
  return triageQueue.find(t => t.id === selectedTriageId) || null;
}

function abortTakeawayRequest() {
  if (currentTakeawayAbortController) {
    currentTakeawayAbortController.abort();
    currentTakeawayAbortController = null;
  }
}

function triageDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url || "";
  }
}

/**
 * Full triage list: one row per queued tab, tap to expand the selected row
 * into its review detail (takeaway + actions). Re-rendered on every state
 * change; queues are small enough that this stays cheap.
 */
function renderTriageList(scrollToSelected) {
  abortTakeawayRequest();
  triageList.innerHTML = "";

  if (!triageQueue || triageQueue.length === 0) {
    triageEmpty.classList.remove("hidden");
    selectedTriageId = null;
    updateTriageCounts();
    return;
  }
  triageEmpty.classList.add("hidden");

  // A null selection means the user collapsed all rows — keep it.
  // A stale (removed) id falls back to the first row.
  if (selectedTriageId !== null && !getSelectedTriageItem()) {
    selectedTriageId = triageQueue[0].id;
  }

  triageQueue.forEach((item, index) => {
    const expanded = item.id === selectedTriageId;

    const container = document.createElement("div");
    container.className = "triage-item" + (expanded ? " expanded" : "");
    container.dataset.id = String(item.id);

    const row = document.createElement("div");
    row.className = "triage-row";

    const fav = document.createElement("img");
    fav.className = "triage-row-favicon";
    fav.src = item.favIconUrl || "../icons/icon-16.png";
    fav.alt = "";
    fav.onerror = () => { fav.src = "../icons/icon-16.png"; };

    const main = document.createElement("div");
    main.className = "triage-row-main";

    const title = document.createElement("div");
    title.className = "triage-row-title";
    title.textContent = item.title || "Untitled Tab";
    title.title = item.url;

    const meta = document.createElement("div");
    meta.className = "triage-row-meta";
    const tags = [triageDomain(item.url), formatTimeAgo(item.lastAccessed)];
    if (item.discarded) tags.push("Sleeping");
    if (item.takeawayState === "done") tags.push("Reviewed");
    meta.textContent = tags.join(" · ");

    main.appendChild(title);
    main.appendChild(meta);

    const pos = document.createElement("span");
    pos.className = "triage-row-pos";
    pos.textContent = String(index + 1);

    row.appendChild(fav);
    row.appendChild(main);
    row.appendChild(pos);
    row.addEventListener("click", () => {
      selectedTriageId = expanded ? null : item.id;
      renderTriageList(false);
    });
    container.appendChild(row);

    if (expanded) {
      container.appendChild(buildTriageDetail(item));
    }

    triageList.appendChild(container);
  });

  updateTriageCounts();

  if (scrollToSelected && selectedTriageId !== null) {
    triageList.querySelector(`[data-id="${selectedTriageId}"]`)?.scrollIntoView({ block: "nearest" });
  }
}

function buildTriageDetail(item) {
  const detail = document.createElement("div");
  detail.className = "triage-detail";

  const topRow = document.createElement("div");
  topRow.className = "triage-detail-top";

  const readTime = document.createElement("span");
  readTime.className = "card-read-time";
  readTime.textContent = item.readTime || "";

  const openBtn = document.createElement("button");
  openBtn.className = "triage-open-btn";
  openBtn.textContent = "Open tab";
  openBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    activateTab(item.id);
  });

  topRow.appendChild(readTime);
  topRow.appendChild(openBtn);
  detail.appendChild(topRow);

  const box = document.createElement("div");
  box.className = "card-summary-box";

  const label = document.createElement("div");
  label.className = "summary-label";
  label.textContent = "AI Takeaway";
  box.appendChild(label);

  const text = document.createElement("p");
  text.className = "summary-text";
  if (item.takeawayState === "done") {
    text.textContent = item.takeaway;
  } else if (item.takeawayState === "loading") {
    text.textContent = "Generating takeaway...";
  } else if (item.takeawayState === "error") {
    text.textContent = item.takeawayError || "Takeaway unavailable.";
  } else {
    text.textContent = "Takeaways generate only when you ask — no background API calls.";
  }
  box.appendChild(text);

  if (item.takeawayState !== "done" && item.takeawayState !== "loading") {
    const genBtn = document.createElement("button");
    genBtn.className = "secondary-btn btn-generate";
    genBtn.type = "button";
    genBtn.textContent = "Generate AI takeaway";
    genBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      loadSelectedTakeaway(item);
    });
    box.appendChild(genBtn);
  }
  detail.appendChild(box);

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const summarizeBtn = document.createElement("button");
  summarizeBtn.className = "action-btn btn-summarize";
  summarizeBtn.title = "Deep summary and close tab";
  summarizeBtn.disabled = Boolean(item.actionBusy);
  const summarizeLabel = document.createElement("span");
  summarizeLabel.className = "btn-text";
  summarizeLabel.textContent = item.actionBusy === "summarize" ? "Summarizing..." : "Summarize & Close";
  summarizeBtn.appendChild(summarizeLabel);
  summarizeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    summarizeTriageItem(item);
  });

  const stashBtn = document.createElement("button");
  stashBtn.className = "action-btn btn-stash";
  stashBtn.title = "Save link to vault and close tab";
  stashBtn.disabled = Boolean(item.actionBusy);
  const stashLabel = document.createElement("span");
  stashLabel.className = "btn-text";
  stashLabel.textContent = "Stash";
  stashBtn.appendChild(stashLabel);
  stashBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    stashTriageItem(item);
  });

  const keepBtn = document.createElement("button");
  keepBtn.className = "action-btn btn-keep";
  keepBtn.title = "Collapse and move to next tab";
  const keepLabel = document.createElement("span");
  keepLabel.className = "btn-text";
  keepLabel.textContent = "Keep";
  keepBtn.appendChild(keepLabel);
  keepBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    keepTriageItem(item);
  });

  actions.appendChild(summarizeBtn);
  actions.appendChild(stashBtn);
  actions.appendChild(keepBtn);
  detail.appendChild(actions);

  return detail;
}

/**
 * On-demand takeaway for the expanded row. The ONLY path that calls the
 * takeaway API during triage — browsing the list costs zero requests.
 */
async function loadSelectedTakeaway(item) {
  if (!item || item.takeawayState === "loading" || item.takeawayState === "done") return;
  item.takeawayState = "loading";
  item.takeawayError = "";
  renderTriageList(false);

  const controller = new AbortController();
  currentTakeawayAbortController = controller;

  try {
    let content = { description: "", snippet: "" };
    if (!item.discarded) {
      content = await getPageSnippet(item.id);
    }

    if (controller.signal.aborted) return;

    const tabData = {
      id: item.id,
      title: item.title,
      url: item.url,
      favIconUrl: item.favIconUrl,
      description: content.description,
      snippet: content.snippet,
      discarded: item.discarded
    };

    const result = await getTabTakeaway(appSettings.geminiApiKey, tabData, appSettings.model, controller.signal);
    if (controller.signal.aborted) return;
    item.description = content.description;
    item.snippet = content.snippet;
    item.takeaway = result.takeaway;
    item.readTime = result.readTime;
    item.takeawayState = "done";
  } catch (err) {
    if (err.name !== "AbortError") {
      console.warn("Triage analysis error:", err);
      item.takeawayState = "error";
      item.takeawayError = (err.message.includes("rate limit") || err.message.includes("429"))
        ? "Gemini quota cooldown. Try again shortly."
        : "Takeaway unavailable.";
    }
  } finally {
    if (currentTakeawayAbortController === controller) {
      currentTakeawayAbortController = null;
    }
    renderTriageList(false);
  }
}

function removeTriageItem(id, scroll) {
  const idx = triageQueue.findIndex(t => t.id === id);
  if (idx !== -1) triageQueue.splice(idx, 1);
  const next = triageQueue[Math.min(idx, triageQueue.length - 1)] || null;
  selectedTriageId = next ? next.id : null;
  renderTriageList(scroll);
}

async function summarizeTriageItem(item) {
  if (!item || item.actionBusy) return;
  item.actionBusy = "summarize";
  renderTriageList(false);

  try {
    // Fetch a fresh snippet if none was captured yet, so the deep summary
    // isn't running on empty input.
    if (!item.snippet && !item.discarded && item.id) {
      try {
        const fresh = await getPageSnippet(item.id);
        item.description = item.description || fresh.description;
        item.snippet = fresh.snippet;
      } catch (err) {
        console.warn("Fresh snippet fetch failed:", err);
      }
    }
    const deepResult = await getDeepSummary(appSettings.geminiApiKey, item, appSettings.model);
    await addToVault({
      url: item.url,
      title: item.title,
      favIconUrl: item.favIconUrl,
      takeaway: deepResult.takeaway,
      bullets: deepResult.bullets,
      readTime: deepResult.readTime
    });

    await closeTab(item.id);
    showToast("Summarized and saved to Vault.");
    removeTriageItem(item.id, true);
    await refreshTabCounts();
    await loadVault();
  } catch (err) {
    showToast("Error: " + err.message);
    item.actionBusy = null;
    renderTriageList(false);
  }
}

async function stashTriageItem(item) {
  if (!item || item.actionBusy) return;
  item.actionBusy = "stash";
  renderTriageList(false);
  try {
    await addToVault({
      url: item.url,
      title: item.title,
      favIconUrl: item.favIconUrl,
      takeaway: item.takeaway || "Stashed tab.",
      bullets: [],
      readTime: item.readTime || "3 min"
    });

    await closeTab(item.id);
    showToast("Stashed to Vault.");
    removeTriageItem(item.id, true);
    await refreshTabCounts();
    await loadVault();
  } catch (err) {
    showToast("Error: " + err.message);
    item.actionBusy = null;
    renderTriageList(false);
  }
}

function keepTriageItem(item) {
  if (!item) return;
  const idx = triageQueue.findIndex(t => t.id === item.id);
  const next = triageQueue[idx + 1] || triageQueue[0] || null;
  selectedTriageId = next ? next.id : null;
  renderTriageList(true);
}

/**
 * Auto-Cluster Tabs:
 * - Includes both ungrouped tabs AND tabs already inside existing groups for a complete fresh reorganization.
 * - In "current" scope: strictly only affects current window.
 * - In "all" scope: organizes tabs across all windows.
 */
async function handleAutoCluster() {
  const originalHtml = btnAutoCluster.innerHTML;
  btnAutoCluster.innerHTML = `<span>Organizing with ${appSettings.model}...</span>`;
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
    showToast(`Organized ${tabs.length} tabs into ${applied.length} groups ${scopeText}.`);
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
  btnConsolidateWindows.innerHTML = `<span>Consolidating with ${appSettings.model}...</span>`;
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

    showToast(`Consolidated ${allTabs.length} tabs into this window.`);
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
    emptyP.textContent = "No groups yet. Organize to create some.";
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
      closeGroupBtn.textContent = "Close group";
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
        rowTitle.textContent = t.discarded ? `Sleeping · ${t.title}` : t.title;
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
      rowTitle.textContent = t.discarded ? `Sleeping · ${t.title}` : t.title;
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
  vaultShowAll = false;
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

  const visible = vaultShowAll ? filtered : filtered.slice(0, VAULT_RENDER_LIMIT);
  for (const item of visible) {
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
    // textContent (not innerHTML): readTime originates from the AI model.
    const domainSpan = document.createElement("span");
    domainSpan.textContent = `${domain} • ${formatTimeAgo(item.stashedAt)}`;
    const readTimeSpan = document.createElement("span");
    readTimeSpan.textContent = `${item.readTime || "3 min"}`;
    metaEl.appendChild(domainSpan);
    metaEl.appendChild(readTimeSpan);

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
    openBtn.textContent = "Open";
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

  if (!vaultShowAll && filtered.length > visible.length) {
    const showAllBtn = document.createElement("button");
    showAllBtn.className = "secondary-btn";
    showAllBtn.textContent = `Show all ${filtered.length} items`;
    showAllBtn.addEventListener("click", () => {
      vaultShowAll = true;
      renderVaultItems(query);
    });
    vaultItemsContainer.appendChild(showAllBtn);
  }
}

async function handleCopyMarkdown() {
  if (cachedVaultItems.length === 0) {
    showToast("Vault is empty.");
    return;
  }
  const md = generateMarkdown(cachedVaultItems);
  await navigator.clipboard.writeText(md);
  showToast("Vault copied to clipboard.");
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
  showToast("Vault downloaded.");
}

async function openSettingsModal() {
  if (!appSettings) {
    appSettings = await getSettings();
  }
  inputApiKey.value = appSettings.geminiApiKey || "";
  selectStaleHours.value = String(appSettings.staleHours || 24);

  const currentModel = appSettings.model || DEFAULT_MODEL;
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
    chosenModel = inputCustomModel?.value?.trim() || DEFAULT_MODEL;
  }

  const updated = await saveSettings({
    geminiApiKey: inputApiKey.value.trim(),
    staleHours: Number(selectStaleHours.value),
    model: chosenModel
  });
  appSettings = updated;
  updateStalePillLabel();
  closeSettingsModal();
  showToast(`Settings saved. Model: ${chosenModel}`);
  await loadTriageQueue();
}
