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
    }
    else {
      try {
        const now = Date.now();
        const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

        // First, get the cache.
        const cache = await getCache();
        const serverCache = cache[location.hostname] || {};
        const entry = serverCache[username];

        if (entry && (now - entry.timestamp < SEVEN_DAYS)) {
          // Use the cached display name.
          displayNames[username] = entry.displayName;
        } else {
          // Request the name from the background worker (this ensures we only request at most one request per user).
          await chrome.runtime.sendMessage({
            type: "fetchDisplayName",
            origin: location.hostname,
            username: username
          });
          const cache = await getCache();
          const serverCache = cache[location.hostname] || {};
          const entry = serverCache[username];
          displayNames[username] = entry ? entry.displayName : username;
        }

        updateElements(username);
      } catch (err) {
        console.error("Error fetching display name for @" + username, err);
        displayNames[username] = username; // fallback so that we don't keep retrying
        updateElements(username);
      }
    }
  }

  // ------------------------------
  // DOM Processing Functions
  // ------------------------------

  // Process anchor tags whose text is exactly "@username".
  function processAnchorsByText(root) {
    const anchors = root.querySelectorAll("a");
    anchors.forEach((anchor) => {
      // Trim and check if the text matches "@username" exactly.
      const text = anchor.textContent.trim();
      const match = text.match(/^@([a-zA-Z0-9_-]+)$/);
      if (match) {
        const username = match[1];
        // If we already have the display name, update immediately.
        if (displayNames[username]) {
          updateTextNodes(anchor, username, displayNames[username]);
        } else {
          // When the display name is ready, replace the text.
          registerElement(username, (displayName) => {
            updateTextNodes(anchor, username, displayName);
          });
          fetchDisplayName(username);
        }
      }
    });
  }

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
      const match = hover.match(/^\/users\/([^\/?]+)/);
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

  // Process both types of elements in the provided root.
  function processAll(root) {
    processAnchorsByText(root);
    processAnchorsByHovercard(root);
  }

  // ------------------------------
  // Initial Processing & MutationObserver
  // ------------------------------

  // Process the current document.
  processAll(document.body);

  // Set up a MutationObserver to process newly added elements.
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          processAll(node);
        }
      });
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
})();
