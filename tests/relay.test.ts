import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  isReplaceable,
  replaceableKey,
  readLocalCache,
  writeLocalCache,
  liveQuery,
} from '../lib/relay.ts';
import { resetMockStorage } from './helpers/browser-mock.ts';
import type { SignedEvent, LiveEvent } from '../lib/types.ts';

// ── Helpers ──

function makeEvent(overrides: Partial<SignedEvent> = {}): SignedEvent {
  return {
    id: 'event_' + Math.random().toString(36).slice(2, 10),
    pubkey: 'aabbccdd' + '0'.repeat(56),
    kind: 0,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: '{}',
    sig: 'sig_' + Math.random().toString(36).slice(2, 10),
    ...overrides,
  };
}

/** Minimal WebSocket mock for liveQuery tests */
class MockWebSocket {
  url: string;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  readyState = 0;
  _closed = false;

  constructor(url: string) {
    this.url = url;
    // Auto-open on next microtask
    queueMicrotask(() => {
      if (!this._closed) {
        this.readyState = 1;
        this.onopen?.({} as Event);
      }
    });
  }

  send(_data: string) {}

  close() {
    this._closed = true;
    this.readyState = 3;
  }

  /** Test helper: simulate receiving a message from the relay */
  _receive(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  /** Test helper: simulate EOSE for a subscription */
  _eose(subId: string) {
    this._receive(['EOSE', subId]);
  }

  /** Test helper: simulate EVENT for a subscription */
  _event(subId: string, event: SignedEvent) {
    this._receive(['EVENT', subId, event]);
  }
}

// ── Tests ──

describe('isReplaceable', () => {
  it('returns true for kind 0 (profile metadata)', () => {
    assert.strictEqual(isReplaceable(0), true);
  });

  it('returns true for kind 3 (contact list)', () => {
    assert.strictEqual(isReplaceable(3), true);
  });

  it('returns true for kind 10002 (relay list)', () => {
    assert.strictEqual(isReplaceable(10002), true);
  });

  it('returns true for kind 30023 (long-form article)', () => {
    assert.strictEqual(isReplaceable(30023), true);
  });

  it('returns false for kind 1 (short note)', () => {
    assert.strictEqual(isReplaceable(1), false);
  });

  it('returns false for kind 7 (reaction)', () => {
    assert.strictEqual(isReplaceable(7), false);
  });

  it('returns false for kind 9735 (zap receipt)', () => {
    assert.strictEqual(isReplaceable(9735), false);
  });
});

describe('replaceableKey', () => {
  it('produces correct key format', () => {
    assert.strictEqual(
      replaceableKey(0, 'abc123'),
      'nostr_r_0_abc123',
    );
  });

  it('includes kind and full pubkey', () => {
    const key = replaceableKey(10002, 'deadbeef');
    assert.ok(key.includes('10002'));
    assert.ok(key.includes('deadbeef'));
  });
});

describe('readLocalCache / writeLocalCache', () => {
  beforeEach(() => resetMockStorage());

  it('round-trips a replaceable event', async () => {
    const event = makeEvent({ kind: 0, pubkey: 'aabb' + '0'.repeat(60) });
    await writeLocalCache(event);

    const results = await readLocalCache([{ kinds: [0], authors: ['aabb' + '0'.repeat(60)] }]);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].id, event.id);
  });

  it('returns empty for non-replaceable kinds', async () => {
    const event = makeEvent({ kind: 1 });
    await writeLocalCache(event);

    const results = await readLocalCache([{ kinds: [1], authors: [event.pubkey] }]);
    assert.strictEqual(results.length, 0);
  });

  it('returns empty when no match', async () => {
    const results = await readLocalCache([{ kinds: [0], authors: ['nonexistent'] }]);
    assert.strictEqual(results.length, 0);
  });

  it('handles multiple authors', async () => {
    const e1 = makeEvent({ kind: 0, pubkey: 'pk1_' + '0'.repeat(60) });
    const e2 = makeEvent({ kind: 0, pubkey: 'pk2_' + '0'.repeat(60) });
    await writeLocalCache(e1);
    await writeLocalCache(e2);

    const results = await readLocalCache([{
      kinds: [0],
      authors: ['pk1_' + '0'.repeat(60), 'pk2_' + '0'.repeat(60)],
    }]);
    assert.strictEqual(results.length, 2);
  });
});

describe('liveQuery', () => {
  beforeEach(() => resetMockStorage());

  it('yields cached events first, then relay events, then exhausted', async () => {
    const pk = 'lqpk' + '0'.repeat(60);
    const cachedEvent = makeEvent({ kind: 0, pubkey: pk, created_at: 1000 });
    await writeLocalCache(cachedEvent);

    const relayEvent = makeEvent({ kind: 0, pubkey: pk, created_at: 2000, id: 'relay_ev_1' });

    let ws: MockWebSocket | null = null;
    const gen = liveQuery(
      [{ kinds: [0], authors: [pk] }],
      ['wss://relay.test'],
      {
        closeOnExhaust: true,
        _createSocket: (url: string) => {
          ws = new MockWebSocket(url);
          // Send event + EOSE after open
          const origOnOpen = ws.onopen;
          const socket = ws;
          queueMicrotask(() => {
            // Wait for liveQuery to attach handlers
            setTimeout(() => {
              socket._event('lq000000000000', relayEvent);
              socket._eose('lq000000000000');
            }, 10);
          });
          return ws as unknown as WebSocket;
        },
      },
    );

    const events: LiveEvent[] = [];
    for await (const ev of gen) {
      events.push(ev);
      if (ev.type === 'exhausted') break;
    }

    // Should have: cached event (local), relay update (supersedes), eose, exhausted
    assert.ok(events.length >= 3, `Expected >= 3 events, got ${events.length}`);

    const localEvents = events.filter(e => e.type === 'event' && e.source === 'local');
    assert.strictEqual(localEvents.length, 1, 'Should have 1 local cache event');

    // The relay event with higher created_at should produce an 'update' since kind:0 is replaceable
    const updates = events.filter(e => e.type === 'update');
    assert.strictEqual(updates.length, 1, 'Should have 1 update event');
    if (updates[0].type === 'update') {
      assert.strictEqual(updates[0].event.id, 'relay_ev_1');
      assert.strictEqual(updates[0].supersedes, cachedEvent.id);
    }

    const exhausted = events.filter(e => e.type === 'exhausted');
    assert.strictEqual(exhausted.length, 1, 'Should have exhausted');
  });

  it('deduplicates events by ID', async () => {
    const pk = 'ddpk' + '0'.repeat(60);
    const event = makeEvent({ kind: 1, pubkey: pk, id: 'dup_event_1' });

    const gen = liveQuery(
      [{ kinds: [1], authors: [pk] }],
      ['wss://relay1.test', 'wss://relay2.test'],
      {
        closeOnExhaust: true,
        _createSocket: (url: string) => {
          const ws = new MockWebSocket(url);
          queueMicrotask(() => {
            setTimeout(() => {
              ws._event('lq000000000000', event);
              ws._eose('lq000000000000');
            }, 10);
          });
          return ws as unknown as WebSocket;
        },
      },
    );

    const events: LiveEvent[] = [];
    for await (const ev of gen) {
      events.push(ev);
      if (ev.type === 'exhausted') break;
    }

    const relayEvents = events.filter(e => e.type === 'event' && e.source === 'relay');
    assert.strictEqual(relayEvents.length, 1, 'Should deduplicate — only 1 relay event');
  });

  it('yields exhausted immediately when no relays', async () => {
    const gen = liveQuery([{ kinds: [0], authors: ['abc'] }], [], { closeOnExhaust: true });
    const events: LiveEvent[] = [];
    for await (const ev of gen) {
      events.push(ev);
      if (ev.type === 'exhausted') break;
    }
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'exhausted');
  });

  it('cleans up sockets on generator return', async () => {
    const sockets: MockWebSocket[] = [];
    const gen = liveQuery(
      [{ kinds: [0], authors: ['abc'] }],
      ['wss://relay.test'],
      {
        _createSocket: (url: string) => {
          const ws = new MockWebSocket(url);
          sockets.push(ws);
          // Don't send EOSE — keep connection open
          return ws as unknown as WebSocket;
        },
      },
    );

    // Pull one event (will be from local cache phase — likely nothing)
    // Then force-close the generator
    const iter = gen[Symbol.asyncIterator]();
    // Give time for socket to open
    await new Promise(r => setTimeout(r, 20));
    await gen.return(undefined);

    // All sockets should be closed
    for (const ws of sockets) {
      assert.strictEqual(ws._closed, true, 'Socket should be closed after generator return');
    }
  });

  it('writes to cache when cache option is true', async () => {
    const pk = 'cachepk' + '0'.repeat(56);
    const event = makeEvent({ kind: 0, pubkey: pk, created_at: 5000 });

    const gen = liveQuery(
      [{ kinds: [0], authors: [pk] }],
      ['wss://relay.test'],
      {
        closeOnExhaust: true,
        cache: true,
        _createSocket: (url: string) => {
          const ws = new MockWebSocket(url);
          queueMicrotask(() => {
            setTimeout(() => {
              ws._event('lq000000000000', event);
              ws._eose('lq000000000000');
            }, 10);
          });
          return ws as unknown as WebSocket;
        },
      },
    );

    for await (const ev of gen) {
      if (ev.type === 'exhausted') break;
    }

    // Allow cache write to complete
    await new Promise(r => setTimeout(r, 20));

    const cached = await readLocalCache([{ kinds: [0], authors: [pk] }]);
    assert.strictEqual(cached.length, 1, 'Event should be cached');
    assert.strictEqual(cached[0].id, event.id);
  });
});
