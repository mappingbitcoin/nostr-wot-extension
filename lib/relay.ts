/**
 * liveQuery — streaming relay utility for progressive profile loading.
 *
 * Async generator that yields LiveEvent items as they arrive from
 * local cache and relay WebSocket connections.
 * @module lib/relay
 */

import browser from './browser.ts';
import type { SignedEvent, NostrFilter, LiveEvent, LiveQueryOptions } from './types.ts';

// ── Helpers ──

export function isReplaceable(kind: number): boolean {
  return kind === 0 || kind === 3 ||
    (kind >= 10000 && kind <= 19999) ||
    (kind >= 30000 && kind <= 39999);
}

export function replaceableKey(kind: number, pubkey: string): string {
  return `nostr_r_${kind}_${pubkey}`;
}

export function generateSubId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return 'lq' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// ── Local cache ──

export async function readLocalCache(filters: NostrFilter[]): Promise<SignedEvent[]> {
  const results: SignedEvent[] = [];
  const keys: string[] = [];

  for (const f of filters) {
    if (!f.kinds || !f.authors) continue;
    for (const kind of f.kinds) {
      if (!isReplaceable(kind)) continue;
      for (const author of f.authors) {
        keys.push(replaceableKey(kind, author));
      }
    }
  }

  if (keys.length === 0) return results;

  const data = await browser.storage.local.get(keys) as Record<string, SignedEvent | undefined>;
  for (const key of keys) {
    const ev = data[key];
    if (ev && ev.id && ev.sig) results.push(ev);
  }
  return results;
}

export async function writeLocalCache(event: SignedEvent): Promise<void> {
  if (!isReplaceable(event.kind)) return;
  const key = replaceableKey(event.kind, event.pubkey);
  await browser.storage.local.set({ [key]: event });
}

// ── Async queue for bridging WebSocket callbacks → async generator ──

interface AsyncQueue<T> {
  push: (item: T) => void;
  pull: () => Promise<T>;
}

function createAsyncQueue<T>(): AsyncQueue<T> {
  const pending: T[] = [];
  let resolveNext: ((v: T) => void) | null = null;

  return {
    push(item: T) {
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r(item);
      } else {
        pending.push(item);
      }
    },
    pull(): Promise<T> {
      if (pending.length > 0) return Promise.resolve(pending.shift()!);
      return new Promise(r => { resolveNext = r; });
    },
  };
}

// ── liveQuery async generator ──

const RELAY_TIMEOUT_MS = 4000;

export async function* liveQuery(
  filters: NostrFilter[],
  relays: string[],
  options: LiveQueryOptions = {},
): AsyncGenerator<LiveEvent> {
  const seenIds = new Set<string>();
  const bestReplaceable = new Map<string, { event: SignedEvent; emittedId: string }>();
  let eoseCount = 0;
  const totalRelays = relays.length;
  const sockets: WebSocket[] = [];
  const queue = createAsyncQueue<LiveEvent | { type: '_done' }>();
  const createSocket = options._createSocket || ((url: string) => new WebSocket(url));

  function checkExhausted() {
    if (eoseCount >= totalRelays) {
      queue.push({ type: 'exhausted' });
    }
  }

  function processEvent(event: SignedEvent, relay: string) {
    // Dedup by event ID
    if (seenIds.has(event.id)) return;
    seenIds.add(event.id);

    // Kind 5 deletion
    if (event.kind === 5) {
      for (const tag of event.tags) {
        if (tag[0] === 'e') {
          queue.push({ type: 'delete', eventId: tag[1] });
        }
      }
      return;
    }

    if (isReplaceable(event.kind)) {
      const rKey = replaceableKey(event.kind, event.pubkey);
      const existing = bestReplaceable.get(rKey);

      if (existing) {
        if (event.created_at > existing.event.created_at) {
          const supersedes = existing.emittedId;
          bestReplaceable.set(rKey, { event, emittedId: event.id });
          queue.push({ type: 'update', event, supersedes });
        }
        // Older or equal — skip
        return;
      }

      bestReplaceable.set(rKey, { event, emittedId: event.id });
    }

    queue.push({ type: 'event', event, source: 'relay', relay });

    if (options.cache) {
      writeLocalCache(event).catch(() => {});
    }
  }

  try {
    // Phase 1: Local cache
    const cached = await readLocalCache(filters);
    for (const event of cached) {
      seenIds.add(event.id);
      if (isReplaceable(event.kind)) {
        const rKey = replaceableKey(event.kind, event.pubkey);
        bestReplaceable.set(rKey, { event, emittedId: event.id });
      }
      yield { type: 'event', event, source: 'local' };
    }

    // Phase 2: Relay connections
    if (totalRelays === 0) {
      yield { type: 'exhausted' };
      return;
    }

    const subId = generateSubId();

    for (const relay of relays) {
      let ws: WebSocket;
      try {
        ws = createSocket(relay);
      } catch {
        eoseCount++;
        checkExhausted();
        continue;
      }
      sockets.push(ws);

      const timer = setTimeout(() => {
        try { ws.close(); } catch { /* ignore */ }
        eoseCount++;
        checkExhausted();
      }, RELAY_TIMEOUT_MS);

      ws.onopen = () => {
        try {
          ws.send(JSON.stringify(['REQ', subId, ...filters]));
        } catch {
          clearTimeout(timer);
          eoseCount++;
          checkExhausted();
        }
      };

      ws.onmessage = (msg: MessageEvent) => {
        try {
          const data = JSON.parse(typeof msg.data === 'string' ? msg.data : '');
          if (!Array.isArray(data)) return;

          if (data[0] === 'EVENT' && data[2]) {
            processEvent(data[2] as SignedEvent, relay);
          } else if (data[0] === 'EOSE') {
            clearTimeout(timer);
            queue.push({ type: 'eose', relay });
            try { ws.close(); } catch { /* ignore */ }
            eoseCount++;
            checkExhausted();
          }
        } catch { /* malformed message — ignore */ }
      };

      ws.onerror = () => {
        clearTimeout(timer);
        eoseCount++;
        checkExhausted();
      };

      ws.onclose = () => {
        clearTimeout(timer);
      };
    }

    // Consume queue
    while (true) {
      const item = await queue.pull();
      if ('type' in item && item.type === '_done') return;
      const liveEvent = item as LiveEvent;
      yield liveEvent;
      if (liveEvent.type === 'exhausted' && options.closeOnExhaust) return;
    }
  } finally {
    // Cleanup: close all open sockets
    for (const ws of sockets) {
      try { ws.close(); } catch { /* ignore */ }
    }
  }
}
