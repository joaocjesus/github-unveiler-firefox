(() => {
  // ------------------------------
  // Global Variables & Cache Setup
  // ------------------------------
  const PROCESSED_MARKER = 'data-ghu-processed';
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

  /**
   * Call all registered callbacks for a username once, then clear them out.
   */
  function updateElements(username) {
    const callbacks = elementsByUsername[username];
    if (!callbacks) return;

    const name = displayNames[username] || username;
    // Ensure we only run each callback a single time
    delete elementsByUsername[username];

    callbacks.forEach((cb) => {
      try {
        cb(name);
      } catch (e) {
        console.error("Error updating element for @" + username, e);
      }
    });
  }

  /**
   * Walk all text nodes under `element`, replace @username or username tokens
   * with the displayName—but skip any node that already contains the full displayName.
   */
  function updateTextNodes(element, username, displayName) {
    // Escape special regex chars in the username
    const escapedUsername = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Match standalone @username or username (doesn't run inside other words)
    const regex = new RegExp(`(?<!\\w)@?${escapedUsername}(?!\\w)`, "g");

    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );
    let node;
    let changed = false;
    while ((node = walker.nextNode())) {
      // If we've already inserted the full displayName here, skip it
      if (node.textContent.includes(displayName)) {
        // If the display name is already present, we assume it's fully correct.
        // This is simpler and might be more robust for cases like TBBle.
        // However, this means if a username token still exists that *should* be replaced,
        // and the displayName is also part of another text node, it might be skipped.
        // The PROCESSED_MARKER should ideally prevent re-entry for the whole element.
        // This change makes updateTextNodes itself more idempotent if called multiple times
        // on the same text that already contains the final display name.
        continue;
      }

      const updated = node.textContent.replace(regex, (match) =>
        match.startsWith("@") ? `@${displayName}` : displayName
      );
      if (updated !== node.textContent) {
        node.textContent = updated;
        changed = true;
      }
    }
    return changed;
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
      let cache = await getCache();
      const serverCache = cache[location.hostname] || {};
      let entry = serverCache[username];

      if (entry) {
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
          if (entry) {
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

// Function to update the element directly
function updateElementDirectly(element, username, displayName) {
  let changed = false;
  if (element.tagName === 'H3' && element.classList.contains('slicer-items-module__title--EMqA1')) {
    // updateTextNodes returns true if it made a change
    changed = updateTextNodes(element, username, displayName);
  } else if (element.tagName === 'IMG' && element.dataset.testid === 'github-avatar') {
    if (element.alt === displayName) return false; // Already updated
    element.alt = displayName;
    changed = true;
  } else if (element.tagName === 'SPAN' && element.hasAttribute('aria-label')) {
    if (element.getAttribute('aria-label') === displayName) return false; // Already updated
    element.setAttribute('aria-label', displayName);
    changed = true;
  }
  return changed;
}

// Function to process project elements
function processProjectElements(root) {
  if (!(root instanceof Element)) return; // Ensure root is an Element

  const h3Selector = 'h3.slicer-items-module__title--EMqA1';
  const imgSelector = 'img[data-testid="github-avatar"][alt]';
  const spanSelector = 'span[aria-label]';

  let elementsToProcess = [];

  // Check if root itself matches any of the selectors
  if (root.matches(h3Selector) || root.matches(imgSelector) || root.matches(spanSelector)) {
    elementsToProcess.push(root);
  }

  // Add descendants
  elementsToProcess.push(...Array.from(root.querySelectorAll(`${h3Selector}, ${imgSelector}, ${spanSelector}`)));

  // Deduplication is not strictly necessary due to PROCESSED_MARKER, but can be done with a Set if preferred for cleanliness.
  // elementsToProcess = Array.from(new Set(elementsToProcess));

  elementsToProcess.forEach(element => {
    if (element.hasAttribute(PROCESSED_MARKER)) return;
    let username;
    if (element.matches(h3Selector)) {
      username = element.textContent.trim();
    } else if (element.matches(imgSelector)) {
      username = element.alt.trim();
      // Remove "@" prefix if present in alt attribute
      if (username.startsWith('@')) {
        username = username.substring(1);
      }
    } else if (element.matches(spanSelector)) {
      username = element.getAttribute('aria-label').trim();
    }

    // Ignore invalid usernames
    if (!username || username === "No Assignees" || username === "") {
      return;
    }

    if (displayNames[username]) {
      const updated = updateElementDirectly(element, username, displayNames[username]);
      if (updated) {
        element.setAttribute(PROCESSED_MARKER, 'true');
      }
    } else {
      registerElement(username, () => {
        const updated = updateElementDirectly(element, username, displayNames[username]);
        if (updated) {
          element.setAttribute(PROCESSED_MARKER, 'true');
        }
      });
      fetchDisplayName(username);
    }
  });
}

  /**
   * Processes anchor tags that have a data-hovercard-url starting with "/users/", or
   * have a hovercard-link-click attribute.
   * For each such anchor:
   * - If its content is solely a <span class="AppHeader-context-item-label">, skip it.
   * - Otherwise, register a callback so that once the display name is available, every text node within the anchor
   *   that contains the username (or "@username") is updated to the display name.
   */
  function processAnchorsByHovercard(root) {
    if (!(root instanceof Element)) return; // Ensure root is an Element

    const selector = 'a[data-hovercard-url^="/users/"], a[data-octo-click="hovercard-link-click"]';
    let elementsToProcess = [];

    if (root.matches(selector)) {
      elementsToProcess.push(root);
    }
    // Add descendants, ensuring not to add duplicates if root itself was captured by querySelectorAll from a higher level
    // However, PROCESSED_MARKER handles actual duplicate processing effectively.
    elementsToProcess.push(...Array.from(root.querySelectorAll(selector)));

    // If root itself matches and is also found by querySelectorAll (e.g. if root is child of itself, which is not possible)
    // a simple Set could deduplicate: elementsToProcess = Array.from(new Set(elementsToProcess));
    // But given PROCESSED_MARKER, explicit deduplication here is likely not critical.

    elementsToProcess.forEach((anchor) => {
      if (anchor.hasAttribute(PROCESSED_MARKER)) return;

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

      // Extract the username.
      const username = getUsername(anchor);
      if (!username) return;

      // If the display name is already available, update immediately; otherwise, fetch it.
      if (displayNames[username]) {
        const updated = updateTextNodes(anchor, username, displayNames[username]);
        if (updated) {
          anchor.setAttribute(PROCESSED_MARKER, 'true');
        }
      } else {
        registerElement(username, (displayName) => {
          const updated = updateTextNodes(anchor, username, displayName);
          if (updated) {
            anchor.setAttribute(PROCESSED_MARKER, 'true');
          }
        });
        fetchDisplayName(username);
      }
    });
  }

  // Get the username from the anchor tag, preferring the data-hovercard-url to the href.
  function getUsername(anchor) {
    const hover = anchor.getAttribute("data-hovercard-url");
    const href = anchor.getAttribute("href");
    if (hover) {
      const match = hover.match(/^\/users\/((?!.*%5Bbot%5D)[^\/?]+)/);
      if (match) return match[1];
    }
    else if (href) {
      const match = href.match(/^\/((?!orgs\/)(?!.*%5Bbot%5D)[^\/?]+)\/?$/);
      if (match) return match[1];
    }
    return;
  }

  // Initial processing.
  processAnchorsByHovercard(document.body);
  processProjectElements(document.body);

  // Set up a MutationObserver to handle new elements.
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          processAnchorsByHovercard(node);
          processProjectElements(node);
        }
      });
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
})();
