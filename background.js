// background.js

// Listen for clicks on the extension's browser action icon to request permission.
chrome.action.onClicked.addListener((tab) => {
  if (!tab.url) {
    console.error("No URL found for the active tab.");
    return;
  }

  let url;
  try {
    url = new URL(tab.url);
  } catch (e) {
    console.error("Invalid URL:", tab.url);
    return;
  }

  if (url.hostname.toLowerCase().includes("github")) {
    const originPattern = `${url.protocol}//${url.hostname}/*`;
    console.log("Requesting permission for", originPattern);

    // Request permission as part of a user gesture.
    chrome.permissions.request({ origins: [originPattern] }, (granted) => {
      if (granted) {
        console.log("Permission granted for", originPattern);
        injectContentScript(tab.id);
      } else {
        console.log("Permission denied for", originPattern);
      }
    });
  } else {
    console.log("This tab is not a GitHub page.");
  }
});

// Listen for tab updates to auto-inject the content script when permission is already granted.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only proceed when the tab is fully loaded.
  if (changeInfo.status === "complete" && tab.url) {
    let url;
    try {
      url = new URL(tab.url);
    } catch (e) {
      return;
    }

    // Check if the URL's hostname contains "github"
    if (url.hostname.toLowerCase().includes("github")) {
      const originPattern = `${url.protocol}//${url.hostname}/*`;
      chrome.permissions.contains({ origins: [originPattern] }, (hasPermission) => {
        if (hasPermission) {
          console.log("Auto injecting content script for", originPattern);
          injectContentScript(tabId);
        } else {
          console.log("No permission for", originPattern, "; content script not injected.");
        }
      });
    }
  }
});

// Helper function to inject the content script.
function injectContentScript(tabId) {
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    files: ["content.js"]
  }, () => {
    if (chrome.runtime.lastError) {
      console.error("Script injection failed:", chrome.runtime.lastError);
    } else {
      console.log("Content script injected into tab", tabId);
    }
  });
}
