// content.test.js

// A helper to flush pending microtasks.
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("content.js", () => {
  let fakeCache;

  beforeEach(() => {
    // Reset modules so that the IIFE in content.js re‑runs freshly.
    jest.resetModules();

    // Clear the document.
    document.body.innerHTML = "";
    // Initialize the fake cache.
    fakeCache = {};

    // --- Set up global chrome mocks ---
    global.chrome = {
      storage: {
        local: {
          get: jest.fn((keys, callback) => {
            // Return the current cache.
            callback({ githubDisplayNameCache: fakeCache });
          }),
          set: jest.fn((obj, callback) => {
            fakeCache = obj.githubDisplayNameCache;
            callback();
          }),
        },
      },
      runtime: {
        sendMessage: jest.fn((msg) => {
          if (msg.type === "acquireLock") {
            // By default, simulate that the lock is acquired.
            return Promise.resolve({ acquired: true });
          }
          if (msg.type === "releaseLock") {
            return Promise.resolve({ success: true });
          }
          return Promise.resolve({});
        }),
      },
    };

    // --- Set up global fetch mock ---
    global.fetch = jest.fn((url) => {
      // Default: simulate a successful fetch returning a profile with "Test User"
      return Promise.resolve({
        ok: true,
        text: () =>
          Promise.resolve(
            '<html><body><div class="vcard-fullname">Test User</div></body></html>'
          ),
      });
    });

    // --- Set location.hostname ---
    global.location = { hostname: "github.com" };

    // --- Spy on console logging methods ---
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("should fetch and update display name on a valid anchor", async () => {
    // Create an anchor that qualifies for processing.
    const anchor = document.createElement("a");
    anchor.setAttribute("data-hovercard-url", "/users/testuser");
    anchor.textContent = "Hello @testuser, welcome!";
    document.body.appendChild(anchor);

    // Load content.js (which processes document.body immediately).
    require("../content.js");

    // Wait for asynchronous tasks (fetch, DOM updates) to finish.
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));

    // The update callback (via updateTextNodes) should have replaced occurrences of
    // "@testuser" with "@Test User" (as returned from our mocked fetch).
    expect(anchor.textContent).toBe("Hello @Test User, welcome!");
  });

  test("should fallback to username if fetch fails", async () => {
    // Simulate a failed fetch (non-OK response).
    global.fetch.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 404,
        text: () => Promise.resolve("Not Found"),
      })
    );

    const consoleErrorSpy = jest.spyOn(console, "error");

    const anchor = document.createElement("a");
    anchor.setAttribute("data-hovercard-url", "/users/testuser");
    anchor.textContent = "Hello @testuser, welcome!";
    document.body.appendChild(anchor);

    require("../content.js");

    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));

    // On error, the fallback is to use the username.
    expect(anchor.textContent).toBe("Hello @testuser, welcome!");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Error fetching display name for @testuser",
      expect.any(Error)
    );
  });

  test("should skip processing anchor with a single child span having AppHeader-context-item-label", async () => {
    // Create an anchor that should be skipped.
    const anchor = document.createElement("a");
    anchor.setAttribute("data-hovercard-url", "/users/someuser");
    const span = document.createElement("span");
    span.className = "AppHeader-context-item-label";
    span.textContent = "some text";
    anchor.appendChild(span);
    document.body.appendChild(anchor);

    require("../content.js");

    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));

    // The anchor’s content should remain unchanged.
    expect(anchor.innerHTML).toBe(span.outerHTML);
    // And no lock should have been requested.
    expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test("should update new anchors added via MutationObserver", async () => {
    // Load the content script.
    require("../content.js");
  
    // Create a container to ensure the MutationObserver remains attached.
    const container = document.createElement("div");
    document.body.appendChild(container);
  
    // Create a new anchor after the MutationObserver is in place.
    const anchor = document.createElement("a");
    anchor.setAttribute("data-hovercard-url", "/users/testuser2");
    anchor.textContent = "testuser2";
    container.appendChild(anchor);
  
    // Modify the fetch mock to return a profile for "testuser2".
    global.fetch.mockImplementation((url) => {
      if (url.includes("/testuser2")) {
        return Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(
              '<html><body><div class="vcard-fullname">Test User 2</div></body></html>'
            ),
        });
      }
      return Promise.resolve({
        ok: true,
        text: () =>
          Promise.resolve(
            '<html><body><div class="vcard-fullname">Test User</div></body></html>'
          ),
      });
    });
  
    // Allow the MutationObserver callback to run.
    await flushPromises();
    await new Promise((r) => setTimeout(r, 50));
  
    expect(anchor.textContent).toBe("Test User 2");
  });
});
