const GEMINI_HOST = "gemini.google.com";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.warn("Unable to set side panel behavior", error));
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;
  setPanelForTab(tabId, tab.url);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url) setPanelForTab(tabId, tab.url);
  } catch (error) {
    console.warn("Unable to update side panel for active tab", error);
  }
});

function setPanelForTab(tabId, url) {
  let enabled = false;
  try {
    enabled = new URL(url).host === GEMINI_HOST;
  } catch {
    enabled = false;
  }

  chrome.sidePanel
    .setOptions({
      tabId,
      path: "sidepanel.html",
      enabled
    })
    .catch((error) => console.warn("Unable to set side panel options", error));
}
