// background.js

// Listen for clicks on the extension's browser action icon to request permission.
chrome.action.onClicked.addListener((tab) => {
  if (!tab.url) {
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

  if (url.hostname.toLowerCase().includes("github")) {
    const originPattern = `${url.protocol}//${url.hostname}/*`;
    console.log("Requesting permission for", originPattern);

    // Request permission as part of a user gesture.
    chrome.permissions.request({ origins: [originPattern] }, (granted) => {
      if (granted) {
        console.log("Permission granted for", originPattern);
        injectContentScript(tab.id);
      } else {
        console.log("Permission denied for", originPattern);
      }
    });
  } else {
    console.log("This tab is not a GitHub page.");
  }
});

// Listen for tab updates to auto-inject the content script when permission is already granted.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only proceed when the tab is fully loaded.
  if (changeInfo.status === "complete" && tab.url) {
    let url;
    try {
      url = new URL(tab.url);
    } catch (e) {
      return;
    }

    // Check if the URL's hostname contains "github"
    if (url.hostname.toLowerCase().includes("github")) {
      const originPattern = `${url.protocol}//${url.hostname}/*`;
      chrome.permissions.contains({ origins: [originPattern] }, (hasPermission) => {
        if (hasPermission) {
          console.log("Auto injecting content script for", originPattern);
          injectContentScript(tabId);
        } else {
          console.log("No permission for", originPattern, "; content script not injected.");
        }
      });
    }
  }
});

// Helper function to inject the content script.
function injectContentScript(tabId) {
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    files: ["content.js"]
  }, () => {
    if (chrome.runtime.lastError) {
      console.error("Script injection failed:", chrome.runtime.lastError);
    } else {
      console.log("Content script injected into tab", tabId);
    }
  });
}

// Listen for messages to update the cache
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "fetchDisplayName") {
    fetchDisplayName(message.origin, message.username)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.toString() }));
    // Return true to indicate asynchronous response.
    return true;
  }
});

const CACHE_KEY = "githubDisplayNameCache";

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

let nameLocks = {}

// Assume nameLocks, getCache, and updateCache are defined elsewhere.

async function fetchDisplayName(origin, username) {
  // Avoid duplicate fetches with a lock per origin + username.
  const key = origin + username;
  if (!nameLocks[key]) nameLocks[key] = Promise.resolve();

  nameLocks[key] = nameLocks[key].then(async () => {
    try {
      // See if another instance already grabbed the display name.
      const cache = await getCache();
      const serverCache = cache[origin] || {};
      if (!serverCache[username]) {
        // Fetch and parse the user profile.
        const profileUrl = "https://" + origin + "/" + username;
        const response = await fetch(profileUrl);
        if (!response.ok) {
          throw new Error("HTTP error " + response.status);
        }
        const html = await response.text();

        // Ensure that an offscreen document exists for DOM parsing.
        await ensureOffscreenDocument();

        // Use the offscreen document to extract the display name.
        const displayName = await parseDisplayNameOffscreen(html, username);

        // Now update the cache.
        await updateCache(origin, username, displayName);
      }
    } catch (err) {
      console.error("Error fetching display name for @" + username, err);
    }
  }).catch((err) => {
    console.error("Error updating cache:", err);
  });
  return nameLocks[key];
}

// Creates an offscreen document if one does not already exist.
async function ensureOffscreenDocument() {
  const exists = await chrome.offscreen.hasDocument();
  if (!exists) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html', // This is your offscreen HTML file.
      reasons: ['DOM_PARSER'], // Reason for creating an offscreen document.
      justification: 'Needed to parse HTML for display name extraction.'
    });
  }
}

// Sends the HTML to the offscreen document and awaits the parsed display name.
function parseDisplayNameOffscreen(html, username) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: "parseDisplayName", html, username },
      (response) => {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError);
        }
        if (response.error) {
          return reject(response.error);
        }
        resolve(response.displayName);
      }
    );
  });
}


let cacheLock = Promise.resolve();

// Helper function to write to the cache
async function updateCache(origin, username, displayName) {
  cacheLock = cacheLock.then(async () => {
    const cache = await getCache(); // Your getCache function
    const serverCache = cache[origin] || {};
    serverCache[username] = { displayName: displayName, timestamp: Date.now() };
    cache[origin] = serverCache;
    await setCache(cache); // Your setCache function
  }).catch((err) => {
    console.error("Error updating cache:", err);
  });
  return cacheLock;
}
