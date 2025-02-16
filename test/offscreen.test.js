// offscreen.test.js
describe("offscreen.js", () => {
    let listenerCallback;
  
    beforeEach(() => {
      // Reset modules so we load a fresh copy of offscreen.js for each test.
      jest.resetModules();
  
      // Create a global mock for the chrome API.
      global.chrome = {
        runtime: {
          onMessage: {
            addListener: jest.fn((callback) => {
              // Capture the callback registered by offscreen.js.
              listenerCallback = callback;
            }),
          },
        },
      };
  
      // Load offscreen.js. Adjust the path as needed.
      require("../offscreen.js");
    });
  
    test("should parse display name from valid HTML", () => {
      const message = {
        action: "parseDisplayName",
        html: '<div class="vcard-fullname"> Jane Doe </div>',
        username: "janedoe",
      };
  
      // Create a mock sendResponse function.
      const sendResponse = jest.fn();
  
      // Call the listener with our test message.
      listenerCallback(message, null, sendResponse);
  
      // Expect the sendResponse to be called with the trimmed display name.
      expect(sendResponse).toHaveBeenCalledWith({ displayName: "Jane Doe" });
    });
  
    test("should return username if no display name is found", () => {
      const message = {
        action: "parseDisplayName",
        html: '<div>No display name available</div>',
        username: "janedoe",
      };
  
      const sendResponse = jest.fn();
      listenerCallback(message, null, sendResponse);
  
      // Since no .vcard-fullname exists, it should default to the username.
      expect(sendResponse).toHaveBeenCalledWith({ displayName: "janedoe" });
    });
  });
  