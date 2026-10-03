// Chrome adapter: everything the panel needs from the browser. The panel never touches chrome.* directly,
// so the same UI runs in the dev harness with a fake platform.

export const platform = {
  name: 'chrome',
  fetch: (...args) => fetch(...args),

  async activeTabUrl() {
    // currentWindow = the window this side panel belongs to (lastFocusedWindow could be a DevTools window).
    // Tab URLs are visible because host_permissions cover the Salesforce domains (no "tabs" permission needed).
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.url ?? null;
  },

  async sessionId(myDomainUrl) {
    const cookie = await chrome.cookies.get({ url: myDomainUrl, name: 'sid' });
    return cookie?.value || null;
  },

  onTabChange(cb) {
    chrome.tabs.onActivated.addListener(() => cb());
    chrome.tabs.onUpdated.addListener((_id, info, tab) => { if (tab.active && (info.url || info.status === 'complete')) cb(); });
    chrome.windows?.onFocusChanged?.addListener(() => cb());
  },

  download(filename, bytes, type = 'application/zip') {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },

  version: () => chrome.runtime.getManifest().version,
};
