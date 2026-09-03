// TabZen Tab & Group Manager Library (ES Module)

export async function getCurrentWindowId() {
  try {
    const current = await chrome.windows.getCurrent({ windowTypes: ["normal"] });
    if (current && current.id !== undefined && current.id !== null && current.id !== -1) {
      return current.id;
    }
  } catch (err) {}

  try {
    const lastFocused = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
    if (lastFocused && lastFocused.id !== undefined && lastFocused.id !== null && lastFocused.id !== -1) {
      return lastFocused.id;
    }
  } catch (err) {}

  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && activeTab.windowId) {
      return activeTab.windowId;
    }
  } catch (err) {}

  return undefined;
}

export async function getManageableTabs(targetWindowId = null) {
  const windowId = targetWindowId !== null ? targetWindowId : await getCurrentWindowId();
  const queryOptions = windowId !== undefined ? { windowId } : { currentWindow: true };
  const tabs = await chrome.tabs.query(queryOptions);
  const { tabAccessTimes = {} } = await chrome.storage.local.get("tabAccessTimes");

  return tabs
    .filter(tab => isManageableTab(tab))
    .map(tab => formatTab(tab, tabAccessTimes));
}

export async function getAllManageableTabs() {
  const tabs = await chrome.tabs.query({});
  const { tabAccessTimes = {} } = await chrome.storage.local.get("tabAccessTimes");

  return tabs
    .filter(tab => isManageableTab(tab))
    .map(tab => formatTab(tab, tabAccessTimes));
}

function isManageableTab(tab) {
  if (!tab || !tab.url) return false;
  const u = tab.url.toLowerCase();
  return (
    !u.startsWith("chrome://") &&
    !u.startsWith("brave://") &&
    !u.startsWith("devtools://") &&
    !u.startsWith("chrome-extension://")
  );
}

function formatTab(tab, tabAccessTimes) {
  const lastAccessed = tabAccessTimes[tab.id] || tab.lastAccessed || Date.now();
  return {
    id: tab.id,
    title: tab.title || "Untitled",
    url: tab.url,
    favIconUrl: tab.favIconUrl || "",
    pinned: Boolean(tab.pinned),
    groupId: tab.groupId,
    windowId: tab.windowId,
    discarded: Boolean(tab.discarded),
    lastAccessed
  };
}

/**
 * Returns tabs for triage.
 * By default returns ALL non-pinned tabs sorted oldest-first so all unread tabs can be triaged!
 * If filterStaleOnly is true, only returns tabs older than staleHours.
 */
export async function getTriageTabs(filterStaleOnly = false, staleHours = 24, allWindows = false) {
  const tabs = allWindows ? await getAllManageableTabs() : await getManageableTabs();
  const unpinned = tabs.filter(tab => !tab.pinned);

  if (filterStaleOnly) {
    const thresholdMs = Date.now() - staleHours * 60 * 60 * 1000;
    return unpinned
      .filter(tab => tab.lastAccessed <= thresholdMs)
      .sort((a, b) => a.lastAccessed - b.lastAccessed);
  }

  // Sort by oldest lastAccessed first (least recently viewed tabs first)
  return unpinned.sort((a, b) => a.lastAccessed - b.lastAccessed);
}

export async function getStaleTabs(staleHours = 24, allWindows = false) {
  return getTriageTabs(true, staleHours, allWindows);
}

export async function getActiveTabGroups(targetWindowId = null) {
  const windowId = targetWindowId !== null ? targetWindowId : await getCurrentWindowId();
  const queryOptions = windowId !== undefined ? { windowId } : {};
  return await chrome.tabGroups.query(queryOptions);
}

export function normalizeTabColor(color) {
  const validColors = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];
  if (!color) return "blue";
  const c = color.toLowerCase().trim();
  if (validColors.includes(c)) return c;
  if (c.includes("violet") || c.includes("magenta")) return "purple";
  if (c.includes("teal") || c.includes("aqua")) return "cyan";
  if (c.includes("amber") || c.includes("gold")) return "yellow";
  if (c.includes("rose")) return "pink";
  if (c.includes("emerald")) return "green";
  return "blue";
}

/**
 * Regroup tabs cleanly:
 * - Dissolves old groups for these tabs first so they can be freshly categorized.
 * - If consolidateToWindowId is provided: pulls all tabs to that window and groups them there.
 * - If filterToWindowId is provided: strictly ONLY groups tabs belonging to that window (never touches other windows).
 * - Otherwise: groups tabs in-place within their respective windows.
 */
export async function applyTabGroups(groupSpecs, consolidateToWindowId = null, filterToWindowId = null) {
  const allTabs = await getAllManageableTabs();
  const tabMap = new Map(allTabs.map(t => [t.id, t]));

  // 1. Gather all tab IDs that are going to be grouped
  const allValidIds = [];
  for (const spec of groupSpecs) {
    for (const id of spec.tabIds || []) {
      const tab = tabMap.get(id);
      if (!tab) continue;
      // If scoped to a single window, strictly skip any tabs in other windows!
      if (filterToWindowId !== null && tab.windowId !== filterToWindowId) continue;
      allValidIds.push(id);
    }
  }

  // 2. Ungroup all tabs first to dissolve previous obsolete groups
  if (allValidIds.length > 0) {
    try {
      await chrome.tabs.ungroup(allValidIds);
    } catch (err) {
      console.warn("Ungroup error:", err);
    }
  }

  const results = [];

  // 3. Form fresh groups
  for (const spec of groupSpecs) {
    const rawIds = spec.tabIds || [];
    let validTabs = rawIds.map(id => tabMap.get(id)).filter(Boolean);

    // If strictly filtered to a single window, exclude tabs from other windows
    if (filterToWindowId !== null) {
      validTabs = validTabs.filter(t => t.windowId === filterToWindowId);
    }

    if (validTabs.length === 0) continue;

    const color = normalizeTabColor(spec.color);
    const title = spec.name || "Group";

    if (consolidateToWindowId !== null) {
      // Pull mode: move all tabs into consolidateToWindowId
      const movedIds = [];
      for (const t of validTabs) {
        try {
          if (t.windowId !== consolidateToWindowId) {
            await chrome.tabs.move(t.id, { windowId: consolidateToWindowId, index: -1 });
          }
          movedIds.push(t.id);
        } catch (err) {
          console.warn("Could not move tab to window:", t.id, err);
        }
      }

      if (movedIds.length > 0) {
        try {
          const groupId = await chrome.tabs.group({ tabIds: movedIds });
          await chrome.tabGroups.update(groupId, {
            title: title,
            color: color,
            collapsed: false
          });
          results.push({ groupId, name: title, count: movedIds.length });
        } catch (err) {
          console.warn("Failed to group consolidated tabs:", title, err);
        }
      }
    } else {
      // In-place mode: partition tabs by windowId so chrome.tabs.group never errors
      const windowPartitions = new Map();
      for (const t of validTabs) {
        const wId = t.windowId;
        if (!windowPartitions.has(wId)) windowPartitions.set(wId, []);
        windowPartitions.get(wId).push(t.id);
      }

      for (const [wId, tIds] of windowPartitions.entries()) {
        try {
          const groupId = await chrome.tabs.group({ tabIds: tIds });
          await chrome.tabGroups.update(groupId, {
            title: title,
            color: color,
            collapsed: false
          });
          results.push({ groupId, name: title, count: tIds.length, windowId: wId });
        } catch (err) {
          console.warn(`Failed to group tabs in window ${wId} for ${title}:`, err);
        }
      }
    }
  }

  return results;
}

export async function closeTab(tabId) {
  try {
    await chrome.tabs.remove(tabId);
    return true;
  } catch (err) {
    console.warn("Failed to close tab:", tabId, err);
    return false;
  }
}

export async function closeTabGroup(groupId) {
  try {
    const tabs = await chrome.tabs.query({ groupId });
    const tabIds = tabs.map(t => t.id);
    if (tabIds.length > 0) {
      await chrome.tabs.remove(tabIds);
    }
    return true;
  } catch (err) {
    console.warn("Failed to close tab group:", groupId, err);
    return false;
  }
}

export async function openTab(url) {
  return await chrome.tabs.create({ url, active: true });
}

export async function activateTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab) {
      await chrome.tabs.update(tabId, { active: true });
      if (tab.windowId) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
    }
  } catch (err) {
    console.warn("Failed to activate tab:", tabId, err);
  }
}

/**
 * Smart snippet extractor:
 * If a tab is discarded / sleeping, it DOES NOT inject content scripts,
 * avoiding waking up or reloading inactive tabs into RAM!
 * For active tabs, uses a 1-second timeout race to prevent hangs.
 */
export async function getPageSnippet(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || tab.discarded) {
      // Tab is sleeping/discarded: DO NOT wake it up!
      return { description: "", snippet: "" };
    }

    const scriptPromise = chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const metaDesc = document.querySelector('meta[name="description"]')?.content ||
                         document.querySelector('meta[property="og:description"]')?.content || "";
        
        const mainEl = document.querySelector("article, main, #content, .content") || document.body;
        const text = mainEl ? mainEl.innerText.replace(/\s+/g, " ").trim() : "";
        
        return {
          description: metaDesc,
          snippet: text.slice(0, 1500)
        };
      }
    });

    const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), 1000));
    const results = await Promise.race([scriptPromise, timeoutPromise]);

    if (results && results[0] && results[0].result) {
      return results[0].result;
    }
  } catch (err) {
    // Discarded or restricted page
  }
  return { description: "", snippet: "" };
}
