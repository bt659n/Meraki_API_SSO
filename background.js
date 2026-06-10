chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

// Cache API specification automatically on installation
chrome.runtime.onInstalled.addListener(() => {
    fetch("https://raw.githubusercontent.com/meraki/openapi/master/openapi/spec3.json")
    .then(res => res.json())
    .then(spec => chrome.storage.local.set({ 'merakiSpec': spec }))
    .catch(console.error);
});