const CACHE_KEY = "githubDisplayNameCache";
let nameLocks = {};  // key: origin+username, value: true if a fetch is in progress
let cacheLock = Promise.resolve();
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES_PER_ORIGIN = 1000; // Soft cap to prevent unbounded growth

// Clear cache: remove entries older than 7 days.
async function clearOldCacheEntries() {
  const now = Date.now();
  const cache = await getCache();
  let updated = false;
  for (const origin in cache) {
    const serverCache = cache[origin];
    for (const username in serverCache) {
      const entry = serverCache[username];
      if (!entry.noExpire && (now - entry.timestamp > SEVEN_DAYS)) {
        delete serverCache[username];
        updated = true;
      } else {
        // Entry is being kept, check its displayName
        if (!entry.displayName || entry.displayName.trim() === '') {
          entry.displayName = username; // Reset to username
          updated = true; // Mark cache as updated
        }
      }
    }
    // Remove origin if its cache is empty.
    if (Object.keys(serverCache).length === 0) {
      delete cache[origin];
      updated = true;
    }
  }
  if (updated) {
    await setCache(cache);
    console.log("Cleared old cache entries");
  }
}

// Invoke cache clearing when the background script loads.
clearOldCacheEntries().catch((err) => {
  console.error("Error clearing old cache entries:", err);
});

// --- Browser Action & Content Script Injection ---

// Prefer browserAction (supported in MV2 Firefox); fall back to chrome.action if present.
const actionAPI = (chrome.browserAction && chrome.browserAction.onClicked) ? chrome.browserAction : (chrome.action && chrome.action.onClicked ? chrome.action : null);
if (actionAPI && actionAPI.onClicked) {
  actionAPI.onClicked.addListener((tab) => {
    console.log("[GHU] Action clicked");
    if (!tab || !tab.url) {
      console.error("No URL found for the active tab.");
      return;
    }

    let url;
    try {
      url = new URL(tab.url);
    } catch (e) {
      console.error("Invalid URL:", tab.url);
      return;
    }

    const originPattern = `${url.protocol}//${url.hostname}/*`;
    console.log("Requesting permission for", originPattern);

    // If permissions API missing OR activeTab should suffice, attempt direct injection.
    if (!chrome.permissions || !chrome.permissions.request) {
      console.log("permissions.request unavailable – using activeTab fallback for", originPattern);
      loadContentScript(tab.id);
      return;
    }

    try {
      chrome.permissions.request({ origins: [originPattern] }, (granted) => {
        if (chrome.runtime.lastError) {
          console.warn("permissions.request error, falling back to activeTab:", chrome.runtime.lastError.message);
          loadContentScript(tab.id);
          return;
        }
        if (granted) {
          console.log("Permission granted for", originPattern);
          loadContentScript(tab.id);
        } else {
          // Respect denial by not persisting, but still allow one-off via activeTab.
          console.log("Permission denied for", originPattern);
          loadContentScript(tab.id);
        }
      });
    } catch (err) {
      console.warn("permissions.request threw exception, fallback to activeTab:", err);
      loadContentScript(tab.id);
    }
  });
} else {
  console.error("No action or browserAction API available; cannot attach click handler.");
}

// Listen for tab updates and auto-enable where permission is already granted.
if (chrome.tabs && chrome.tabs.onUpdated && chrome.tabs.onUpdated.addListener) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete" || !tab || !tab.url) return;

    let url;
    try { url = new URL(tab.url); } catch { return; }
    const originPattern = `${url.protocol}//${url.hostname}/*`;

    // If permissions API is missing, skip auto behavior.
    if (!chrome.permissions || !chrome.permissions.contains) {
      return;
    }

    chrome.permissions.contains({ origins: [originPattern] }, (hasPermission) => {
      if (hasPermission) {
        console.log("Auto-enabled for", originPattern);
        loadContentScript(tabId);
      } else {
        console.log("No permission for", originPattern, "; content script not loaded.");
      }
    });
  });
}

function loadContentScript(tabId) {
  // MV3 path (Chrome / future Firefox)
  if (chrome.scripting && chrome.scripting.executeScript) {
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ["content.js"]
    }, () => {
      if (chrome.runtime.lastError) {
        console.error("Content script load failed:", chrome.runtime.lastError);
      } else {
        console.log("Content script loaded into tab", tabId);
      }
    });
    return;
  }
  // MV2 fallback (Firefox when service workers disabled)
  if (chrome.tabs && chrome.tabs.executeScript) {
    chrome.tabs.executeScript(tabId, { file: "content.js" }, () => {
      if (chrome.runtime.lastError) {
        console.error("Content script load failed (tabs.executeScript):", chrome.runtime.lastError);
      } else {
        console.log("Content script loaded (MV2 fallback) into tab", tabId);
      }
    });
    return;
  }
  console.error("No supported script injection API available.");
}

// --- Lock Manager & Cache Update ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "acquireLock") {
    // Only one fetch per origin+username.
    const key = message.origin + message.username;
    if (!nameLocks[key]) {
      nameLocks[key] = true;
      sendResponse({ acquired: true });
    } else {
      sendResponse({ acquired: false });
    }
  } else if (message.type === "releaseLock") {
    updateCache(message.origin, message.username, message.displayName)
      .then(() => {
        const key = message.origin + message.username;
        delete nameLocks[key];
        sendResponse({ success: true });
      })
      .catch((err) => {
        console.error("Error updating cache:", err);
        sendResponse({ success: false, error: err.toString() });
      });
    // Indicate that we'll send a response asynchronously.
    return true;
  } else if (message.type === "openOptionsPage") {
    chrome.tabs.create({ url: chrome.runtime.getURL(message.url) });
    sendResponse({ success: true });
  }
});

// Helper: Get the cache from chrome.storage.local.
function getCache() {
  return new Promise((resolve) => {
    chrome.storage.local.get([CACHE_KEY], (result) => {
      resolve(result[CACHE_KEY] || {});
    });
  });
}

// Helper: Update the cache in chrome.storage.local.
function setCache(cache) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [CACHE_KEY]: cache }, () => {
      resolve();
    });
  });
}

async function updateCache(origin, username, displayName) {
  cacheLock = cacheLock.then(async () => {
    const cache = await getCache();
    const serverCache = cache[origin] || {};
    const existingEntry = serverCache[username];
    let noExpireValue = false;
    if (existingEntry && existingEntry.noExpire === true) {
      noExpireValue = true;
    }
    serverCache[username] = { displayName, timestamp: Date.now(), noExpire: noExpireValue };

    // If cache exceeds cap, evict oldest non noExpire entries.
    const keys = Object.keys(serverCache);
    if (keys.length > MAX_CACHE_ENTRIES_PER_ORIGIN) {
      const evictionCandidates = keys
        .map(k => ({ k, ts: serverCache[k].timestamp, noExpire: serverCache[k].noExpire }))
        .filter(e => !e.noExpire)
        .sort((a, b) => a.ts - b.ts); // oldest first
      const overBy = keys.length - MAX_CACHE_ENTRIES_PER_ORIGIN;
      let removed = 0;
      for (const cand of evictionCandidates) {
        if (removed >= overBy) break;
        delete serverCache[cand.k];
        removed++;
      }
      if (removed > 0) {
        console.log(`Evicted ${removed} old cache entries for origin ${origin}`);
      }
    }
    cache[origin] = serverCache;
    await setCache(cache);
  }).catch((err) => {
    console.error("Error updating cache:", err);
  });
  return cacheLock;
}
