// TabZen Gemini Pro & Flash AI Client (ES Module)
// Includes smart rate-limiting, LRU caching, request serialization, and 429 backoff

// 1. LRU Cache for AI Summaries (prevents duplicate API calls)
const summaryCache = new Map();
const MAX_CACHE_SIZE = 300;

function getCachedSummary(key) {
  if (!key) return null;
  return summaryCache.get(key) || null;
}

function setCachedSummary(key, data) {
  if (!key || !data) return;
  if (summaryCache.size >= MAX_CACHE_SIZE) {
    const oldest = summaryCache.keys().next().value;
    summaryCache.delete(oldest);
  }
  summaryCache.set(key, data);
}

// 2. Request Serializer & Pacer (ensures minimum 1.2s spacing to prevent rate limits)
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL_MS = 1200; // ~50 req/min max, safe for Google AI Studio tier
let requestQueuePromise = Promise.resolve();

function enqueueRateLimitedRequest(fn) {
  const task = requestQueuePromise.then(async () => {
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < MIN_REQUEST_INTERVAL_MS) {
      const wait = MIN_REQUEST_INTERVAL_MS - elapsed;
      await new Promise(r => setTimeout(r, wait));
    }
    lastRequestTime = Date.now();
    return await fn();
  });

  requestQueuePromise = task.catch(() => {});
  return task;
}

export async function fetchAvailableModels(apiKey) {
  if (!apiKey || !apiKey.trim()) return [];
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey.trim())}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.models || !Array.isArray(data.models)) return [];
    return data.models
      .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent"))
      .map(m => m.name.replace(/^models\//, ""));
  } catch (err) {
    console.warn("Failed to fetch available models:", err);
    return [];
  }
}

export function normalizeModelName(model) {
  if (!model) return "gemini-3.6-flash";
  const m = model.trim().toLowerCase();
  if (m.includes("2.5-flash") || m.includes("1.5-flash") || m.includes("2.0-flash")) {
    return "gemini-3.6-flash";
  }
  if (m === "gemini-3-pro" || m === "gemini-3-flash") {
    return m === "gemini-3-pro" ? "gemini-3.1-pro" : "gemini-3.6-flash";
  }
  if (m.includes("2.5-pro") || m.includes("1.5-pro")) {
    return "gemini-3.1-pro";
  }
  return model.trim();
}

export function getGeminiModelEndpoint(model = "gemini-3.6-flash") {
  const cleanModel = normalizeModelName(model);
  return `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent`;
}

/**
 * Direct call to Google Generative Language API with serialized pacing,
 * 404 auto-fallback, and 429 exponential backoff.
 */
export async function callGemini(apiKey, prompt, systemInstruction = "", responseMimeType = "text/plain", model = "gemini-3.6-flash", abortSignal = null) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error("Missing Gemini API key. Please configure your API key in TabZen Settings.");
  }

  return enqueueRateLimitedRequest(async () => {
    if (abortSignal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const cleanModel = normalizeModelName(model);
    const endpoint = getGeminiModelEndpoint(cleanModel);
    const url = `${endpoint}?key=${encodeURIComponent(apiKey.trim())}`;
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: responseMimeType
      }
    };

    if (systemInstruction) {
      payload.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    const doFetch = async (fetchUrl) => {
      return await fetch(fetchUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: abortSignal
      });
    };

    let response;
    let retries = 0;
    const maxRetries = 2;

    while (retries <= maxRetries) {
      if (abortSignal?.aborted) throw new DOMException("Aborted", "AbortError");

      response = await doFetch(url);

      // Handle 404 (Model not found in this API version)
      if (response.status === 404 && cleanModel !== "gemini-3.6-flash") {
        console.warn(`Model ${cleanModel} returned 404. Falling back to gemini-3.6-flash...`);
        const fallbackEndpoint = getGeminiModelEndpoint("gemini-3.6-flash");
        const fallbackUrl = `${fallbackEndpoint}?key=${encodeURIComponent(apiKey.trim())}`;
        response = await doFetch(fallbackUrl);
        break;
      }

      // Handle 429 Rate Limit with exponential backoff
      if (response.status === 429) {
        retries++;
        if (retries > maxRetries) {
          throw new Error("Gemini API rate limit reached. Waiting for quota cooldown...");
        }
        const backoffMs = retries * 2500;
        console.warn(`Rate limit (429) received. Cooldown for ${backoffMs}ms before retry ${retries}...`);
        await new Promise(r => setTimeout(r, backoffMs));
        continue;
      }

      break;
    }

    if (!response.ok) {
      const errorBody = await response.text();
      let message = `Gemini API error (${response.status})`;
      try {
        const parsed = JSON.parse(errorBody);
        if (parsed.error && parsed.error.message) {
          message = parsed.error.message;
        }
      } catch {}
      throw new Error(message);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error("No response content generated by Gemini.");
    }
    return text;
  });
}

/**
 * Cluster tabs into meaningful topic groups using Gemini
 * Ensures 100% of tabs are classified into cohesive groups.
 */
export async function clusterTabsWithAI(apiKey, tabs, model = "gemini-3.6-flash") {
  if (!tabs || tabs.length === 0) return [];

  if (!apiKey || !apiKey.trim()) {
    return clusterTabsHeuristic(tabs);
  }

  const systemInstruction = `You are an expert browser organizer.
You are given a JSON array of active browser tabs (id, title, url).
Your task is to organize EVERY SINGLE TAB into 2 to 8 logical, topical categories.

CRITICAL RULES:
1. EVERY input tabId MUST be included in exactly ONE group in the output. Do NOT omit any tab.
2. Group titles must be specific, descriptive, and professional (1 to 3 words, starting with a relevant emoji). Example: "🔬 AI & LLMs", "💻 Dev & GitHub", "📰 Tech Reads", "📊 Work & Planning".
3. NEVER use generic or lazy bucket names like "Misc", "Other", or "Assorted". Classify by content or domain.
4. "color" must be strictly one of: ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"].

Return STRICTLY a JSON object matching this schema:
{
  "groups": [
    {
      "name": "string",
      "color": "string",
      "tabIds": [number]
    }
  ]
}`;

  const tabsSummary = tabs.map(t => ({
    id: t.id,
    title: t.title,
    url: t.url
  }));

  const prompt = `Classify all ${tabs.length} tabs into coherent topic groups:\n${JSON.stringify(tabsSummary, null, 2)}`;

  try {
    const raw = await callGemini(apiKey, prompt, systemInstruction, "application/json", model);
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.groups) && parsed.groups.length > 0) {
      // Ensure 100% of tabs are accounted for
      const assignedIds = new Set(parsed.groups.flatMap(g => g.tabIds || []));
      const missingTabs = tabs.filter(t => !assignedIds.has(t.id));

      if (missingTabs.length > 0) {
        const fallbackGroups = clusterTabsHeuristic(missingTabs);
        for (const fg of fallbackGroups) {
          parsed.groups.push(fg);
        }
      }

      return parsed.groups;
    }
  } catch (err) {
    console.warn("AI clustering failed, falling back to heuristic:", err);
  }

  return clusterTabsHeuristic(tabs);
}

/**
 * Intelligent heuristic clustering with domain and category detection
 */
export function clusterTabsHeuristic(tabs) {
  const groups = [];
  const tabMap = new Map(tabs.map(t => [t.id, t]));
  const remaining = new Set(tabs.map(t => t.id));

  const rules = [
    {
      name: "💻 Dev & Engineering",
      color: "blue",
      match: (u, t) => u.includes("github.com") || u.includes("gitlab.com") || u.includes("stackoverflow.com") || u.includes("localhost") || t.includes("pull request") || t.includes("commit")
    },
    {
      name: "🔬 AI & Research",
      color: "purple",
      match: (u, t) => u.includes("arxiv.org") || u.includes("huggingface.co") || u.includes("openai.com") || u.includes("anthropic.com") || u.includes("deepmind") || t.includes("llm") || t.includes("machine learning")
    },
    {
      name: "📖 Documentation & Reference",
      color: "cyan",
      match: (u, t) => u.includes("docs.") || u.includes("/docs") || u.includes("developer.mozilla.org") || u.includes("wikipedia.org") || t.includes("documentation") || t.includes("api reference")
    },
    {
      name: "📰 Articles & Reading",
      color: "yellow",
      match: (u, t) => u.includes("medium.com") || u.includes("substack.com") || u.includes("news.ycombinator.com") || u.includes("dev.to") || u.includes("blog.") || u.includes("/blog")
    },
    {
      name: "🎬 Media & Video",
      color: "red",
      match: (u, t) => u.includes("youtube.com") || u.includes("netflix.com") || u.includes("spotify.com") || u.includes("twitch.tv") || u.includes("vimeo.com")
    },
    {
      name: "💬 Social & Community",
      color: "pink",
      match: (u, t) => u.includes("twitter.com") || u.includes("x.com") || u.includes("reddit.com") || u.includes("linkedin.com") || u.includes("discord.com")
    },
    {
      name: "🛒 Shopping & Commerce",
      color: "orange",
      match: (u, t) => u.includes("amazon.") || u.includes("ebay.") || u.includes("store.") || u.includes("shop.") || u.includes("cart")
    }
  ];

  for (const rule of rules) {
    const matched = [];
    for (const tabId of remaining) {
      const tab = tabMap.get(tabId);
      const urlLower = (tab.url || "").toLowerCase();
      const titleLower = (tab.title || "").toLowerCase();
      if (rule.match(urlLower, titleLower)) {
        matched.push(tabId);
      }
    }
    if (matched.length > 0) {
      groups.push({
        name: rule.name,
        color: rule.color,
        tabIds: matched
      });
      matched.forEach(id => remaining.delete(id));
    }
  }

  const domainBuckets = {};
  for (const tabId of remaining) {
    const tab = tabMap.get(tabId);
    let domain = "Browsing";
    try {
      const u = new URL(tab.url);
      domain = u.hostname.replace(/^www\./, "").split(".")[0];
      domain = domain.charAt(0).toUpperCase() + domain.slice(1);
    } catch {}

    if (!domainBuckets[domain]) domainBuckets[domain] = [];
    domainBuckets[domain].push(tabId);
  }

  const fallbackColors = ["green", "orange", "blue", "purple", "cyan"];
  let cIdx = 0;
  for (const [domain, tIds] of Object.entries(domainBuckets)) {
    groups.push({
      name: `🌐 ${domain}`,
      color: fallbackColors[cIdx % fallbackColors.length],
      tabIds: tIds
    });
    cIdx++;
  }

  return groups;
}

/**
 * Fast 2-sentence takeaway & reading time for Triage Card
 * Utilizes LRU caching to avoid repeating API calls for the same tab.
 */
export async function getTabTakeaway(apiKey, tabInfo, model = "gemini-3.6-flash", abortSignal = null) {
  if (!apiKey || !apiKey.trim()) {
    return {
      takeaway: tabInfo.description || `Reading material from ${tabInfo.url}. Configure Gemini API key for smart AI takeaways.`,
      readTime: "3 min"
    };
  }

  const cacheKey = `${model}:${tabInfo.url || tabInfo.title}`;
  const cached = getCachedSummary(cacheKey);
  if (cached) {
    return cached;
  }

  const systemInstruction = `You are a concise reading assistant.
Given a webpage title, url, description, and text snippet, output:
1. "takeaway": Exactly 1 or 2 crisp sentences summarizing the core idea or practical value. If snippet is empty (sleeping tab), infer from the title and URL slugs.
2. "readTime": Estimated reading time, e.g. "4 min".

Return STRICTLY JSON:
{
  "takeaway": "string",
  "readTime": "string"
}`;

  const prompt = `Title: ${tabInfo.title}\nURL: ${tabInfo.url}\nDescription: ${tabInfo.description || "N/A"}\nSnippet: ${(tabInfo.snippet || "").slice(0, 1500)}`;

  try {
    const raw = await callGemini(apiKey, prompt, systemInstruction, "application/json", model, abortSignal);
    const parsed = JSON.parse(raw);
    const result = {
      takeaway: parsed.takeaway || "Summary not available.",
      readTime: parsed.readTime || "3 min"
    };
    setCachedSummary(cacheKey, result);
    return result;
  } catch (err) {
    if (err.name === "AbortError") {
      throw err;
    }
    console.warn("Gemini takeaway generation failed:", err);
    return {
      takeaway: tabInfo.description || `Tab: ${tabInfo.title}`,
      readTime: "3 min"
    };
  }
}

/**
 * Deep 3-bullet summary when user clicks "⚡ Summarize & Close"
 */
export async function getDeepSummary(apiKey, tabInfo, model = "gemini-3.6-flash", abortSignal = null) {
  if (!apiKey || !apiKey.trim()) {
    return {
      takeaway: tabInfo.description || "Stashed article.",
      bullets: ["Saved without AI summary (no API key configured)."],
      readTime: "3 min"
    };
  }

  const cacheKey = `deep:${model}:${tabInfo.url || tabInfo.title}`;
  const cached = getCachedSummary(cacheKey);
  if (cached) {
    return cached;
  }

  const systemInstruction = `You are an executive researcher.
Provide a high-yield summary for the given webpage.
Output:
1. "takeaway": A 1-sentence high level conclusion.
2. "bullets": Exactly 3 detailed bullet points capturing key facts, insights, or takeaways.
3. "readTime": Estimated reading time.

Return STRICTLY JSON:
{
  "takeaway": "string",
  "bullets": ["bullet 1", "bullet 2", "bullet 3"],
  "readTime": "string"
}`;

  const prompt = `Title: ${tabInfo.title}\nURL: ${tabInfo.url}\nDescription: ${tabInfo.description || "N/A"}\nSnippet: ${(tabInfo.snippet || "").slice(0, 2500)}`;

  try {
    const raw = await callGemini(apiKey, prompt, systemInstruction, "application/json", model, abortSignal);
    const parsed = JSON.parse(raw);
    const result = {
      takeaway: parsed.takeaway || tabInfo.title,
      bullets: parsed.bullets || [],
      readTime: parsed.readTime || "3 min"
    };
    setCachedSummary(cacheKey, result);
    return result;
  } catch (err) {
    if (err.name === "AbortError") throw err;
    console.warn("Gemini deep summary failed:", err);
    return {
      takeaway: tabInfo.description || tabInfo.title,
      bullets: ["Key takeaways could not be retrieved from AI."],
      readTime: "3 min"
    };
  }
}
