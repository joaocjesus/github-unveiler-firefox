// content.test.js
describe("content.js", () => {
    beforeEach(() => {
      // Clear the document body before each test.
      document.body.innerHTML = "";
      // Set up a minimal global.chrome API that the content script relies on.
      global.chrome = {
        runtime: {
          sendMessage: jest.fn((msg, callback) => {
            // For this test, we simply call the callback immediately.
            callback && callback({});
          }),
        },
        storage: {
          local: {
            get: jest.fn((keys, callback) => {
              // Simulate a cache that contains a valid entry for "testuser"
              callback({
                githubDisplayNameCache: {
                  [location.hostname]: {
                    testuser: {
                      displayName: "Test User",
                      timestamp: Date.now(),
                    },
                  },
                },
              });
            }),
            set: jest.fn((obj, callback) => callback()),
          },
        },
      };
    });
  
    afterEach(() => {
      jest.resetModules(); // So that the IIFE in content.js runs fresh in each test.
      document.body.innerHTML = "";
    });
  
    test("processAnchorsByText replaces '@username' with display name", (done) => {
      // Set up a simple anchor with text exactly "@testuser".
      document.body.innerHTML = `<a href="#">@testuser</a>`;
      // Load the content script so that its IIFE runs immediately.
      require("../content.js");
  
      // Wait a tick to let asynchronous functions (like fetchDisplayName) run.
      setTimeout(() => {
        const anchor = document.querySelector("a");
        expect(anchor.textContent).toContain("Test User");
        done();
      }, 50);
    });
  
    test("processAnchorsByHovercard replaces username with display name", (done) => {
      // Create an anchor with a data-hovercard-url attribute.
      document.body.innerHTML = `<a data-hovercard-url="/users/testuser">Hello, testuser!</a>`;
      require("../content.js");
  
      setTimeout(() => {
        const anchor = document.querySelector("a");
        expect(anchor.textContent).toContain("Test User");
        done();
      }, 50);
    });
  
    test("processAnchorsByHovercard skips anchors with a single span child", (done) => {
      // The content script should ignore anchors whose only child is a span with the class "AppHeader-context-item-label".
      document.body.innerHTML = `<a data-hovercard-url="/users/testuser">
        <span class="AppHeader-context-item-label">testuser</span>
      </a>`;
      require("../content.js");
  
      setTimeout(() => {
        const span = document.querySelector("span.AppHeader-context-item-label");
        // Expect that the text was not modified.
        expect(span.textContent).toBe("testuser");
        done();
      }, 50);
    });
  
    test("MutationObserver processes dynamically added nodes", (done) => {
        // Load the content script.
        require("../content.js");
      
        // Create a container so we don't remove the body the observer is attached to.
        const container = document.createElement("div");
        document.body.appendChild(container);
        
        // Dynamically add a new anchor.
        const newAnchor = document.createElement("a");
        newAnchor.textContent = "@testuser";
        container.appendChild(newAnchor);
      
        // Wait a bit for the MutationObserver to process the new node.
        setTimeout(() => {
          try {
            expect(newAnchor.textContent).toContain("Test User");
            done();
          } catch (err) {
            done(err);
          }
        }, 200);
      });
  });
  