// TabZen Vault & Storage Library (ES Module)

export async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  let model = settings.model || "gemini-3.6-flash";
  if (model === "gemini-3-pro" || model === "gemini-3-flash" || model.includes("2.5") || model.includes("1.5") || model.includes("2.0")) {
    model = "gemini-3.6-flash";
    settings.model = model;
    await chrome.storage.local.set({ settings });
  }
  return {
    geminiApiKey: settings.geminiApiKey || "",
    model,
    staleHours: settings.staleHours || 24,
    autoPromptThreshold: settings.autoPromptThreshold || 15
  };
}

export async function saveSettings(newSettings) {
  const current = await getSettings();
  const updated = { ...current, ...newSettings };
  await chrome.storage.local.set({ settings: updated });
  return updated;
}

export async function getVaultItems() {
  const { vault = [] } = await chrome.storage.local.get("vault");
  return vault.sort((a, b) => (b.stashedAt || 0) - (a.stashedAt || 0));
}

export async function addToVault(item) {
  const vault = await getVaultItems();
  const newItem = {
    id: "vz_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
    url: item.url || "",
    title: item.title || "Untitled Tab",
    favIconUrl: item.favIconUrl || "",
    stashedAt: Date.now(),
    takeaway: item.takeaway || "",
    bullets: item.bullets || [],
    readTime: item.readTime || "3 min"
  };
  vault.unshift(newItem);
  await chrome.storage.local.set({ vault });
  return newItem;
}

export async function removeFromVault(itemId) {
  const vault = await getVaultItems();
  const filtered = vault.filter(i => i.id !== itemId);
  await chrome.storage.local.set({ vault: filtered });
  return filtered;
}

export function searchVault(items, query) {
  if (!query || !query.trim()) return items;
  const q = query.toLowerCase().trim();
  return items.filter(item => {
    const titleMatch = item.title?.toLowerCase().includes(q);
    const urlMatch = item.url?.toLowerCase().includes(q);
    const takeawayMatch = item.takeaway?.toLowerCase().includes(q);
    const bulletsMatch = item.bullets?.some(b => b.toLowerCase().includes(q));
    return titleMatch || urlMatch || takeawayMatch || bulletsMatch;
  });
}

export function generateMarkdown(items) {
  const dateStr = new Date().toISOString().split("T")[0];
  let md = `# TabZen Reading Vault Digest (${dateStr})\n\n`;
  md += `Exported ${items.length} saved reading articles.\n\n---\n\n`;

  for (const item of items) {
    const date = new Date(item.stashedAt).toLocaleDateString();
    md += `### [${item.title}](${item.url})\n`;
    md += `*Saved on ${date} • Read time: ${item.readTime || "Unknown"}*\n\n`;
    if (item.takeaway) {
      md += `> **TL;DR:** ${item.takeaway}\n\n`;
    }
    if (item.bullets && item.bullets.length > 0) {
      md += `**Key Highlights:**\n`;
      for (const bullet of item.bullets) {
        md += `- ${bullet}\n`;
      }
      md += `\n`;
    }
    md += `---\n\n`;
  }
  return md;
}
