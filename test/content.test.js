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
      // Use different responses based on the URL.
      if (url.includes("/testuser2")) {
        return Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(
              '<html><body><div class="vcard-fullname">Test User 2</div></body></html>'
            ),
        });
      }
      if (url.includes("/octouser")) {
        return Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(
              '<html><body><div class="vcard-fullname">Test Octo</div></body></html>'
            ),
        });
      }
      if (url.includes("/user123")) {
        return Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(
              '<html><body><div class="vcard-fullname">Test User 123</div></body></html>'
            ),
        });
      }
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

  test("should fetch and update display name on a valid anchor with data-hovercard-url", async () => {
    // Create an anchor that qualifies for processing.
    const anchor = document.createElement("a");
    anchor.setAttribute("data-hovercard-url", "/users/testuser");
    anchor.textContent = "Hello @testuser, welcome!";
    document.body.appendChild(anchor);

    // Load content.js (which processes document.body immediately).
    require("../content.js");

    // Wait for asynchronous tasks to finish.
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));

    // Expect occurrences of "@testuser" to be replaced with "@Test User"
    expect(anchor.textContent).toBe("Hello @Test User, welcome!");
  });

  test("should fallback to username if fetch fails", async () => {
    // Simulate a failed fetch.
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

    // On error, the fallback is to use the original username.
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

    // Allow the MutationObserver callback to run.
    await flushPromises();
    await new Promise((r) => setTimeout(r, 50));

    expect(anchor.textContent).toBe("Test User 2");
  });

  test("should extract username from href if data-hovercard-url is missing (handles trailing slash)", async () => {
    // Create an anchor with only an href attribute (with a trailing slash).
    const anchor = document.createElement("a");
    anchor.setAttribute("href", "/user123/");
    anchor.setAttribute("data-octo-click", "hovercard-link-click");
    anchor.textContent = "Welcome @user123!";
    document.body.appendChild(anchor);

    require("../content.js");

    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));

    // Expect the username to be fetched from href and replaced accordingly.
    expect(anchor.textContent).toBe("Welcome @Test User 123!");
  });

  test("should process anchor with data-octo-click attribute and valid href", async () => {
    // Create an anchor that qualifies via the data-octo-click attribute.
    const anchor = document.createElement("a");
    anchor.setAttribute("data-octo-click", "hovercard-link-click");
    anchor.setAttribute("href", "/octouser");
    anchor.textContent = "Hello @octouser!";
    document.body.appendChild(anchor);

    require("../content.js");

    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));

    // Expect the username extracted from href to be updated.
    expect(anchor.textContent).toBe("Hello @Test Octo!");
  });

  test("should skip processing anchor if username contains encoded [bot]", async () => {
    // Create an anchor with a data-hovercard-url that includes an encoded [bot].
    const anchor = document.createElement("a");
    anchor.setAttribute("data-hovercard-url", "/users/test%5Bbot%5D");
    anchor.textContent = "Hello @test[bot]!";
    document.body.appendChild(anchor);

    require("../content.js");

    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));

    // Expect no processing; the text remains unchanged.
    expect(anchor.textContent).toBe("Hello @test[bot]!");
    // And no lock message should have been sent.
    expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });
});
