// Cross-browser compatibility layer
// Works with both Chrome (chrome.*) and Firefox (browser.*)
// Firefox natively supports the browser.* API, Chrome needs the chrome.* API

const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

export default browserAPI;
