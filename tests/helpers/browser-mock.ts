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

// storage.onChanged listener support
type ChangeListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;
const changeListeners: ChangeListener[] = [];

function fireOnChanged(changes: Record<string, { newValue?: unknown }>, area: string): void {
  for (const fn of changeListeners) {
    try { fn(changes, area); } catch { /* ignore */ }
  }
}

// Wrap set/remove/clear to fire onChanged for each storage area
function wrapWithOnChanged(area: StorageArea, areaName: string): void {
  const origSet = area.set.bind(area);
  const origRemove = area.remove.bind(area);
  const origClear = area.clear.bind(area);

  area.set = async (items: StorageData): Promise<void> => {
    await origSet(items);
    const changes: Record<string, { newValue?: unknown }> = {};
    for (const k of Object.keys(items)) changes[k] = { newValue: items[k] };
    fireOnChanged(changes, areaName);
  };
  area.remove = async (keys: string | string[]): Promise<void> => {
    await origRemove(keys);
    const arr = typeof keys === 'string' ? [keys] : keys;
    const changes: Record<string, { newValue?: unknown }> = {};
    for (const k of arr) changes[k] = {};
    fireOnChanged(changes, areaName);
  };
  area.clear = async (): Promise<void> => {
    await origClear();
    fireOnChanged({}, areaName);
  };
}

wrapWithOnChanged(local, 'local');
wrapWithOnChanged(sync, 'sync');
wrapWithOnChanged(session, 'session');

const mock = {
  storage: {
    local,
    sync,
    session,
    onChanged: {
      addListener: (fn: ChangeListener) => { changeListeners.push(fn); },
      removeListener: (fn: ChangeListener) => {
        const idx = changeListeners.indexOf(fn);
        if (idx >= 0) changeListeners.splice(idx, 1);
      },
    },
  },
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

/** Reset all storage areas and notify listeners */
export function resetMockStorage(): void {
  local._reset();
  sync._reset();
  session._reset();
  // Fire onChanged with a wildcard marker so all in-memory caches are invalidated
  fireOnChanged({ signerPermissions: {}, signerUseGlobalDefaults: {}, allowedDomains: {} }, 'local');
}

export default mock;
