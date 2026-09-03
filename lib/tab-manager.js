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

export async function getManageableTabs(targetWindowId = undefined) {
  // Convention: undefined = current window, null = all windows.
  if (targetWindowId === null) {
    return await getAllManageableTabs();
  }
  const windowId = targetWindowId ?? await getCurrentWindowId();
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

export function parseSuspendedTab(tab) {
  if (!tab || !tab.url) return null;
  const rawUrl = tab.url;

  // Don't manage our own extension side panel or popups
  if (chrome?.runtime?.id && rawUrl.includes(chrome.runtime.id)) {
    return null;
  }

  // 1. Extension-based tab suspenders (The Great Suspender, Auto Tab Discard, Tab Suspender, Marvellous Suspender, etc.)
  if (rawUrl.startsWith("chrome-extension://")) {
    let extractedUrl = null;
    let extractedTitle = tab.title;

    try {
      const u = new URL(rawUrl);
      // Check query params: uri, url, target, original_url, u
      extractedUrl = u.searchParams.get("uri") || u.searchParams.get("url") || u.searchParams.get("target") || u.searchParams.get("original_url") || u.searchParams.get("u");

      // Check hash params (#ttl=...&uri=https%3A%2F%2F...)
      if (!extractedUrl && u.hash) {
        const hashStr = u.hash.replace(/^#/, "");
        const hashParams = new URLSearchParams(hashStr);
        extractedUrl = hashParams.get("uri") || hashParams.get("url") || hashParams.get("target") || hashParams.get("original_url") || hashParams.get("u");
        if (hashParams.has("ttl")) {
          try { extractedTitle = decodeURIComponent(hashParams.get("ttl")); } catch {}
        }
      }
    } catch {}

    if (!extractedUrl) {
      const matchEncoded = rawUrl.match(/(?:uri|url|target|link)=([^&]+)/i);
      if (matchEncoded && matchEncoded[1]) {
        try {
          const decoded = decodeURIComponent(matchEncoded[1]);
          if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
            extractedUrl = decoded;
          }
        } catch {}
      }
    }

    if (!extractedUrl) {
      const matchDirect = rawUrl.match(/(https?:\/\/[^\s&]+)/i);
      if (matchDirect && matchDirect[1]) {
        extractedUrl = matchDirect[1];
      }
    }

    if (extractedUrl && (extractedUrl.startsWith("http://") || extractedUrl.startsWith("https://"))) {
      let cleanTitle = (extractedTitle || tab.title || "Suspended Tab")
        .replace(/^\[(?:Suspended|Sleeping|Inactive|Discarded)\]\s*/i, "")
        .replace(/^💤\s*/i, "")
        .trim();

      return {
        isSuspended: true,
        originalUrl: extractedUrl,
        cleanTitle: cleanTitle
      };
    }

    // Other non-suspender extension pages (settings, etc.)
    return null;
  }

  // 2. Native Chromium / Brave discarded tab
  if (tab.discarded || tab.status === "unloaded") {
    return {
      isSuspended: true,
      originalUrl: tab.url,
      cleanTitle: tab.title
    };
  }

  return null;
}

export function isManageableTab(tab) {
  if (!tab || !tab.url) return false;
  const u = tab.url.toLowerCase();

  // If it's a suspended tab from an extension, it IS manageable!
  const suspended = parseSuspendedTab(tab);
  if (suspended) {
    return true;
  }

  return (
    !u.startsWith("chrome://") &&
    !u.startsWith("brave://") &&
    !u.startsWith("devtools://") &&
    !u.startsWith("chrome-extension://")
  );
}

function formatTab(tab, tabAccessTimes) {
  const lastAccessed = tabAccessTimes[tab.id] || tab.lastAccessed || Date.now();
  const suspendedInfo = parseSuspendedTab(tab);
  const isDiscarded = Boolean(tab.discarded || tab.status === "unloaded" || suspendedInfo?.isSuspended);
  const effectiveUrl = suspendedInfo?.originalUrl || tab.url;
  const effectiveTitle = suspendedInfo?.cleanTitle || tab.title || "Untitled";

  return {
    id: tab.id,
    title: effectiveTitle,
    url: effectiveUrl,
    favIconUrl: tab.favIconUrl || "",
    pinned: Boolean(tab.pinned),
    groupId: tab.groupId,
    windowId: tab.windowId,
    discarded: isDiscarded,
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

export async function getActiveTabGroups(targetWindowId = undefined) {
  // Convention: undefined = current window, null = all windows.
  if (targetWindowId === null) {
    return await chrome.tabGroups.query({});
  }
  const windowId = targetWindowId ?? await getCurrentWindowId();
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

      // A "group" of one is visual noise — leave it ungrouped.
      if (movedIds.length <= 1) continue;

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
        // A "group" of one is visual noise — leave it ungrouped.
        if (tIds.length <= 1) continue;
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
 * If a tab is discarded / sleeping (including extension-suspended tabs), it
 * DOES NOT inject content scripts, avoiding waking up or reloading inactive
 * tabs into RAM! Restricted pages (chrome://, Web Store, etc.) are skipped
 * before attempting injection to avoid noisy permission errors.
 * For active tabs, uses a 1-second timeout race to prevent hangs.
 */
const RESTRICTED_URL_PREFIXES = [
  "chrome://",
  "brave://",
  "devtools://",
  "chrome-extension://",
  "edge://",
  "about:"
];

export async function getPageSnippet(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || tab.discarded) {
      // Tab is sleeping/discarded: DO NOT wake it up!
      return { description: "", snippet: "" };
    }
    if (parseSuspendedTab(tab)) {
      // Extension-suspended tab (suspender UI page, not the article): skip.
      return { description: "", snippet: "" };
    }
    const urlLower = (tab.url || "").toLowerCase();
    if (RESTRICTED_URL_PREFIXES.some(prefix => urlLower.startsWith(prefix))) {
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
