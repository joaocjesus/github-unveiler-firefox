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

  // ... other test suites ...

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

// Note: Other describe blocks (chrome.action.onClicked, etc.) are omitted for brevity but remain unchanged.
