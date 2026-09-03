// TabZen Tab & Group Manager Library (ES Module)

export async function getCurrentWindowId() {
  try {
    const current = await chrome.windows.getCurrent();
    if (current && current.id !== undefined && current.id !== null && current.id !== -1) {
      return current.id;
    }
  } catch (err) {
    console.warn("Could not get current window:", err);
  }

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
    lastAccessed
  };
}

export async function getStaleTabs(staleHours = 24, allWindows = false) {
  const tabs = allWindows ? await getAllManageableTabs() : await getManageableTabs();
  const thresholdMs = Date.now() - staleHours * 60 * 60 * 1000;
  return tabs.filter(tab => !tab.pinned && tab.lastAccessed <= thresholdMs);
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
 * Apply groups to tabs.
 * If targetWindowId is set, moves tabs from other windows into targetWindowId first.
 * Otherwise, groups tabs within their respective windows.
 */
export async function applyTabGroups(groupSpecs, targetWindowId = null) {
  const allTabs = await getAllManageableTabs();
  const tabMap = new Map(allTabs.map(t => [t.id, t]));

  const results = [];

  for (const spec of groupSpecs) {
    const rawIds = spec.tabIds || [];
    const validTabs = rawIds.map(id => tabMap.get(id)).filter(Boolean);
    if (validTabs.length === 0) continue;

    const color = normalizeTabColor(spec.color);
    const title = spec.name || "Group";

    if (targetWindowId !== null) {
      // Consolidate mode: move all tabs into target window first
      const movedIds = [];
      for (const t of validTabs) {
        try {
          if (t.windowId !== targetWindowId) {
            await chrome.tabs.move(t.id, { windowId: targetWindowId, index: -1 });
          }
          movedIds.push(t.id);
        } catch (err) {
          console.warn("Could not move tab to window:", t.id, err);
        }
      }

      if (movedIds.length > 0) {
        try {
          // Ungroup first to prevent stale group locks
          try { await chrome.tabs.ungroup(movedIds); } catch {}
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
      // In-place mode: partition tabs by windowId so chrome.tabs.group never errors across windows
      const windowPartitions = new Map();
      for (const t of validTabs) {
        const wId = t.windowId;
        if (!windowPartitions.has(wId)) windowPartitions.set(wId, []);
        windowPartitions.get(wId).push(t.id);
      }

      for (const [wId, tIds] of windowPartitions.entries()) {
        try {
          try { await chrome.tabs.ungroup(tIds); } catch {}
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

export async function getPageSnippet(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const metaDesc = document.querySelector('meta[name="description"]')?.content ||
                         document.querySelector('meta[property="og:description"]')?.content || "";
        
        const mainEl = document.querySelector("article, main, #content, .content") || document.body;
        const text = mainEl ? mainEl.innerText.replace(/\s+/g, " ").trim() : "";
        
        return {
          description: metaDesc,
          snippet: text.slice(0, 2000)
        };
      }
    });

    if (results && results[0] && results[0].result) {
      return results[0].result;
    }
  } catch (err) {
    console.warn("Could not inject content script to tab:", tabId, err);
  }
  return { description: "", snippet: "" };
}
