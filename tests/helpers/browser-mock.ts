/**
 * Mock browser.storage API for testing vault, permissions, and accounts.
 * Provides in-memory storage that behaves like chrome.storage.local/sync/session.
 */

interface StorageData {
  [key: string]: any;
}

interface StorageArea {
  get(keys?: string | string[] | null): Promise<StorageData>;
  set(items: StorageData): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  clear(): Promise<void>;
  _data: () => StorageData;
  _reset: () => void;
}

function createStorageArea(): StorageArea {
  let data: StorageData = {};
  return {
    get(keys?: string | string[] | null): Promise<StorageData> {
      if (typeof keys === 'string') keys = [keys];
      if (!keys) return Promise.resolve({ ...data });
      const result: StorageData = {};
      for (const k of keys) {
        if (k in data) result[k] = data[k];
      }
      return Promise.resolve(result);
    },
    set(items: StorageData): Promise<void> {
      Object.assign(data, items);
      return Promise.resolve();
    },
    remove(keys: string | string[]): Promise<void> {
      if (typeof keys === 'string') keys = [keys];
      for (const k of keys) delete data[k];
      return Promise.resolve();
    },
    clear(): Promise<void> {
      data = {};
      return Promise.resolve();
    },
    _data: () => data,
    _reset: () => { data = {}; }
  };
}

const local = createStorageArea();
const sync = createStorageArea();
const session = createStorageArea();

const mock = {
  storage: { local, sync, session },
  runtime: {
    getURL: (path: string) => `chrome-extension://test-id/${path}`,
    id: 'test-extension-id',
    sendMessage: () => Promise.resolve(),
    onMessage: { addListener: () => {} }
  },
  action: {
    setBadgeText: () => Promise.resolve(),
    setBadgeBackgroundColor: () => Promise.resolve(),
    openPopup: () => Promise.resolve()
  },
  tabs: {
    query: () => Promise.resolve([])
  },
  windows: {
    create: () => Promise.resolve({ id: 1 }),
    remove: () => Promise.resolve(),
    onRemoved: {
      addListener: () => {},
      removeListener: () => {}
    }
  }
};

/** Reset all storage areas */
export function resetMockStorage(): void {
  local._reset();
  sync._reset();
  session._reset();
}

export default mock;
