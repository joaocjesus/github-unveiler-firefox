// content.test.js

// A helper to flush pending microtasks.
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("content.js", () => {
  let fakeCache;

  const mockDisplayNames = {
    testuser: "Test User",
    testuser2: "Test User 2",
    octouser: "Test Octo",
    user123: "Test User 123",
    TBBle: 'Paul "TBBle" Hampson',
    projectUser1: "Project User One",
    projectUser2: "Project User Two",
    projectUser3: "Project User Three",
    Done: "User IsDone",
    Ready: "User IsReady",
    Blocked: "User IsBlocked",
    "In Progress": "User IsInProgress",
    "No Status": "User HasNoStatus",
    gridUser1: "Grid User One",
    gridUser2: "Grid User Two",
    gridUser3: "Grid User Three",
    boardUser1: "Board User One",
    emptyUser: "",
    spaceUser: "   ",
  };

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = "";
    fakeCache = {}; // Reset for each test

    global.chrome = {
      storage: {
        local: {
          get: jest.fn((keys, callback) => {
            // Return a deep clone to ensure test isolation
            // Assuming 'githubDisplayNameCache' is the key used by content.js
            const result = {
                githubDisplayNameCache: JSON.parse(JSON.stringify(fakeCache || {}))
            };
            callback(result);
          }),
          set: jest.fn((obj, callback) => { // Not directly used by content.js but good practice
            if (obj.githubDisplayNameCache) {
              fakeCache = JSON.parse(JSON.stringify(obj.githubDisplayNameCache));
            }
            if (callback) callback();
          }),
        },
      },
      runtime: {
        sendMessage: jest.fn((msg) => {
          if (msg.type === "acquireLock") {
            return Promise.resolve({ acquired: true });
          }
          if (msg.type === "releaseLock") {
            global.chrome.runtime.sendMessage.lastReleaseLockMessage = msg;
            return Promise.resolve({ success: true });
          }
          return Promise.resolve({});
        }),
        lastError: null, // Ensure lastError is part of the mock if content.js checks it
      },
    };

    global.fetch = jest.fn((url) => {
      const potentialUsername = url.substring(url.lastIndexOf("/") + 1);
      const username = decodeURIComponent(potentialUsername);

      if (username === 'nullUser') {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('<html><body><!-- No vcard-fullname --></body></html>')
        });
      }

      const displayName = mockDisplayNames[username];
      if (typeof displayName !== 'undefined') {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(`<html><body><div class="vcard-fullname">${displayName}</div></body></html>`)
        });
      }
      return Promise.resolve({
        ok: false, status: 404, text: () => Promise.resolve("Not Found")
      });
    });

    global.location = { hostname: "github.com" };
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch.mockClear();
    if (global.chrome.runtime.sendMessage.mockClear) {
      global.chrome.runtime.sendMessage.mockClear();
    }
    delete global.chrome.runtime.sendMessage.lastReleaseLockMessage;
    jest.restoreAllMocks();
    document.body.innerHTML = "";
  });

  test("should fetch and update display name on a valid anchor with data-hovercard-url", async () => {
    const anchor = document.createElement("a");
    anchor.setAttribute("data-hovercard-url", "/users/testuser");
    anchor.textContent = "Hello @testuser, welcome!";
    document.body.appendChild(anchor);
    require("../content.js");
    await flushPromises();
    // Adding a slight delay to ensure async operations within content.js (like fetch and subsequent processing) complete.
    await new Promise(r => setTimeout(r, 50));
    expect(anchor.textContent).toBe("Hello @Test User, welcome!");
    expect(anchor.getAttribute("data-ghu-processed")).toBe("true");
  });

  test("should prioritize display name from local cache over network fetch", async () => {
    const username = "cachedUser";
    const cachedDisplayName = "Cached Name";
    // Set fakeCache directly, as content.js uses 'githubDisplayNameCache' key
    fakeCache = { // This represents the entire cache structure
      [location.hostname]: { // content.js uses location.hostname for serverCache
        [username]: { displayName: cachedDisplayName, timestamp: Date.now() }
      }
    };

    const localFetchMock = jest.fn(); // Specific fetch mock for this test
    global.fetch = localFetchMock;


    const anchor = document.createElement("a");
    anchor.setAttribute("data-hovercard-url", `/users/${username}`);
    anchor.textContent = `Hello @${username}!`;
    document.body.appendChild(anchor);
    require("../content.js");
    await flushPromises();
    await new Promise(r => setTimeout(r, 50));

    expect(anchor.textContent).toBe(`Hello @${cachedDisplayName}!`);
    expect(localFetchMock).not.toHaveBeenCalled();
  });

  describe("Empty or Whitespace Display Name Handling in fetchDisplayName", () => {
    test("should default to username if fetched display name is an empty string", async () => {
      const username = "emptyUser";
      const anchor = document.createElement("a");
      anchor.setAttribute("data-hovercard-url", `/users/${username}`);
      anchor.textContent = `@${username}`;
      document.body.appendChild(anchor);

      require("../content.js");
      await flushPromises();
      await new Promise(r => setTimeout(r, 100));

      expect(anchor.textContent).toBe(`@${username}`);
      expect(global.chrome.runtime.sendMessage.lastReleaseLockMessage).toEqual(
        expect.objectContaining({ displayName: username })
      );
    });

    test("should default to username if fetched display name is whitespace only", async () => {
      const username = "spaceUser";
      const anchor = document.createElement("a");
      anchor.setAttribute("data-hovercard-url", `/users/${username}`);
      anchor.textContent = `@${username}`;
      document.body.appendChild(anchor);

      require("../content.js");
      await flushPromises();
      await new Promise(r => setTimeout(r, 100));

      expect(anchor.textContent).toBe(`@${username}`);
      expect(global.chrome.runtime.sendMessage.lastReleaseLockMessage).toEqual(
        expect.objectContaining({ displayName: username })
      );
    });

    test("should default to username if .vcard-fullname element is not found (displayName is null)", async () => {
      const username = "nullUser";
      const anchor = document.createElement("a");
      anchor.setAttribute("data-hovercard-url", `/users/${username}`);
      anchor.textContent = `@${username}`;
      document.body.appendChild(anchor);

      require("../content.js");
      await flushPromises();
      await new Promise(r => setTimeout(r, 100));

      expect(anchor.textContent).toBe(`@${username}`);
      expect(global.chrome.runtime.sendMessage.lastReleaseLockMessage).toEqual(
        expect.objectContaining({ displayName: username })
      );
    });
  });

  test("should fallback to username if fetch fails", async () => {
    const usernameToFail = "testuserFail"; // Use a distinct username to avoid mock/cache conflicts
    // Override global fetch for this specific test to ensure failure
    global.fetch = jest.fn((url) => {
      if (url.includes(`/${usernameToFail}`)) {
        return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("Not Found") });
      }
      // Fallback for other unexpected fetches during this test
      return Promise.resolve({ ok: true, text: () => Promise.resolve('<html><body><div class="vcard-fullname">Unexpected Success</div></body></html>')});
    });

    // Ensure this user is not in the cache for a clean test of fetch failure
    if (fakeCache[location.hostname] && fakeCache[location.hostname][usernameToFail]) {
        delete fakeCache[location.hostname][usernameToFail];
    }
    // Also ensure not in the content.js internal 'displayNames' map by virtue of jest.resetModules()

    const consoleErrorSpy = jest.spyOn(console, "error");
    const anchor = document.createElement("a");
    anchor.setAttribute("data-hovercard-url", `/users/${usernameToFail}`);
    anchor.textContent = `Hello @${usernameToFail}, welcome!`;
    document.body.appendChild(anchor);

    require("../content.js");
    await flushPromises();
    await new Promise((r) => setTimeout(r, 50)); // Allow async operations

    expect(anchor.textContent).toBe(`Hello @${usernameToFail}, welcome!`); // Should remain username
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      `Error fetching display name for @${usernameToFail}`,
      expect.any(Error)
    );
  });
});
