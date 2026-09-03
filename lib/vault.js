// TabZen Vault & Storage Library (ES Module)

import { normalizeModelName, DEFAULT_MODEL } from "./gemini.js";

// Maximum stored vault items: chrome.storage.local quota is ~5-10 MB,
// so evict oldest instead of failing writes once full.
export const MAX_VAULT_ITEMS = 500;

export async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  let model = settings.model || DEFAULT_MODEL;
  const normalized = normalizeModelName(model);
  if (normalized !== model) {
    model = normalized;
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
  const bullets = Array.isArray(item.bullets)
    ? item.bullets.map(b => String(b ?? "").slice(0, 500)).filter(Boolean)
    : [];
  const newItem = {
    id: "vz_" + Date.now() + "_" + (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).substring(2, 10)),
    url: item.url || "",
    title: String(item.title || "Untitled Tab").slice(0, 300),
    favIconUrl: item.favIconUrl || "",
    stashedAt: Date.now(),
    takeaway: String(item.takeaway || "").slice(0, 1000),
    bullets,
    readTime: String(item.readTime || "3 min").slice(0, 24)
  };
  vault.unshift(newItem);
  if (vault.length > MAX_VAULT_ITEMS) {
    vault.length = MAX_VAULT_ITEMS;
  }
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
    const bulletsMatch = item.bullets?.some(b => String(b ?? "").toLowerCase().includes(q));
    return titleMatch || urlMatch || takeawayMatch || bulletsMatch;
  });
}

export function generateMarkdown(items) {
  const dateStr = new Date().toISOString().split("T")[0];
  let md = `# TabZen Reading Vault Digest (${dateStr})\n\n`;
  md += `Exported ${items.length} saved reading articles.\n\n---\n\n`;

  for (const item of items) {
    const date = new Date(item.stashedAt).toLocaleDateString();
    const safeTitle = String(item.title).replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
    md += `### [${safeTitle}](${item.url})\n`;
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
