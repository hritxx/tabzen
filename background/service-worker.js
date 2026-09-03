// TabZen Service Worker (Manifest V3)

import { DEFAULT_MODEL } from "../lib/gemini.js";
import { isManageableTab } from "../lib/tab-manager.js";

// 1. Configure Side Panel behavior to open on extension action click
chrome.runtime.onInstalled.addListener(async () => {
  try {
    if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
  } catch (err) {
    console.warn("setPanelBehavior error:", err);
  }

  // Initialize default settings if not set
  const { settings } = await chrome.storage.local.get("settings");
  if (!settings) {
    await chrome.storage.local.set({
      settings: {
        geminiApiKey: "",
        model: DEFAULT_MODEL,
        staleHours: 24,
        autoPromptThreshold: 15
      },
      vault: [],
      tabAccessTimes: {}
    });
  }

  // Create periodic alarm to check stale tabs every hour
  chrome.alarms.create("checkStaleTabs", { periodInMinutes: 60 });
  await updateTabCountBadge();
});

// Alarms can be cleared on browser restart — recreate on startup.
chrome.runtime.onStartup.addListener(async () => {
  chrome.alarms.create("checkStaleTabs", { periodInMinutes: 60 });
  await updateTabCountBadge();
});

// Fallback action click handler in case browser does not support openPanelOnActionClick
chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (chrome.sidePanel && chrome.sidePanel.open && tab.windowId) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    }
  } catch (err) {
    console.warn("Side panel open error:", err);
  }
});

// 2. Track tab activity timestamps
async function recordTabAccess(tabId) {
  if (!tabId || tabId < 0) return;
  try {
    const { tabAccessTimes = {} } = await chrome.storage.local.get("tabAccessTimes");
    tabAccessTimes[tabId] = Date.now();
    await chrome.storage.local.set({ tabAccessTimes });
  } catch (err) {
    console.error("Failed to record tab access:", err);
  }
}

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await recordTabAccess(activeInfo.tabId);
  await updateTabCountBadge();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    await recordTabAccess(tabId);
    await updateTabCountBadge();
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    const { tabAccessTimes = {} } = await chrome.storage.local.get("tabAccessTimes");
    if (tabAccessTimes[tabId]) {
      delete tabAccessTimes[tabId];
      await chrome.storage.local.set({ tabAccessTimes });
    }
    await updateTabCountBadge();
  } catch (err) {
    console.error("Failed to clean removed tab:", err);
  }
});

// 3. Tab Badge Counter
async function updateTabCountBadge() {
  try {
    const tabs = await chrome.tabs.query({});
    // Same manageability rules as triage so the badge and panel agree.
    const validTabs = tabs.filter(isManageableTab);
    const count = validTabs.length;
    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
    await chrome.action.setBadgeBackgroundColor({ color: "#6366F1" });
  } catch (err) {
    console.warn("Error updating badge:", err);
  }
}

// 4. Alarm listener
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "checkStaleTabs") {
    await updateTabCountBadge();
  }
});
