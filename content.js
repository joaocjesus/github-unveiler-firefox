(() => {
  // ------------------------------
  // Global Variables & Cache Setup
  // ------------------------------
  const CACHE_KEY = "githubDisplayNameCache";
  const displayNames = {};    // username => fetched display name
  const elementsByUsername = {}; // username => array of update callbacks

  // Helper: Get the cache from chrome.storage.local.
  function getCache() {
    return new Promise((resolve) => {
      chrome.storage.local.get([CACHE_KEY], (result) => {
        resolve(result[CACHE_KEY] || {});
      });
    });
  }

  // Register an update callback for an element associated with a username.
  // When we have the display name, the callback will be invoked.
  function registerElement(username, updateCallback) {
    if (!elementsByUsername[username]) {
      elementsByUsername[username] = [];
    }
    elementsByUsername[username].push(updateCallback);
  }

  // Call all registered callbacks for a username.
  function updateElements(username) {
    if (!elementsByUsername[username]) return;
    const name = displayNames[username] || username; // fallback is the username
    elementsByUsername[username].forEach((cb) => {
      try {
        cb(name);
      } catch (e) {
        console.error("Error updating element for @" + username, e);
      }
    });
  }

  /**
   * Replaces all occurrences of the username (with an optional "@" prefix) in the text nodes
   * under the given element with the provided displayName.
   */
  function updateTextNodes(element, username, displayName) {
    // Escape the username for use in a regex.
    const escapedUsername = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Create a regex that matches either "username" or "@username" as a whole word.
    const regex = new RegExp("\\b@?" + escapedUsername + "\\b", "g");
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while ((node = walker.nextNode())) {
      if (regex.test(node.textContent)) {
        node.textContent = node.textContent.replace(regex, displayName);
      }
    }
  }

  // ------------------------------
  // Fetching & Caching Display Names
  // ------------------------------
  async function fetchDisplayName(username) {
    // Only look up in cache if not already present in displayNames
    if (displayNames[username]) {
      updateElements(username);
      return;
    }
    try {
      const now = Date.now();
      const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

      // Check cache first.
      let cache = await getCache();
      const serverCache = cache[location.hostname] || {};
      let entry = serverCache[username];

      if (entry && (now - entry.timestamp < SEVEN_DAYS)) {
        displayNames[username] = entry.displayName;
        updateElements(username);
        return;
      }

      // Request the lock from the background service.
      const lockResponse = await chrome.runtime.sendMessage({
        type: "acquireLock",
        origin: location.hostname,
        username: username
      });

      if (lockResponse.acquired) {
        // We have the lock—fetch the GitHub profile page.
        const profileUrl = `https://${location.hostname}/${username}`;
        const response = await fetch(profileUrl);
        if (!response.ok) {
          throw new Error("HTTP error " + response.status);
        }
        const html = await response.text();

        // Parse the HTML using a DOMParser.
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const el = doc.querySelector('.vcard-fullname');
        let displayName = el ? el.textContent.trim() : username;

        // Tell the background to update the cache and release the lock.
        await chrome.runtime.sendMessage({
          type: "releaseLock",
          origin: location.hostname,
          username: username,
          displayName: displayName
        });

        displayNames[username] = displayName;
        updateElements(username);
      } else {
        // Another content script is already fetching this profile.
        // Poll until the cache is updated.
        const maxAttempts = 10;
        let attempt = 0;
        const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        while (attempt < maxAttempts) {
          await wait(500);
          let cache = await getCache();
          const serverCache = cache[location.hostname] || {};
          let entry = serverCache[username];
          if (entry && (Date.now() - entry.timestamp < SEVEN_DAYS)) {
            displayNames[username] = entry.displayName;
            updateElements(username);
            return;
          }
          attempt++;
        }
        // Fallback if we still haven't received a display name.
        displayNames[username] = username;
        updateElements(username);
      }
    } catch (err) {
      console.error("Error fetching display name for @" + username, err);
      displayNames[username] = username;
      updateElements(username);
    }
  }

  // ------------------------------
  // DOM Processing Functions
  // ------------------------------

  /**
   * Processes anchor tags that have a data-hovercard-url starting with "/users/".
   * For each such anchor:
   * - If its content is solely a <span class="AppHeader-context-item-label">, skip it.
   * - Otherwise, register a callback so that once the display name is available, every text node within the anchor
   *   that contains the username (or "@username") is updated to the display name.
   */
  function processAnchorsByHovercard(root) {
    // Select anchor tags with a data-hovercard-url attribute starting with "/users/"
    const anchors = root.querySelectorAll('a[data-hovercard-url^="/users/"]');
    anchors.forEach((anchor) => {
      // Exception: if the anchor's entire content is a single span with the specified class and text, skip processing.
      if (anchor.children.length === 1) {
        const child = anchor.children[0];
        if (
          child.tagName === "SPAN" &&
          child.classList.contains("AppHeader-context-item-label")
        ) {
          return;
        }
      }

      // Extract the username from the data-hovercard-url.
      const hover = anchor.getAttribute("data-hovercard-url");
      const match = hover.match(/^\/users\/((?!.*%5Bbot%5D)[^\/?]+)/);
      if (!match) return;
      const username = match[1];

      // Register a callback to update the anchor's descendant text nodes once the display name is available.
      registerElement(username, (displayName) => {
        updateTextNodes(anchor, username, displayName);
      });

      // If the display name is already available, update immediately; otherwise, fetch it.
      if (displayNames[username]) {
        updateTextNodes(anchor, username, displayNames[username]);
      } else {
        fetchDisplayName(username);
      }
    });
  }

  // Initial processing.
  processAnchorsByHovercard(document.body);

  // Set up a MutationObserver to handle new elements.
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          processAnchorsByHovercard(node);
        }
      });
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
})();
