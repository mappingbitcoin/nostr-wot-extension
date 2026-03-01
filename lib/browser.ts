// Cross-browser compatibility layer
// Works with both Chrome (chrome.*) and Firefox (browser.*)
// Firefox natively supports the browser.* API, Chrome needs the chrome.* API

declare const browser: typeof chrome;

const browserAPI: typeof chrome = typeof browser !== 'undefined' ? browser : chrome;

export default browserAPI;
