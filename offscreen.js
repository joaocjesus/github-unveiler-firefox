chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'parseDisplayName') {
      // Parse the HTML using DOMParser.
      const parser = new DOMParser();
      const doc = parser.parseFromString(message.html, 'text/html');
  
      // Extract the element containing the display name.
      const el = doc.querySelector('.vcard-fullname');
      let displayName = el ? el.textContent.trim() : '';
  
      // If no display name is found, default to the username.
      if (!displayName) {
        displayName = message.username;
      }
  
      // Send the result back.
      sendResponse({ displayName });
    }
    // Returning true tells Chrome we'll respond asynchronously (if needed).
    return true;
  });
  