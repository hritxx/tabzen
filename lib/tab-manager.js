// TabZen Tab & Group Manager Library (ES Module)

export async function getCurrentWindowId() {
  const current = await chrome.windows.getCurrent();
  return current.id;
}

export async function getManageableTabs() {
  const windowId = await getCurrentWindowId();
  const tabs = await chrome.tabs.query({ windowId });
  const { tabAccessTimes = {} } = await chrome.storage.local.get("tabAccessTimes");

  return tabs
    .filter(tab => {
      if (!tab.url) return false;
      const u = tab.url.toLowerCase();
      return (
        !u.startsWith("chrome://") &&
        !u.startsWith("brave://") &&
        !u.startsWith("devtools://") &&
        !u.startsWith("chrome-extension://")
      );
    })
    .map(tab => {
      // Use recorded tabAccessTime or tab.lastAccessed fallback
      const lastAccessed = tabAccessTimes[tab.id] || tab.lastAccessed || Date.now();
      return {
        id: tab.id,
        title: tab.title || "Untitled",
        url: tab.url,
        favIconUrl: tab.favIconUrl || "",
        pinned: Boolean(tab.pinned),
        groupId: tab.groupId,
        lastAccessed
      };
    });
}

export async function getStaleTabs(staleHours = 24) {
  const tabs = await getManageableTabs();
  const thresholdMs = Date.now() - staleHours * 60 * 60 * 1000;
  return tabs.filter(tab => !tab.pinned && tab.lastAccessed <= thresholdMs);
}

export async function getActiveTabGroups() {
  const windowId = await getCurrentWindowId();
  return await chrome.tabGroups.query({ windowId });
}

// Map any LLM generated color name to valid Chromium TabGroupColor enum:
// "grey" | "blue" | "red" | "yellow" | "green" | "pink" | "purple" | "cyan" | "orange"
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

export async function applyTabGroups(groupSpecs) {
  const windowId = await getCurrentWindowId();
  const currentTabs = await chrome.tabs.query({ windowId });
  const validTabIdSet = new Set(currentTabs.map(t => t.id));

  const results = [];
  for (const spec of groupSpecs) {
    // Filter tab IDs to only tabs currently existing in window
    const validTabIds = (spec.tabIds || []).filter(id => validTabIdSet.has(id));
    if (validTabIds.length === 0) continue;

    try {
      const groupId = await chrome.tabs.group({ tabIds: validTabIds });
      const color = normalizeTabColor(spec.color);
      await chrome.tabGroups.update(groupId, {
        title: spec.name || "Group",
        color: color,
        collapsed: false
      });
      results.push({ groupId, name: spec.name, count: validTabIds.length });
    } catch (err) {
      console.warn("Failed to group tabs for:", spec.name, err);
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

// Safely extract page content snippet for AI summarization
export async function getPageSnippet(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Look for meta description
        const metaDesc = document.querySelector("meta[name="description"]")?.content ||
                         document.querySelector("meta[property="og:description"]")?.content || "";
        
        // Grab main content or headings and paragraphs
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
    // Restricted or discarded tab, return empty fallback
    console.warn("Could not inject content script to tab:", tabId, err);
  }
  return { description: "", snippet: "" };
}
