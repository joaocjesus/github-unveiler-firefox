// content.test.js

// A helper to flush pending microtasks.
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("content.js", () => {
  let fakeCache;

  const mockDisplayNames = {
    'testuser': 'Test User',
    'testuser2': 'Test User 2',
    'octouser': 'Test Octo',
    'user123': 'Test User 123',
    'TBBle': 'Paul "TBBle" Hampson',
    'projectUser1': 'Project User One',
    'projectUser2': 'Project User Two',
    'projectUser3': 'Project User Three',
    "Done": "User IsDone",
    "Ready": "User IsReady",
    "Blocked": "User IsBlocked",
    "In Progress": "User IsInProgress",
    "No Status": "User HasNoStatus",
    'gridUser1': 'Grid User One',
    'gridUser2': 'Grid User Two',
    'gridUser3': 'Grid User Three',
    'boardUser1': 'Board User One',
  };

  // Helper function to create the primary DOM structure, moved to a higher scope
  function setupPrimaryDOM(username, headingTag = 'h3') {
    document.body.innerHTML = `
      <div class="item-container-generic"> <!-- Simulating a generic root -->
        <div class="leading-visual-wrapper-generic"> <!-- Simulating leadingVisualWrapper -->
          <div class="icon-wrapper-generic"> <!-- Simulating iconWrapper -->
            <img data-testid="github-avatar" alt="${username}" src="#" />
          </div>
        </div>
        <div class="main-content-wrapper-generic"> <!-- Simulating mainContentWrapper (nextElementSibling) -->
          <${headingTag}>${username}</${headingTag}>
        </div>
      </div>
    `;
    return {
      avatar: document.querySelector('img[data-testid="github-avatar"]'),
      heading: document.querySelector(headingTag),
    };
  }

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
    // mockDisplayNames is now defined at a higher scope
    global.fetch = jest.fn((url) => {
      const potentialUsername = url.substring(url.lastIndexOf('/') + 1);
      const username = decodeURIComponent(potentialUsername); // Decode username from URL
      const displayName = mockDisplayNames[username];

      if (displayName) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(`<html><body><div class="vcard-fullname">${displayName}</div></body></html>`),
        });
      }
      // Fallback for any username not in mockDisplayNames, or if specific error simulation is needed
      return Promise.resolve({
        ok: false, status: 404, text: () => Promise.resolve("Not Found"),
      });
    });

    // --- Set location.hostname ---
    global.location = { hostname: "github.com" };

    // --- Spy on console logging methods ---
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  // Helper function to set up DOM for grid cell tests
  function setupGridCellDOM(usernames, type) {
    const cell = document.createElement('div');
    cell.setAttribute('role', 'gridcell');
    const innerDiv = document.createElement('div'); // Simplified inner structure
    cell.appendChild(innerDiv);

    if (type === 'single') {
      if (typeof usernames !== 'string') {
        throw new Error("For 'single' type, usernames must be a string.");
      }
      const userDiv = document.createElement('div');
      const img = document.createElement('img');
      img.setAttribute('data-testid', 'github-avatar');
      img.setAttribute('alt', usernames);
      img.setAttribute('src', '#'); // Placeholder src

      const usernameSpan = document.createElement('span');
      usernameSpan.textContent = usernames;

      userDiv.appendChild(img);
      userDiv.appendChild(usernameSpan);
      innerDiv.appendChild(userDiv);
      document.body.appendChild(cell);
      return { cell, img, usernameSpan };

    } else if (type === 'multi') {
      if (!Array.isArray(usernames)) {
        throw new Error("For 'multi' type, usernames must be an array.");
      }

      const multiUserSpan = document.createElement('span');
      multiUserSpan.setAttribute('data-avatar-count', usernames.length.toString());
      const avatarStackBody = document.createElement('div'); // Simulating "Avatar stack body"
      multiUserSpan.appendChild(avatarStackBody);

      const avatarImgs = [];
      usernames.forEach(username => {
        const img = document.createElement('img');
        img.setAttribute('data-testid', 'github-avatar');
        img.setAttribute('alt', username);
        img.setAttribute('src', '#');
        avatarStackBody.appendChild(img);
        avatarImgs.push(img);
      });

      let usernamesText = "";
      if (usernames.length === 1) {
        usernamesText = usernames[0];
      } else if (usernames.length === 2) {
        usernamesText = `${usernames[0]} and ${usernames[1]}`;
      } else if (usernames.length > 2) {
        usernamesText = usernames.slice(0, -1).join(', ') + ', and ' + usernames[usernames.length - 1];
      }

      const usernamesTextSpan = document.createElement('span');
      usernamesTextSpan.textContent = usernamesText;

      innerDiv.appendChild(multiUserSpan);
      innerDiv.appendChild(usernamesTextSpan);
      document.body.appendChild(cell);
      return { cell, multiUserSpan, avatarImgs, usernamesTextSpan };
    } else {
      throw new Error("Invalid type specified for setupGridCellDOM. Must be 'single' or 'multi'.");
    }
  }

  // Helper function to set up DOM for board group header tests
  function setupBoardGroupHeaderDOM(username) {
    const container = document.createElement('div');
    container.className = 'board-group-header-container'; // Outer container

    const innerMimicDiv = document.createElement('div'); // Inner container mimicking the structure
    container.appendChild(innerMimicDiv);

    const collapseButton = document.createElement('button');
    collapseButton.textContent = '...'; // Minimal button
    innerMimicDiv.appendChild(collapseButton);

    const tooltipCollapse = document.createElement('span');
    tooltipCollapse.setAttribute('popover', 'auto');
    tooltipCollapse.id = 'tooltip-collapse'; // Static ID for test access
    tooltipCollapse.textContent = `Collapse group ${username}`;
    innerMimicDiv.appendChild(tooltipCollapse);

    const headerContentBlock = document.createElement('div');
    headerContentBlock.className = 'header-content-block'; // Mimics Box-sc-g0xbh4-0 hYSjTM
    innerMimicDiv.appendChild(headerContentBlock);

    const avatarCountSpan = document.createElement('span');
    avatarCountSpan.setAttribute('data-avatar-count', '1');
    headerContentBlock.appendChild(avatarCountSpan);

    const avatarStackBody = document.createElement('div'); // Avatar stack body
    avatarCountSpan.appendChild(avatarStackBody);

    const avatarImg = document.createElement('img');
    avatarImg.setAttribute('data-testid', 'github-avatar');
    avatarImg.setAttribute('alt', username);
    avatarImg.setAttribute('src', '#'); // Placeholder src
    avatarStackBody.appendChild(avatarImg);

    const usernameSpan = document.createElement('span');
    usernameSpan.textContent = username; // Main username span
    headerContentBlock.appendChild(usernameSpan);

    const countSpan = document.createElement('span');
    countSpan.textContent = '3'; // Static count for simplicity
    headerContentBlock.appendChild(countSpan);

    const actionsButton = document.createElement('button');
    actionsButton.textContent = '...'; // Minimal button
    innerMimicDiv.appendChild(actionsButton);

    const tooltipActions = document.createElement('span');
    tooltipActions.setAttribute('popover', 'auto');
    tooltipActions.id = 'tooltip-actions'; // Static ID for test access
    tooltipActions.textContent = `Actions for group: ${username}`;
    innerMimicDiv.appendChild(tooltipActions);

    document.body.appendChild(container);

    return {
      container,
      avatarImg,
      usernameSpan,
      tooltipCollapse,
      tooltipActions,
      headerContentBlock,
    };
  }

  afterEach(() => {
    // Clear mock call counts
    global.fetch.mockClear();
    if (global.chrome && global.chrome.runtime && global.chrome.runtime.sendMessage) {
      global.chrome.runtime.sendMessage.mockClear();
    }
    // Restore any spied-on objects
    jest.restoreAllMocks();
    // Clear the document body
    document.body.innerHTML = "";
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
    expect(anchor.getAttribute('data-ghu-processed')).toBe('true');
  });

  test("should fallback to username if fetch fails", async () => {
    // Simulate a failed fetch specifically for 'testuser' for this test
    // Simulate a failed fetch specifically for 'testuser' for this test
    // This completely replaces the global.fetch for the scope of this test.
    global.fetch = jest.fn((url) => {
      if (url.includes('/testuser')) {
        return Promise.resolve({
          ok: false,
          status: 404,
          text: () => Promise.resolve("Not Found"),
        });
      }
      // For any other URL, also return an error or an unexpected response
      // to ensure only the '/testuser' path is relevant to what this test is trying to achieve.
      return Promise.resolve({
        ok: false,
        status: 500, // Different status to distinguish
        text: () => Promise.resolve("Unexpected call in this test's fetch mock")
      });
    });

    const consoleErrorSpy = jest.spyOn(console, "error");

    const anchor = document.createElement("a");
    anchor.setAttribute("data-hovercard-url", "/users/testuser");
    anchor.textContent = "Hello @testuser, welcome!";
    document.body.appendChild(anchor);

    // Check if a pre-existing observer (from a previous test's content.js) might process this first
    await flushPromises();
    await new Promise(r => setTimeout(r, 50)); // Allow MO time

    // If it's already "Test User", then a prior observer + the beforeEach fetch mock is the issue.
    // This attempts to counteract that for this specific test.
    if (anchor.textContent === "Hello @Test User, welcome!") {
      // console.error("Fallback Test: Anchor text was ALREADY 'Test User'. Resetting for this test's content.js.");
      anchor.textContent = "Hello @testuser, welcome!"; // Reset text
      if (anchor.hasAttribute('data-ghu-processed')) {
        anchor.removeAttribute('data-ghu-processed'); // Remove marker
      }
    } else if (anchor.textContent !== "Hello @testuser, welcome!") {
      // If it's something else entirely, that's an unexpected state.
      // console.error(`Fallback Test: Anchor text was UNEXPECTED: ${anchor.textContent}. Resetting.`);
      anchor.textContent = "Hello @testuser, welcome!";
      if (anchor.hasAttribute('data-ghu-processed')) {
        anchor.removeAttribute('data-ghu-processed');
      }
    }


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
    expect(anchor.getAttribute('data-ghu-processed')).toBe('true');
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
    expect(anchor.getAttribute('data-ghu-processed')).toBe('true');
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
    expect(anchor.getAttribute('data-ghu-processed')).toBe('true');
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

  test('running the script twice on the same anchor duplicates inner username', async () => {
    // 1) Stub fetch to return Paul "TBBle" Hampson
    // Ensure this mock is a jest.fn() so its calls can be tracked if needed for this specific test.
    const tbbleFetchMock = jest.fn(() =>
      Promise.resolve({
        ok: true,
        text: () =>
          Promise.resolve(
            '<html><body><div class="vcard-fullname">Paul "TBBle" Hampson</div></body></html>'
          ),
      })
    );
    global.fetch = tbbleFetchMock;
  
    // 2) Create an anchor to be processed
    const anchor = document.createElement('a');
    anchor.setAttribute('data-hovercard-url', '/users/TBBle');
    anchor.textContent = 'Hello @TBBle!';
    document.body.appendChild(anchor);
  
    // 3) First load – should replace cleanly once
    require('../content.js');
    await flushPromises();
    await new Promise(r => setTimeout(r, 0));
    expect(anchor.textContent).toBe('Hello @Paul "TBBle" Hampson!');
    expect(anchor.getAttribute('data-ghu-processed')).toBe('true'); // Check marker

    const fetchCallsBeforeSecondLoad = tbbleFetchMock.mock.calls.length;
    const sendMessageCallsBeforeSecondLoad = global.chrome.runtime.sendMessage.mock.calls.length;

    // 4) Reset modules & load again on the same DOM
    jest.resetModules();

    // Re-establish necessary mocks after reset
    global.fetch = tbbleFetchMock; // Crucial: re-use the same mock instance for fetch

    // Store the original sendMessage mock implementation to re-apply it if necessary
    // or create a new one for the second pass. For this test, a fresh spy is fine.
    const newSendMessageMock = jest.fn(msg => {
      if (msg.type === "acquireLock") return Promise.resolve({ acquired: true });
      if (msg.type === "releaseLock") return Promise.resolve({ success: true });
      return Promise.resolve({});
    });

    global.chrome = {
      storage: {
        local: {
          get: jest.fn((keys, callback) => {
            // Simulate cache for TBBle already exists from first run if needed,
            // or empty if we want to test re-fetch attempt (which should be skipped by marker)
            // For this test, the marker should prevent even a cache lookup for TBBle for re-processing.
            // The displayNames map in content.js will be empty after resetModules.
            callback({ githubDisplayNameCache: { /* simulate TBBle potentially cached by background */ } });
          }),
          set: jest.fn((obj, callback) => {
            callback();
          }),
        },
      },
      runtime: {
        sendMessage: newSendMessageMock,
      },
    };
    // location.hostname should persist, but ensure if issues: global.location = { hostname: "github.com" };


    require('../content.js');
    await flushPromises();
    await new Promise(r => setTimeout(r, 0));
  
    // 5) Confirm no runaway duplication
    expect(anchor.textContent).toBe('Hello @Paul "TBBle" Hampson!');
  });

  describe("GitHub Projects Elements", () => {
    test("should update username in H3 and avatar alt (primary traversal)", async () => {
      const { avatar, heading } = setupPrimaryDOM("projectUser1", "h3");

      require("../content.js");
      await flushPromises();

      expect(heading.textContent).toBe("Project User One");
      expect(avatar.getAttribute("alt")).toBe("Project User One");
      expect(heading.getAttribute('data-ghu-processed')).toBe('true');
    });

    test("should update username in H4 and avatar alt (primary traversal, different heading)", async () => {
      const { avatar, heading } = setupPrimaryDOM("projectUser2", "h4");

      require("../content.js");
      await flushPromises();

      expect(heading.textContent).toBe("Project User Two");
      expect(avatar.getAttribute("alt")).toBe("Project User Two");
      expect(heading.getAttribute('data-ghu-processed')).toBe('true');
    });

    test("should update username using closest('li') fallback", async () => {
      document.body.innerHTML = `
        <ul>
          <li class="list-item-generic">
            <div> <!-- Some other structure not matching primary -->
              <img data-testid="github-avatar" alt="projectUser1" src="#" />
              <h2>projectUser1</h2> <!-- Username in an H2 -->
            </div>
            <span>Some other text</span>
          </li>
        </ul>
      `;
      const avatar = document.querySelector('img[data-testid="github-avatar"]');
      const heading = document.querySelector('h2');

      require("../content.js");
      await flushPromises();

      expect(heading.textContent).toBe("Project User One");
      expect(avatar.getAttribute("alt")).toBe("Project User One");
      expect(heading.getAttribute('data-ghu-processed')).toBe('true');
    });

    test("should update username using 'up 3 parents' fallback", async () => {
      document.body.innerHTML = `
        <div class="grandparent">
          <div class="parent">
            <span class="sibling-of-icon-wrapper">
                <img data-testid="github-avatar" alt="projectUser2" src="#" />
            </span>
            <!-- No nextElementSibling for primary, no LI for secondary -->
          </div>
          <div class="uncle-contains-heading">
             <h5>projectUser2</h5>
          </div>
        </div>
      `;
      // To make this test more specific for the "up 3 parents" (avatar -> span -> div.parent -> div.grandparent then querySelector)
      // we ensure the heading is NOT a sibling or direct child in a way the other strategies would pick up.
      // The H5 is within div.uncle-contains-heading, which is a child of div.grandparent.

      const avatar = document.querySelector('img[data-testid="github-avatar"]');
      const heading = document.querySelector('h5');

      // Manually adjust structure so heading is found by 3rd fallback
      // avatar.parentElement (span) -> parentElement (div.parent) -> parentElement (div.grandparent)
      // Then querySelector('h1,h2,h3,h4,h5,h6') should find the h5

      require("../content.js");
      await flushPromises();

      expect(heading.textContent).toBe("Project User Two");
      expect(avatar.getAttribute("alt")).toBe("Project User Two");
      expect(heading.getAttribute('data-ghu-processed')).toBe('true');
    });


    test.skip("should update username in span[aria-label]", async () => {
      const span = document.createElement("span");
      span.setAttribute("aria-label", "projectUser3");
      document.body.appendChild(span);

      require("../content.js");
      await flushPromises();

      expect(span.getAttribute("aria-label")).toBe("Project User Three");
      expect(span.getAttribute('data-ghu-processed')).toBe('true');
    });

    test("should update dynamically added project items (MutationObserver, primary traversal)", async () => {
      require("../content.js"); // Load content.js first to set up observer

      const dynamicContentContainer = document.createElement("div");
      document.body.appendChild(dynamicContentContainer); // Parent for MO to observe

      // Dynamically add the structured element
      // Similar to setupPrimaryDOM but inline for dynamic addition
      const projectItemRoot = document.createElement("div");
      projectItemRoot.innerHTML = `
        <div class="leading-visual-wrapper-generic">
          <div class="icon-wrapper-generic">
            <img data-testid="github-avatar" alt="projectUser1" src="#" />
          </div>
        </div>
        <div class="main-content-wrapper-generic">
          <h3>projectUser1</h3>
        </div>
      `;
      dynamicContentContainer.appendChild(projectItemRoot);

      const avatar = projectItemRoot.querySelector('img[data-testid="github-avatar"]');
      const h3 = projectItemRoot.querySelector('h3');

      await flushPromises();
      await new Promise(r => setTimeout(r, 50)); // Additional small delay for MutationObserver

      expect(h3.textContent).toBe("Project User One");
      expect(avatar.getAttribute("alt")).toBe("Project User One");
      expect(h3.getAttribute('data-ghu-processed')).toBe('true');
    });

    test("should not process 'No Assignees' in H3 (primary traversal) and not call fetch", async () => {
      const { avatar, heading } = setupPrimaryDOM("No Assignees", "h3");
      // Set avatar alt to empty as it might be for "No Assignees"
      avatar.setAttribute("alt", "");

      const fetchSpy = global.fetch;

      require("../content.js");
      await flushPromises();

      expect(heading.textContent).toBe("No Assignees");
      expect(heading.hasAttribute('data-ghu-processed')).toBe(false);

      let calledForNoAssignees = false;
      for (const call of fetchSpy.mock.calls) {
        if (call[0].includes("/No%20Assignees") || call[0].includes("/No Assignees")) {
          calledForNoAssignees = true;
          break;
        }
      }
      expect(calledForNoAssignees).toBe(false);
      let sendMessageForNoAssignees = false;
      for (const call of global.chrome.runtime.sendMessage.mock.calls) {
        if (call[0].type === 'acquireLock' && call[0].username === 'No Assignees') {
          sendMessageForNoAssignees = true;
          break;
        }
      }
      expect(sendMessageForNoAssignees).toBe(false);
    });
  });

  describe("Idempotency and Marker Tests", () => {
    test("data-ghu-processed attribute should prevent re-processing (primary traversal)", async () => {
      const { heading } = setupPrimaryDOM("projectUser1", "h3");
      heading.setAttribute("data-ghu-processed", "true"); // Mark as already processed

      const fetchSpy = global.fetch;
      const sendMessageSpy = global.chrome.runtime.sendMessage;

      require("../content.js");
      await flushPromises();

      expect(heading.textContent).toBe("projectUser1"); // Content should remain unchanged

      let calledForProjectUser1 = false;
      for (const call of fetchSpy.mock.calls) {
        if (call[0].includes("/projectUser1")) {
          calledForProjectUser1 = true;
          break;
        }
      }
      expect(calledForProjectUser1).toBe(false);

      let sendMessageForProjectUser1 = false;
      for (const call of sendMessageSpy.mock.calls) {
        if (call[0].type === 'acquireLock' && call[0].username === 'projectUser1') {
          sendMessageForProjectUser1 = true;
          break;
        }
      }
      expect(sendMessageForProjectUser1).toBe(false);
    });
  });

  describe("GitHub Projects Status Keyword Handling", () => {
    const KNOWN_STATUS_KEYWORDS = ["Done", "Ready", "Blocked", "In Progress", "No Status"];

    // Helper function to create a DOM structure for status keyword tests with an avatar
    function setupStatusDOMWithAvatar(keyword, headingTag = 'h3') {
      document.body.innerHTML = `
        <div class="item-container-generic"> <!-- Simulating a generic root -->
          <div class="leading-visual-wrapper-generic"> <!-- Simulating leadingVisualWrapper -->
            <div class="icon-wrapper-generic"> <!-- Simulating iconWrapper -->
              <img data-testid="github-avatar" alt="${keyword}" src="#" />
            </div>
          </div>
          <div class="main-content-wrapper-generic"> <!-- Simulating mainContentWrapper (nextElementSibling) -->
            <${headingTag}>${keyword}</${headingTag}>
          </div>
        </div>
      `;
      return {
        avatar: document.querySelector('img[data-testid="github-avatar"]'),
        heading: document.querySelector(headingTag),
      };
    }

    KNOWN_STATUS_KEYWORDS.forEach(keyword => {
      test(`should NOT process H3 with status keyword "${keyword}" (no avatar structure)`, async () => {
        // This test structure remains the same as it's about *no avatar*
        document.body.innerHTML = `
          <div class="item-container-generic-status-no-avatar">
            <div class="leading-visual-wrapper-generic-status">
              <div class="icon-wrapper-generic-status-icon">
                <div class="some-status-icon-class"></div>
              </div>
            </div>
            <div class="main-content-wrapper-generic-status">
              <h3>${keyword}</h3>
            </div>
          </div>
        `;
        const h3Element = document.body.querySelector('h3');
        const fetchSpy = global.fetch;

        require('../content.js');
        await flushPromises();

        expect(h3Element.textContent).toBe(keyword);
        expect(h3Element.hasAttribute('data-ghu-processed')).toBe(false);

        let calledForKeyword = false;
        for (const call of fetchSpy.mock.calls) {
          if (call[0].includes(`/${keyword}`)) {
            calledForKeyword = true;
            break;
          }
        }
        expect(calledForKeyword).toBe(false);
      });

      test(`should process H3 with keyword "${keyword}" as username IF avatar is present (primary traversal)`, async () => {
        const { avatar, heading } = setupStatusDOMWithAvatar(keyword, "h3");
        const fetchSpy = global.fetch;
        const expectedDisplayName = mockDisplayNames[keyword]; // Get the expected display name

        require('../content.js');
        await flushPromises();

        expect(heading.textContent).toBe(expectedDisplayName);
        expect(avatar.getAttribute("alt")).toBe(expectedDisplayName);
        expect(heading.hasAttribute('data-ghu-processed')).toBe(true);

        let calledForKeyword = false;
        for (const call of fetchSpy.mock.calls) {
          // Check if the URL matches the keyword, considering URL encoding for spaces
          if (decodeURIComponent(call[0]).includes(`/${keyword}`)) {
            calledForKeyword = true;
            break;
          }
        }
        expect(calledForKeyword).toBe(true);
      });
    });
  });

  describe('processSingleUserGridCell', () => {
    test('Basic Replacement: should update alt and span for a single user', async () => {
      const { cell, img, usernameSpan } = setupGridCellDOM('gridUser1', 'single');
      require('../content.js');
      await flushPromises();
      await new Promise(r => setTimeout(r, 0)); // Ensure all microtasks and fetch callbacks complete

      expect(img.alt).toBe('@Grid User One'); // As per processSingleUserGridCell logic
      expect(usernameSpan.textContent).toBe('Grid User One');
      expect(cell.hasAttribute('data-ghu-processed')).toBe(true);
    });

    test('Already Processed: should not re-process if data-ghu-processed is true', async () => {
      const { cell, img, usernameSpan } = setupGridCellDOM('gridUser1', 'single');
      cell.setAttribute('data-ghu-processed', 'true');

      const fetchSpy = jest.spyOn(global, 'fetch');

      require('../content.js');
      await flushPromises();

      expect(img.alt).toBe('gridUser1'); // Should remain original
      expect(usernameSpan.textContent).toBe('gridUser1'); // Should remain original

      // Check if fetch was called for 'gridUser1'
      let calledForGridUser1 = false;
      for (const call of fetchSpy.mock.calls) {
        if (call[0].includes('/gridUser1')) {
          calledForGridUser1 = true;
          break;
        }
      }
      expect(calledForGridUser1).toBe(false);
      fetchSpy.mockRestore();
    });

    test('Dynamic Addition (MutationObserver): should process dynamically added single user cells', async () => {
      require('../content.js'); // Load content.js first to set up observer

      // The setupGridCellDOM appends to document.body, which should be observed
      const { img, usernameSpan } = setupGridCellDOM('gridUser2', 'single');

      await flushPromises();
      await new Promise(r => setTimeout(r, 50)); // Allow MO time

      expect(img.alt).toBe('@Grid User Two');
      expect(usernameSpan.textContent).toBe('Grid User Two');
    });

    test('Username with leading "@": should correctly update alt and span', async () => {
      const { img, usernameSpan } = setupGridCellDOM('@gridUser1', 'single');
      // Initial state: img.alt is "@gridUser1", usernameSpan.textContent is "@gridUser1"

      require('../content.js');
      await flushPromises();
      await new Promise(r => setTimeout(r, 0));

      // processSingleUserGridCell extracts username as 'gridUser1' from '@gridUser1' alt.
      // Then, img.alt becomes '@' + 'Grid User One'.
      expect(img.alt).toBe('@Grid User One');
      // updateTextNodes replaces '@gridUser1' with '@Grid User One' in the span.
      expect(usernameSpan.textContent).toBe('@Grid User One');
    });
  });

  describe('processMultiUserGridCell', () => {
    test('Basic Multi-User (3 users): should update alts and text span', async () => {
      const users = ['gridUser1', 'gridUser2', 'gridUser3'];
      const { cell, avatarImgs, usernamesTextSpan } = setupGridCellDOM(users, 'multi');

      require('../content.js');
      await flushPromises();
      await new Promise(r => setTimeout(r, 0));

      expect(avatarImgs[0].alt).toBe('@Grid User One');
      expect(avatarImgs[1].alt).toBe('@Grid User Two');
      expect(avatarImgs[2].alt).toBe('@Grid User Three');
      expect(usernamesTextSpan.textContent).toBe('Grid User One, Grid User Two, and Grid User Three');
      expect(cell.hasAttribute('data-ghu-processed')).toBe(true);
    });

    test('Multi-User (2 users): should update alts and text span correctly', async () => {
      const users = ['gridUser1', 'gridUser2'];
      const { avatarImgs, usernamesTextSpan } = setupGridCellDOM(users, 'multi');

      require('../content.js');
      await flushPromises();
      await new Promise(r => setTimeout(r, 0));

      expect(avatarImgs[0].alt).toBe('@Grid User One');
      expect(avatarImgs[1].alt).toBe('@Grid User Two');
      expect(usernamesTextSpan.textContent).toBe('Grid User One and Grid User Two');
    });

    test('Multi-User (1 user in multi-cell structure): should update alt and text span', async () => {
      const users = ['gridUser1'];
      const { avatarImgs, usernamesTextSpan } = setupGridCellDOM(users, 'multi');

      require('../content.js');
      await flushPromises();
      await new Promise(r => setTimeout(r, 0));

      expect(avatarImgs[0].alt).toBe('@Grid User One');
      expect(usernamesTextSpan.textContent).toBe('Grid User One');
    });

    test('Already Processed (Multi-User): should not re-process', async () => {
      const users = ['gridUser1', 'gridUser2'];
      const { cell, avatarImgs, usernamesTextSpan } = setupGridCellDOM(users, 'multi');
      cell.setAttribute('data-ghu-processed', 'true');

      const initialAltUser1 = avatarImgs[0].alt;
      const initialAltUser2 = avatarImgs[1].alt;
      const initialText = usernamesTextSpan.textContent;

      const fetchSpy = jest.spyOn(global, 'fetch');
      require('../content.js');
      await flushPromises();

      expect(avatarImgs[0].alt).toBe(initialAltUser1);
      expect(avatarImgs[1].alt).toBe(initialAltUser2);
      expect(usernamesTextSpan.textContent).toBe(initialText);

      let calledForAnyUser = false;
      for (const call of fetchSpy.mock.calls) {
        if (users.some(user => call[0].includes(`/${user}`))) {
          calledForAnyUser = true;
          break;
        }
      }
      expect(calledForAnyUser).toBe(false);
      fetchSpy.mockRestore();
    });

    test('Dynamic Addition (Multi-User): should process dynamically added cells', async () => {
      require('../content.js'); // Load content.js first

      const users = ['gridUser2', 'gridUser3'];
      // setupGridCellDOM appends to document.body, which is observed
      const { avatarImgs, usernamesTextSpan } = setupGridCellDOM(users, 'multi');

      await flushPromises();
      await new Promise(r => setTimeout(r, 50)); // Allow MO time

      expect(avatarImgs[0].alt).toBe('@Grid User Two');
      expect(avatarImgs[1].alt).toBe('@Grid User Three');
      expect(usernamesTextSpan.textContent).toBe('Grid User Two and Grid User Three');
    });
  });

  describe('processBoardGroupHeader', () => {
    test('Basic Replacement: should update avatar, username span, and tooltips', async () => {
      const { avatarImg, usernameSpan, tooltipCollapse, tooltipActions, headerContentBlock } = setupBoardGroupHeaderDOM('boardUser1');
      const processedContainer = headerContentBlock.parentElement; // This is innerMimicDiv in the helper

      require('../content.js');
      await flushPromises();
      await new Promise(r => setTimeout(r, 0));

      expect(avatarImg.alt).toBe('@Board User One');
      expect(usernameSpan.textContent).toBe('Board User One');
      expect(tooltipCollapse.textContent).toBe('Collapse group Board User One');
      expect(tooltipActions.textContent).toBe('Actions for group: Board User One');
      expect(processedContainer.hasAttribute('data-ghu-processed')).toBe(true);
    });

    test('Already Processed: should not re-process if container is marked', async () => {
      const { avatarImg, usernameSpan, tooltipCollapse, tooltipActions, headerContentBlock } = setupBoardGroupHeaderDOM('boardUser1');
      const processedContainer = headerContentBlock.parentElement;
      processedContainer.setAttribute('data-ghu-processed', 'true');

      const originalAlt = avatarImg.alt;
      const originalUsernameText = usernameSpan.textContent;
      const originalCollapseTooltip = tooltipCollapse.textContent;
      const originalActionsTooltip = tooltipActions.textContent;

      const fetchSpy = jest.spyOn(global, 'fetch');
      require('../content.js');
      await flushPromises();

      expect(avatarImg.alt).toBe(originalAlt);
      expect(usernameSpan.textContent).toBe(originalUsernameText);
      expect(tooltipCollapse.textContent).toBe(originalCollapseTooltip);
      expect(tooltipActions.textContent).toBe(originalActionsTooltip);

      let calledForBoardUser1 = false;
      for (const call of fetchSpy.mock.calls) {
        if (call[0].includes('/boardUser1')) {
          calledForBoardUser1 = true;
          break;
        }
      }
      expect(calledForBoardUser1).toBe(false);
      fetchSpy.mockRestore();
    });

    test('Dynamic Addition: should process dynamically added board group headers', async () => {
      require('../content.js'); // Load content.js first

      // setupBoardGroupHeaderDOM appends to document.body, which is observed
      const { avatarImg, usernameSpan, tooltipCollapse, tooltipActions, headerContentBlock } = setupBoardGroupHeaderDOM('boardUser1');
      const processedContainer = headerContentBlock.parentElement;


      await flushPromises();
      await new Promise(r => setTimeout(r, 50)); // Allow MO time

      expect(avatarImg.alt).toBe('@Board User One');
      expect(usernameSpan.textContent).toBe('Board User One');
      expect(tooltipCollapse.textContent).toBe('Collapse group Board User One');
      expect(tooltipActions.textContent).toBe('Actions for group: Board User One');
      expect(processedContainer.hasAttribute('data-ghu-processed')).toBe(true);
    });

    test('Tooltip Not Updated if Username Absent: only relevant tooltips change', async () => {
      const { avatarImg, usernameSpan, tooltipCollapse, tooltipActions } = setupBoardGroupHeaderDOM('boardUser1');

      const originalCollapseText = "Collapse group someOtherText";
      tooltipCollapse.textContent = originalCollapseText; // Username 'boardUser1' is not in this tooltip

      require('../content.js');
      await flushPromises();
      await new Promise(r => setTimeout(r, 0));

      expect(avatarImg.alt).toBe('@Board User One');
      expect(usernameSpan.textContent).toBe('Board User One');
      expect(tooltipCollapse.textContent).toBe(originalCollapseText); // Should remain unchanged
      expect(tooltipActions.textContent).toBe('Actions for group: Board User One'); // Should be updated
    });
  });
});
