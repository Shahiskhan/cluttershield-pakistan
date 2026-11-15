importScripts("config.js");

const STORAGE_KEY = "threatFeedState";
const MAX_FEED_BYTES = 8 * 1024 * 1024;
const MAX_ITEMS = 50_000;
const MAX_FEED_VALIDITY_MS = 24 * 60 * 60_000;

function canonicalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("invalid_feed");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value !== "object") throw new Error("invalid_feed");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function fromBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toHex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function signedPayload(feed) {
  return {
    schema_version: feed.schema_version,
    feed_version: feed.feed_version,
    generated_at: feed.generated_at,
    valid_until: feed.valid_until,
    key_id: feed.key_id,
    algorithm: feed.algorithm,
    metadata: feed.metadata,
    items: feed.items,
  };
}

async function verifyFeed(feed, currentVersion, allowExpired = false) {
  if (!feed || feed.schema_version !== 1 || !Number.isSafeInteger(feed.feed_version) ||
    feed.feed_version <= currentVersion || feed.algorithm !== "Ed25519" ||
    typeof feed.key_id !== "string" || !feed.metadata || typeof feed.metadata !== "object" ||
    !Array.isArray(feed.items) || feed.items.length > MAX_ITEMS ||
    typeof feed.generated_at !== "string" || typeof feed.valid_until !== "string" ||
    typeof feed.payload_sha256 !== "string" || typeof feed.signature !== "string") throw new Error("invalid_feed");

  const generated = Date.parse(feed.generated_at);
  const expires = Date.parse(feed.valid_until);
  const now = Date.now();
  if (!Number.isFinite(generated) || !Number.isFinite(expires) || generated > now + 10 * 60_000 ||
    (!allowExpired && expires <= now) || expires <= generated || expires - generated > MAX_FEED_VALIDITY_MS) {
    throw new Error("expired_or_invalid_feed");
  }
  const keyText = self.CLUTTERSHIELD_CONFIG.verificationKeys[feed.key_id];
  if (!keyText) throw new Error("unknown_signing_key");
  const publicKey = fromBase64(keyText);
  if (publicKey.byteLength !== 32) throw new Error("invalid_signing_key");

  const payloadBytes = new TextEncoder().encode(canonicalize(signedPayload(feed)));
  const digest = await crypto.subtle.digest("SHA-256", payloadBytes);
  if (toHex(digest) !== feed.payload_sha256.toLowerCase()) throw new Error("feed_hash_mismatch");
  const key = await crypto.subtle.importKey("raw", publicKey, { name: "Ed25519" }, false, ["verify"]);
  const validSignature = await crypto.subtle.verify({ name: "Ed25519" }, key, fromBase64(feed.signature), payloadBytes);
  if (!validSignature) throw new Error("feed_signature_invalid");

  for (const item of feed.items) {
    if (!item || !["domain", "url", "phone"].includes(item.type) || !["exact", "host", "path"].includes(item.scope) ||
      typeof item.match_value !== "string" || item.match_value.length > 2048 ||
      typeof item.advisory !== "string" || item.advisory.length > 500) {
      throw new Error("invalid_feed_item");
    }
  }
  return { ...feed, received_at: new Date().toISOString() };
}

async function getStoredState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const state = stored[STORAGE_KEY] ?? { feed: null, lastError: "not_configured" };
  if (!state.feed) return state;
  try {
    await verifyFeed(state.feed, state.feed.feed_version - 1, true);
    return state;
  } catch {
    return { ...state, feed: null, lastError: "stored_feed_invalid" };
  }
}

async function updateFeed() {
  const config = self.CLUTTERSHIELD_CONFIG;
  if (!config.feedUrl || Object.keys(config.verificationKeys).length === 0) {
    const old = await getStoredState();
    await chrome.storage.local.set({ [STORAGE_KEY]: { ...old, lastError: "not_configured", checked_at: new Date().toISOString() } });
    return;
  }
  const old = await getStoredState();
  const currentVersion = old.feed?.feed_version ?? -1;
  try {
    const response = await fetch(config.feedUrl, {
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      headers: config.publishableKey ? { apikey: config.publishableKey } : {},
    });
    if (!response.ok) throw new Error("feed_unavailable");
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_FEED_BYTES) throw new Error("feed_too_large");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_FEED_BYTES) throw new Error("feed_too_large");
    const feed = await verifyFeed(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), currentVersion);
    await chrome.storage.local.set({ [STORAGE_KEY]: { feed, lastError: null, checked_at: new Date().toISOString() } });
  } catch (error) {
    await chrome.storage.local.set({ [STORAGE_KEY]: {
      ...old,
      lastError: error instanceof Error ? error.message : "feed_unavailable",
      checked_at: new Date().toISOString(),
    } });
  }
}

function normalizeUrl(value) {
  if (typeof value !== "string" || value.length > 4096) throw new Error("Enter a valid HTTP or HTTPS address.");
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error("Enter a valid HTTP or HTTPS address."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname) {
    throw new Error("Only public HTTP and HTTPS addresses can be checked.");
  }
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  url.hash = "";
  const host = url.hostname;
  url.search = "";
  const exactUrl = `${url.origin}${url.pathname}`;
  return { host, exactUrl };
}

function normalizePhone(value) {
  if (typeof value !== "string" || value.length > 64) return null;
  let phone = value.trim().replace(/[\s().-]/g, "");
  if (/^0\d{10}$/.test(phone)) phone = "+92" + phone.slice(1);
  else if (/^3\d{9}$/.test(phone)) phone = "+92" + phone;
  else if (/^92\d{10}$/.test(phone)) phone = "+" + phone;
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

function confidenceLabel(value) {
  if (typeof value === "string" && ["low", "medium", "high"].includes(value.toLowerCase())) return value.toLowerCase();
  return "under review";
}

async function checkUserInput(value) {
  const phone = normalizePhone(value);
  const candidate = phone ? null : normalizeUrl(value);
  const state = await getStoredState();
  const feed = state.feed;
  if (!feed) return { match: null, protection: "unavailable", message: "No verified threat feed is installed yet." };
  const ageMs = Date.now() - Date.parse(feed.valid_until);
  const maxAgeMs = self.CLUTTERSHIELD_CONFIG.maxStaleHours * 60 * 60_000;
  if (ageMs > maxAgeMs) return { match: null, protection: "degraded", message: "The saved feed is too old for a reliable check." };
  const match = feed.items.find((item) => {
    if (item.type === "phone") return Boolean(phone) && phone === item.match_value;
    if (phone || !candidate) return false;
    const value = item.match_value.toLowerCase().replace(/\.$/, "");
    if (item.type === "domain") return candidate.host === value || (item.scope === "host" && candidate.host.endsWith("." + value));
    if (item.type === "url" && item.scope === "host") return candidate.host === new URL(value).hostname.toLowerCase();
    if (item.type === "url" && item.scope === "path") {
      return candidate.exactUrl === value || (candidate.exactUrl.startsWith(value) && candidate.exactUrl.charAt(value.length) === "/");
    }
    if (item.type === "url") return candidate.exactUrl === value;
    return false;
  });
  if (!match) return {
    match: null,
    protection: ageMs > 0 ? "stale" : "current",
    message: ageMs > 0 ? "No match in the last-known feed. This feed has expired." : "No match in the current verified feed. New scams may not be listed yet.",
  };
  return {
    match: {
      riskCategory: typeof match.risk_category === "string" ? match.risk_category : "risk signal",
      confidence: confidenceLabel(match.confidence_band),
      lastReviewedAt: typeof match.last_reviewed_at === "string" ? match.last_reviewed_at : null,
      advisory: match.advisory,
    },
    protection: ageMs > 0 ? "stale" : "current",
    message: "This destination matches a reviewed risk indicator. Leave if you are unsure.",
  };
}

function getStatus() {
  return getStoredState().then((state) => {
    const feed = state.feed;
    if (!feed) return { protection: "unavailable", feedVersion: null, lastChecked: state.checked_at ?? null };
    const stale = Date.now() > Date.parse(feed.valid_until);
    const tooOld = Date.now() - Date.parse(feed.valid_until) > self.CLUTTERSHIELD_CONFIG.maxStaleHours * 60 * 60_000;
    return {
      protection: tooOld ? "degraded" : stale ? "stale" : "current",
      feedVersion: feed.feed_version,
      validUntil: feed.valid_until,
      lastChecked: state.checked_at ?? null,
    };
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("threat-feed-refresh", { periodInMinutes: self.CLUTTERSHIELD_CONFIG.refreshMinutes });
  void updateFeed();
});
chrome.runtime.onStartup.addListener(() => void updateFeed());
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "threat-feed-refresh") void updateFeed(); });

let navigationListenerInstalled = false;
async function installNavigationProtection() {
  if (navigationListenerInstalled || !chrome.webNavigation || !chrome.tabs) return;
  const allowed = await chrome.permissions.contains({
    permissions: ["webNavigation", "tabs"],
    origins: ["http://*/*", "https://*/*"],
  });
  if (!allowed || navigationListenerInstalled) return;
  navigationListenerInstalled = true;
  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId !== 0 || details.tabId < 0 || !/^https?:/i.test(details.url)) return;
    checkUserInput(details.url).then((result) => {
      if (!result?.match) return;
      const warningUrl = chrome.runtime.getURL("warning.html");
      void chrome.tabs.update(details.tabId, { url: warningUrl });
    }).catch(() => undefined);
  });
}
void installNavigationProtection();
chrome.permissions.onAdded.addListener(() => void installNavigationProtection());

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CHECK_USER_URL") {
    checkUserInput(message.value).then(sendResponse).catch(() => sendResponse({ error: "invalid_input", protection: "unavailable" }));
    return true;
  }
  if (message?.type === "GET_FEED_STATUS") {
    getStatus().then(sendResponse).catch(() => sendResponse({ protection: "unavailable" }));
    return true;
  }
  if (message?.type === "REFRESH_FEED") {
    updateFeed().then(getStatus).then(sendResponse).catch(() => sendResponse({ protection: "unavailable" }));
    return true;
  }
  if (message?.type === "GET_NAVIGATION_PROTECTION") {
    chrome.permissions.contains({ permissions: ["webNavigation", "tabs"], origins: ["http://*/*", "https://*/*"] })
      .then((enabled) => sendResponse({ enabled }));
    return true;
  }
  return false;
});
