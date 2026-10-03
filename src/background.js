// Service worker: only opens the side panel on toolbar click. All work happens in the panel page,
// because MV3 service workers are suspended after ~30 s idle and an export can take minutes.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
