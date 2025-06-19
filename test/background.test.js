// background.test.js

// We assume background.js is in the same folder.
// The tests below reset the module and set up our own global.chrome mocks.
describe("background.js", () => {
  // We'll capture the listener callbacks for the events so we can call them in our tests.
  let onClickedCallback, onUpdatedCallback, onMessageCallback;
  const CACHE_KEY = "githubDisplayNameCache";
  let fakeStorage;

  beforeEach(() => {
    // Reset modules so that background.js re‑registers its listeners with our mocks.
    jest.resetModules();

    // Create an in-memory storage for chrome.storage.local.
    fakeStorage = {}; // Reset for each test

    // Set up our global.chrome mock object.
    global.chrome = {
      action: {
        onClicked: {
          addListener: (callback) => {
            onClickedCallback = callback;
          },
        },
      },
      permissions: {
        request: jest.fn(),
        contains: jest.fn(),
      },
      tabs: {
        onUpdated: {
          addListener: (callback) => {
            onUpdatedCallback = callback;
          },
        },
      },
      runtime: {
        onMessage: {
          addListener: (callback) => {
            onMessageCallback = callback;
          },
        },
        lastError: null,
      },
      scripting: {
        executeScript: jest.fn((options, callback) => {
          // By default, simulate a successful injection.
          if (callback) callback();
        }),
      },
      storage: {
        local: {
          get: jest.fn((keys, callback) => {
            // Return a deep clone to ensure test isolation
            const result = {};
            if (Array.isArray(keys)) {
                keys.forEach(key => {
                    result[key] = JSON.parse(JSON.stringify(fakeStorage[key] || {}));
                });
            } else { // Assuming keys is a string for CACHE_KEY
                 result[keys] = JSON.parse(JSON.stringify(fakeStorage[keys] || {}));
            }
            // Specifically for githubDisplayNameCache structure
            if (keys.includes(CACHE_KEY) || keys === CACHE_KEY) {
                 result[CACHE_KEY] = JSON.parse(JSON.stringify(fakeStorage[CACHE_KEY] || {}));
            }
            callback(result);
          }),
          set: jest.fn((obj, callback) => {
            // Update our fakeStorage.
            for (const key in obj) {
                fakeStorage[key] = JSON.parse(JSON.stringify(obj[key]));
            }
            if (callback) callback();
          }),
        },
      },
    };

    // Spy on console.log and console.error.
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});

    // Require the background script (which immediately registers its event listeners
    // and calls clearOldCacheEntries).
    // The clearOldCacheEntries is async, tests need to await its completion.
    require("../background.js");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("chrome.action.onClicked", () => {
    it("should log an error if the tab has no URL", () => {
      const tab = { id: 1, url: null };
      onClickedCallback(tab);
      expect(console.error).toHaveBeenCalledWith("No URL found for the active tab.");
    });

    it("should log an error for an invalid URL", () => {
      const tab = { id: 1, url: "not-a-valid-url" };
      onClickedCallback(tab);
      expect(console.error).toHaveBeenCalledWith("Invalid URL:", tab.url);
    });

    it("should request permission and inject content script when permission is granted", () => {
      const tab = { id: 1, url: "https://example.com/page" };
      const expectedOriginPattern = "https://example.com/*";

      // Simulate permissions.request calling its callback with granted = true.
      chrome.permissions.request.mockImplementation((options, callback) => {
        // Verify that the correct origin pattern is requested.
        expect(options.origins).toContain(expectedOriginPattern);
        callback(true);
      });

      onClickedCallback(tab);

      expect(console.log).toHaveBeenCalledWith("Requesting permission for", expectedOriginPattern);
      expect(console.log).toHaveBeenCalledWith("Permission granted for", expectedOriginPattern);
      expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
        {
          target: { tabId: tab.id },
          files: ["content.js"],
        },
        expect.any(Function)
      );
    });

    it("should log that permission was denied if not granted", () => {
      const tab = { id: 1, url: "https://example.com/page" };
      const expectedOriginPattern = "https://example.com/*";

      chrome.permissions.request.mockImplementation((options, callback) => {
        callback(false);
      });

      onClickedCallback(tab);

      expect(console.log).toHaveBeenCalledWith("Requesting permission for", expectedOriginPattern);
      expect(console.log).toHaveBeenCalledWith("Permission denied for", expectedOriginPattern);
      expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
    });
  });

  describe("chrome.tabs.onUpdated", () => {
    it("should do nothing if the tab status is not 'complete'", () => {
      const tab = { id: 1, url: "https://example.com/page" };
      const changeInfo = { status: "loading" };
      onUpdatedCallback(tab.id, changeInfo, tab);
      expect(chrome.permissions.contains).not.toHaveBeenCalled();
    });

    it("should do nothing for an invalid URL", () => {
      const tab = { id: 1, url: "not-a-valid-url" };
      const changeInfo = { status: "complete" };
      onUpdatedCallback(tab.id, changeInfo, tab);
      expect(chrome.permissions.contains).not.toHaveBeenCalled();
    });

    it("should auto inject the content script if permission is already granted", () => {
      const tab = { id: 1, url: "https://example.com/page" };
      const changeInfo = { status: "complete" };
      const expectedOriginPattern = "https://example.com/*";

      chrome.permissions.contains.mockImplementation((options, callback) => {
        expect(options.origins).toContain(expectedOriginPattern);
        callback(true);
      });

      onUpdatedCallback(tab.id, changeInfo, tab);

      expect(console.log).toHaveBeenCalledWith("Auto injecting content script for", expectedOriginPattern);
      expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
        {
          target: { tabId: tab.id },
          files: ["content.js"],
        },
        expect.any(Function)
      );
    });

    it("should not inject the content script if permission is not granted", () => {
      const tab = { id: 1, url: "https://example.com/page" };
      const changeInfo = { status: "complete" };
      const expectedOriginPattern = "https://example.com/*";

      chrome.permissions.contains.mockImplementation((options, callback) => {
        callback(false);
      });

      onUpdatedCallback(tab.id, changeInfo, tab);

      expect(console.log).toHaveBeenCalledWith(
        "No permission for",
        expectedOriginPattern,
        "; content script not injected."
      );
      expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
    });
  });

  describe("chrome.runtime.onMessage", () => {
    it('should acquire a lock when one is not already held ("acquireLock")', () => {
      const message = { type: "acquireLock", origin: "https://example.com", username: "user1" };
      const sendResponse = jest.fn();

      // First call should acquire the lock.
      onMessageCallback(message, null, sendResponse);
      expect(sendResponse).toHaveBeenCalledWith({ acquired: true });
    });

    it('should not acquire a lock if it is already held ("acquireLock")', () => {
      const message = { type: "acquireLock", origin: "https://example.com", username: "user1" };
      const sendResponse1 = jest.fn();
      const sendResponse2 = jest.fn();

      // First call acquires the lock.
      onMessageCallback(message, null, sendResponse1);
      expect(sendResponse1).toHaveBeenCalledWith({ acquired: true });

      // Second call for the same origin+username should fail.
      onMessageCallback(message, null, sendResponse2);
      expect(sendResponse2).toHaveBeenCalledWith({ acquired: false });
    });

    it('should update the cache and release the lock on "releaseLock" message', (done) => {
      const message = {
        type: "releaseLock",
        origin: "https://example.com",
        username: "user1",
        displayName: "User One",
      };

      // First, acquire the lock.
      const acquireResponse = jest.fn();
      onMessageCallback({ type: "acquireLock", origin: message.origin, username: message.username }, null, acquireResponse);
      expect(acquireResponse).toHaveBeenCalledWith({ acquired: true });

      // For releaseLock, the listener returns true to indicate async response.
      const sendResponse = (response) => {
        try {
          expect(response).toEqual({ success: true });
          // Check that the cache was updated.
          const storedCache = fakeStorage[CACHE_KEY];
          expect(storedCache[message.origin]).toBeDefined();
          expect(storedCache[message.origin][message.username]).toBeDefined();
          expect(storedCache[message.origin][message.username].displayName).toBe(message.displayName);
          // Since the lock is released, we can acquire it again.
          const newResponse = jest.fn();
          onMessageCallback({ type: "acquireLock", origin: message.origin, username: message.username }, null, newResponse);
          expect(newResponse).toHaveBeenCalledWith({ acquired: true });
          done();
        } catch (error) {
          done(error);
        }
      };

      const returnValue = onMessageCallback(message, null, sendResponse);
      // The releaseLock branch returns true because we send a response asynchronously.
      expect(returnValue).toBe(true);
    });
  });

  describe("injectContentScript (via chrome.scripting.executeScript)", () => {
    it("should log an error if script injection fails", () => {
      // Override executeScript to simulate a failure.
      chrome.scripting.executeScript.mockImplementation((options, callback) => {
        // Simulate a failure by setting chrome.runtime.lastError.
        chrome.runtime.lastError = { message: "Injection failed" };
        callback();
      });

      const tab = { id: 1, url: "https://example.com/page" };
      // Simulate permission granted.
      chrome.permissions.request.mockImplementation((options, callback) => {
        callback(true);
      });

      onClickedCallback(tab);

      expect(console.error).toHaveBeenCalledWith("Script injection failed:", { message: "Injection failed" });
      // Clear the error for subsequent tests.
      chrome.runtime.lastError = null;
    });

    it("should log success when script injection succeeds", () => {
      const tab = { id: 1, url: "https://example.com/page" };
      // Simulate permission granted and a successful injection (lastError remains null).
      chrome.permissions.request.mockImplementation((options, callback) => {
        callback(true);
      });
      chrome.runtime.lastError = null;

      onClickedCallback(tab);

      expect(console.log).toHaveBeenCalledWith("Content script injected into tab", tab.id);
    });
  });

  describe("Cache clearing on load", () => {
    it("should remove cache entries older than 7 days", async () => {
      // Set up fakeStorage with one old entry and one new entry.
      const now = Date.now();
      fakeStorage[CACHE_KEY] = {
        "https://example.com": {
          oldUser: { displayName: "Old", timestamp: now - (8 * 24 * 60 * 60 * 1000) },
          newUser: { displayName: "New", timestamp: now - (1 * 24 * 60 * 60 * 1000) },
        },
      };

      // Reset modules and require background.js so that clearOldCacheEntries runs.
      jest.resetModules();
      require("../background.js");

      // Wait briefly for the asynchronous clearOldCacheEntries() to finish.
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updatedCache = fakeStorage[CACHE_KEY];
      expect(updatedCache).toBeDefined();
      expect(updatedCache["https://example.com"]).toBeDefined();
      expect(updatedCache["https://example.com"].oldUser).toBeUndefined();
      expect(updatedCache["https://example.com"].newUser).toBeDefined();
      expect(console.log).toHaveBeenCalledWith("Cleared old cache entries");
    });
  });

  describe("Cache clearing on load", () => {
    it("should remove cache entries older than 7 days", async () => {
      const now = Date.now();
      fakeStorage[CACHE_KEY] = {
        "https://example.com": {
          oldUser: { displayName: "Old", timestamp: now - (8 * 24 * 60 * 60 * 1000) },
          newUser: { displayName: "New", timestamp: now - (1 * 24 * 60 * 60 * 1000) },
        },
      };

      // Reset modules and require background.js so that clearOldCacheEntries runs on "load"
      // clearOldCacheEntries is called at the top level of background.js
      // We need to ensure it completes before assertions.
      jest.resetModules();
      const clearPromise = new Promise(resolve => { // Create a promise to wait for clear
          global.chrome.storage.local.set = jest.fn((obj, cb) => {
              for (const key in obj) {
                  fakeStorage[key] = JSON.parse(JSON.stringify(obj[key]));
              }
              if(cb) cb();
              resolve(); // Resolve when set is called (end of clearOldCacheEntries)
          });
          // Mock get to provide the initial state for this specific run
          global.chrome.storage.local.get = jest.fn((keys, cb) => {
             const result = {};
             result[CACHE_KEY] = JSON.parse(JSON.stringify(fakeStorage[CACHE_KEY] || {}));
             cb(result);
          });
          require("../background.js");
      });
      await clearPromise;


      const updatedCache = fakeStorage[CACHE_KEY];
      expect(updatedCache).toBeDefined();
      expect(updatedCache["https://example.com"]).toBeDefined();
      expect(updatedCache["https://example.com"].oldUser).toBeUndefined();
      expect(updatedCache["https://example.com"].newUser).toBeDefined();
    });

    it("should respect the noExpire flag for old entries", async () => {
      const now = Date.now();
      const EIGHT_DAYS_AGO = now - (8 * 24 * 60 * 60 * 1000);
      const ONE_DAY_AGO = now - (1 * 24 * 60 * 60 * 1000);

      fakeStorage[CACHE_KEY] = {
        "https://example.com": {
          oldUserToExpire: { displayName: "Old To Expire", timestamp: EIGHT_DAYS_AGO },
          oldUserNoExpire: { displayName: "Old No Expire", timestamp: EIGHT_DAYS_AGO, noExpire: true },
          newUserRegular: { displayName: "New Regular", timestamp: ONE_DAY_AGO },
          newUserNoExpire: { displayName: "New No Expire", timestamp: ONE_DAY_AGO, noExpire: true },
        },
        "https://another.com": {
          anotherOldUserToExpire: { displayName: "Another Old To Expire", timestamp: EIGHT_DAYS_AGO }
        }
      };

      jest.resetModules();
      const clearPromise = new Promise(resolve => {
          const originalSet = global.chrome.storage.local.set;
          global.chrome.storage.local.set = jest.fn((obj, cb) => {
              originalSet(obj, cb); // Call original mock to update fakeStorage
              resolve();
          });
          global.chrome.storage.local.get = jest.fn((keys, cb) => {
             const result = {};
             result[CACHE_KEY] = JSON.parse(JSON.stringify(fakeStorage[CACHE_KEY] || {}));
             cb(result);
          });
          require("../background.js");
      });
      await clearPromise;

      const updatedCache = fakeStorage[CACHE_KEY];
      expect(updatedCache["https://example.com"].oldUserToExpire).toBeUndefined();
      expect(updatedCache["https://example.com"].oldUserNoExpire).toBeDefined();
      expect(updatedCache["https://another.com"]).toBeUndefined();
    });

    it("should update empty/whitespace display names to username for kept entries", async () => {
      const now = Date.now();
      const EIGHT_DAYS_AGO = now - (8 * 24 * 60 * 60 * 1000);
      const ONE_DAY_AGO = now - (1 * 24 * 60 * 60 * 1000);
      const TEST_ORIGIN = "https://example.com";

      fakeStorage[CACHE_KEY] = {
        [TEST_ORIGIN]: {
          userEmptyNameKept: { displayName: "", timestamp: ONE_DAY_AGO, noExpire: true },
          userSpaceNameKept: { displayName: "   ", timestamp: ONE_DAY_AGO, noExpire: false },
          userValidNameKept: { displayName: "Valid Name", timestamp: ONE_DAY_AGO, noExpire: true },
          userOldEmptyNameKept: { displayName: "", timestamp: EIGHT_DAYS_AGO, noExpire: true},
          userOldToBeDeleted: { displayName: "Delete Me", timestamp: EIGHT_DAYS_AGO, noExpire: false},
          userOldEmptyToBeDeleted: { displayName: " ", timestamp: EIGHT_DAYS_AGO, noExpire: false}
        }
      };

      chrome.storage.local.set.mockClear(); // Clear calls from beforeEach's require

      jest.resetModules();
      // Need to ensure clearOldCacheEntries completes. It calls set if updated is true.
      const clearPromise = new Promise(resolve => {
          const originalSet = global.chrome.storage.local.set;
          global.chrome.storage.local.set = jest.fn((obj, cb) => {
              originalSet(obj, cb); // Call original mock to update fakeStorage
              resolve(); // Resolve when set is called
          });
           // Mock get to provide the initial state for this specific run
          global.chrome.storage.local.get = jest.fn((keys, cb) => {
             const result = {};
             result[CACHE_KEY] = JSON.parse(JSON.stringify(fakeStorage[CACHE_KEY] || {}));
             cb(result);
          });
          require("../background.js");
      });
      await clearPromise;


      const updatedCache = fakeStorage[CACHE_KEY];
      const testOriginCache = updatedCache[TEST_ORIGIN];
      expect(testOriginCache).toBeDefined();

      expect(testOriginCache.userEmptyNameKept.displayName).toBe("userEmptyNameKept");
      expect(testOriginCache.userSpaceNameKept.displayName).toBe("userSpaceNameKept");
      expect(testOriginCache.userOldEmptyNameKept.displayName).toBe("userOldEmptyNameKept");
      expect(testOriginCache.userValidNameKept.displayName).toBe("Valid Name");
      expect(testOriginCache.userOldToBeDeleted).toBeUndefined();
      expect(testOriginCache.userOldEmptyToBeDeleted).toBeUndefined();
      expect(chrome.storage.local.set).toHaveBeenCalled();
    });
  });
});
