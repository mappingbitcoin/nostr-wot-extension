// Re-export cross-browser compat wrapper
const browserAPI: typeof chrome =
  typeof (globalThis as Record<string, unknown>).browser !== 'undefined'
    ? (globalThis as unknown as { browser: typeof chrome }).browser
    : chrome;
export default browserAPI;
