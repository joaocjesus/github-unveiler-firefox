// background.test.js
describe("background.js", () => {
  let onClickedCallback, onUpdatedCallback, onMessageCallback;

  beforeEach(() => {
    jest.resetModules();

    // Set up global chrome API mocks
    global.chrome = {
      action: {
        onClicked: { addListener: jest.fn() },
      },
      permissions: {
        request: jest.fn(),
        contains: jest.fn()
      },
      tabs: {
        onUpdated: { addListener: jest.fn() },
      },
      scripting: {
        executeScript: jest.fn((options, callback) => callback())
      },
      runtime: {
        onMessage: { addListener: jest.fn() },
        lastError: null,
        sendMessage: jest.fn(),
      },
      storage: {
        local: {
          get: jest.fn((keys, callback) => callback({})),
          set: jest.fn((obj, callback) => callback()),
        }
      },
      offscreen: {
        hasDocument: jest.fn(() => Promise.resolve(false)),
        createDocument: jest.fn(() => Promise.resolve()),
      }
    };

    // Spy on console methods to suppress output during tests.
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});

    // Now load the background script (which registers its listeners immediately)
    require("../background.js");

    // Retrieve the registered listeners so we can simulate events.
    onClickedCallback = chrome.action.onClicked.addListener.mock.calls[0][0];
    onUpdatedCallback = chrome.tabs.onUpdated.addListener.mock.calls[0][0];
    onMessageCallback = chrome.runtime.onMessage.addListener.mock.calls[0][0];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("onClicked with no URL", () => {
    const tab = { id: 1, url: undefined };
    onClickedCallback(tab);
    expect(console.error).toHaveBeenCalledWith("No URL found for the active tab.");
  });

  test("onClicked with an invalid URL", () => {
    const tab = { id: 1, url: "invalid-url" };
    onClickedCallback(tab);
    expect(console.error).toHaveBeenCalledWith("Invalid URL:", "invalid-url");
  });

  test("onClicked with a valid GitHub URL and permission granted", () => {
    const tab = { id: 1, url: "https://github.com/user" };
    const originPattern = "https://github.com/*";
    chrome.permissions.request.mockImplementation((options, cb) => {
      cb(true);
    });
    onClickedCallback(tab);
    expect(chrome.permissions.request).toHaveBeenCalledWith(
      { origins: [originPattern] },
      expect.any(Function)
    );
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      { target: { tabId: tab.id }, files: ["content.js"] },
      expect.any(Function)
    );
    expect(console.log).toHaveBeenCalledWith("Content script injected into tab", tab.id);
  });

  test("onClicked with a valid GitHub URL and permission denied", () => {
    const tab = { id: 1, url: "https://github.com/user" };
    const originPattern = "https://github.com/*";
    chrome.permissions.request.mockImplementation((options, cb) => {
      cb(false);
    });
    onClickedCallback(tab);
    expect(chrome.permissions.request).toHaveBeenCalledWith(
      { origins: [originPattern] },
      expect.any(Function)
    );
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith("Permission denied for", originPattern);
  });

  test("tabs.onUpdated with non-'complete' status does nothing", () => {
    const tabId = 1;
    const changeInfo = { status: "loading" };
    const tab = { id: 1, url: "https://github.com/user" };
    onUpdatedCallback(tabId, changeInfo, tab);
    expect(chrome.permissions.contains).not.toHaveBeenCalled();
  });

  test("tabs.onUpdated with an invalid URL does nothing", () => {
    const tabId = 1;
    const changeInfo = { status: "complete" };
    const tab = { id: 1, url: "not-a-valid-url" };
    onUpdatedCallback(tabId, changeInfo, tab);
    expect(chrome.permissions.contains).not.toHaveBeenCalled();
  });

  test("tabs.onUpdated with a valid GitHub URL and permission granted", () => {
    const tabId = 1;
    const changeInfo = { status: "complete" };
    const tab = { id: 1, url: "https://github.com/user" };
    const originPattern = "https://github.com/*";
    chrome.permissions.contains.mockImplementation((options, cb) => {
      cb(true);
    });
    onUpdatedCallback(tabId, changeInfo, tab);
    expect(chrome.permissions.contains).toHaveBeenCalledWith(
      { origins: [originPattern] },
      expect.any(Function)
    );
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      { target: { tabId: tabId }, files: ["content.js"] },
      expect.any(Function)
    );
    expect(console.log).toHaveBeenCalledWith("Auto injecting content script for", originPattern);
  });

  test("tabs.onUpdated with a valid GitHub URL and permission not granted", () => {
    const tabId = 1;
    const changeInfo = { status: "complete" };
    const tab = { id: 1, url: "https://github.com/user" };
    const originPattern = "https://github.com/*";
    chrome.permissions.contains.mockImplementation((options, cb) => {
      cb(false);
    });
    onUpdatedCallback(tabId, changeInfo, tab);
    expect(chrome.permissions.contains).toHaveBeenCalledWith(
      { origins: [originPattern] },
      expect.any(Function)
    );
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith("No permission for", originPattern, "; content script not injected.");
  });

  test("onMessage 'fetchDisplayName' calls fetch and offscreen functions and returns success", async () => {
    // Set up a fake HTML response that contains a .vcard-fullname element.
    const fakeHTML = `<div class="vcard-fullname">John Doe</div>`;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(fakeHTML)
    });
    // Simulate that no offscreen document exists.
    chrome.offscreen.hasDocument = jest.fn(() => Promise.resolve(false));
    // Simulate creation of offscreen document.
    chrome.offscreen.createDocument = jest.fn(() => Promise.resolve());
    // Simulate the offscreen parser (via runtime.sendMessage) returning the display name.
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      callback({ displayName: "John Doe" });
    });
    // Ensure storage returns an empty cache initially.
    chrome.storage.local.get.mockImplementation((keys, callback) => {
      callback({});
    });

    let sendResponseCalled = false;
    await new Promise((resolve) => {
      const result = onMessageCallback(
        { type: "fetchDisplayName", origin: "github.com", username: "johndoe" },
        null,
        (response) => {
          expect(response).toEqual({ success: true });
          sendResponseCalled = true;
          resolve();
        }
      );
      // If the onMessage callback returns true (to indicate async response), wait for resolution.
      if (!result) resolve();
    });

    expect(fetch).toHaveBeenCalledWith("https://github.com/johndoe");
    expect(chrome.offscreen.hasDocument).toHaveBeenCalled();
    expect(chrome.offscreen.createDocument).toHaveBeenCalledWith({
      url: "offscreen.html",
      reasons: ["DOM_PARSER"],
      justification: "Needed to parse HTML for display name extraction."
    });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: "parseDisplayName", html: fakeHTML, username: "johndoe" },
      expect.any(Function)
    );
    expect(sendResponseCalled).toBe(true);
  });
});
