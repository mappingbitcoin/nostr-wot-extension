/**
 * NIP-46 -- Nostr Connect Remote Signer Client
 *
 * Implements the client side of the Nostr Connect protocol, allowing the
 * extension to delegate signing to a remote bunker/signer application.
 *
 * Connection flow:
 *   1. Parse bunker URL: bunker://pubkey?relay=wss://...&secret=xxx
 *   2. Generate ephemeral keypair for communication
 *   3. Connect to relay via WebSocket
 *   4. Subscribe to kind:24133 events targeting our ephemeral pubkey
 *   5. Send requests as NIP-04 encrypted kind:24133 events to the bunker
 *   6. Receive responses as NIP-04 encrypted kind:24133 events from the bunker
 *
 * Supported remote methods:
 *   get_public_key, sign_event, nip04_encrypt, nip04_decrypt,
 *   nip44_encrypt, nip44_decrypt
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/46.md -- NIP-46: Nostr Connect
 * @see https://github.com/nostr-protocol/nips/blob/master/04.md -- NIP-04: Encryption used for NIP-46 message wrapping
 *
 * @module lib/nip46
 */

import type { Nip46ParsedUrl, Nip46PendingEntry, SignedEvent, UnsignedEvent } from './types.ts';
import { hexToBytes, bytesToHex, randomBytes } from './crypto/utils.js';
import { getPublicKey } from './crypto/secp256k1.js';
import { signEvent, verifyEvent } from './crypto/nip01.js';
import { nip04Encrypt, nip04Decrypt } from './crypto/nip04.js';
import { nip44Encrypt, nip44Decrypt } from './crypto/nip44.js';

const RECONNECT_DELAY = 3000;
const REQUEST_TIMEOUT = 300000; // 5 minutes — remote signer may need user interaction

export class Nip46Client {
  bunkerPubkey: string | null;
  relay: string;
  secret: string | null;
  connectSecret: string | null;
  localPrivkey: Uint8Array | null;
  localPubkey: string | null;
  ws: WebSocket | null;
  connected: boolean;
  subId: string | null;
  pending: Map<string, Nip46PendingEntry>;
  _reconnecting: boolean;
  _closed: boolean;
  _connectResolve: ((pubkey: string) => void) | null;
  _encryptionMethod: 'nip04' | 'nip44';

  constructor(config: { pubkey: string | null; relay: string; secret?: string | null; connectSecret?: string | null }) {
    this.bunkerPubkey = config.pubkey;        // Remote signer's pubkey
    this.relay = config.relay;                // Relay URL
    this.secret = config.secret || null;      // Connection secret (bunker:// flow)
    this.connectSecret = config.connectSecret || null; // Expected secret for nostrconnect:// flow
    this.localPrivkey = null;                 // Ephemeral keypair for communication
    this.localPubkey = null;
    this.ws = null;
    this.connected = false;
    this.subId = null;
    this.pending = new Map();                 // reqId -> { resolve, reject, timer }
    this._reconnecting = false;
    this._closed = false;
    this._connectResolve = null;              // Resolver for listenForConnect()
    this._encryptionMethod = 'nip04';         // Updated when signer's format is detected
  }

  /**
   * Parse a bunker URL into config
   * @param url - bunker://pubkey?relay=wss://...&secret=xxx
   */
  static parseUrl(url: string): Nip46ParsedUrl {
    const parsed = new URL(url);
    // Non-special schemes (bunker:) put the authority in hostname, not pathname
    const pubkey = parsed.hostname || parsed.pathname.replace('//', '');
    const relay = parsed.searchParams.get('relay');
    const secret = parsed.searchParams.get('secret');

    if (!/^[0-9a-f]{64}$/i.test(pubkey)) throw new Error('Invalid pubkey in bunker URL');
    if (!relay) throw new Error('Missing relay in bunker URL');

    return { pubkey, relay, secret };
  }

  /**
   * Build a nostrconnect:// URI for QR code display
   * @param clientPubkey - hex pubkey of the client (extension)
   * @param relay - relay URL for communication
   * @param metadata - optional client metadata (name, url, description)
   * @returns nostrconnect://clientPubkey?relay=...&metadata=...
   */
  static buildConnectUri(clientPubkey: string, relays: string | string[], metadata: Record<string, string> = {}): string {
    const params = new URLSearchParams();
    const relayList = Array.isArray(relays) ? relays : [relays];
    for (const r of relayList) params.append('relay', r);
    if (Object.keys(metadata).length > 0) params.set('metadata', JSON.stringify(metadata));
    return `nostrconnect://${clientPubkey}?${params.toString()}`;
  }

  /**
   * Initialize the client with an ephemeral keypair
   */
  async init(): Promise<void> {
    // Generate ephemeral keypair for NIP-46 communication
    this.localPrivkey = randomBytes(32);
    this.localPubkey = bytesToHex(getPublicKey(this.localPrivkey));
  }

  /**
   * Connect to the relay and subscribe
   */
  async connect(): Promise<void> {
    if (!this.localPrivkey) await this.init();

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.relay);

        this.ws.onopen = () => {
          this.connected = true;
          this._reconnecting = false;
          console.log('[NIP-46] WS connected to', this.relay);

          // Subscribe to events from the bunker targeting our ephemeral key
          this.subId = 'nip46_' + Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(16).padStart(2, '0')).join('');
          const filter = {
              kinds: [24133],
              '#p': [this.localPubkey],
              since: Math.floor(Date.now() / 1000) - 60
          };
          console.log('[NIP-46] REQ filter:', JSON.stringify(filter));
          this.ws!.send(JSON.stringify(['REQ', this.subId, filter]));

          // If we have a connect secret, send initial connect request (non-blocking)
          if (this.secret) {
            this._sendRequest('connect', [this.bunkerPubkey!, this.secret])
              .then(() => { console.log('[NIP-46] Connect ack received'); this.secret = null; })
              .catch((err) => { console.warn('[NIP-46] Connect request failed:', err.message); });
          }
          resolve();
        };

        this.ws.onmessage = (event: MessageEvent) => {
          this._handleMessage(event.data);
        };

        this.ws.onclose = (ev: CloseEvent) => {
          console.log('[NIP-46] WS closed:', ev.code, ev.reason, 'wasClean:', ev.wasClean);
          this.connected = false;
          if (!this._closed) {
            this._reconnect();
          }
        };

        this.ws.onerror = (ev: Event) => {
          console.error('[NIP-46] WS error:', ev);
          this.connected = false;
          if (!this.ws!.readyState || this.ws!.readyState === WebSocket.CONNECTING) {
            reject(new Error('WebSocket connection failed'));
          }
        };
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Listen for an incoming connect request from a remote signer.
   * Used with nostrconnect:// flow -- the signer initiates the connection.
   * @param timeout - timeout in ms
   * @returns signer's pubkey (hex)
   */
  listenForConnect(timeout: number = 120000): Promise<string> {
    console.log('[NIP-46] listenForConnect started, timeout:', timeout, 'ms, connectSecret:', this.connectSecret?.slice(0, 8) || 'null');
    return new Promise((resolve, reject) => {
      this._connectResolve = resolve;
      setTimeout(() => {
        if (this._connectResolve) {
          console.warn('[NIP-46] listenForConnect TIMED OUT after', timeout, 'ms');
          this._connectResolve = null;
          reject(new Error('Connect listen timeout'));
        }
      }, timeout);
    });
  }

  /**
   * Get the local ephemeral keypair (hex) for persistence
   */
  getLocalKeyPair(): { privkey: string; pubkey: string } {
    return {
      privkey: bytesToHex(this.localPrivkey!),
      pubkey: this.localPubkey!
    };
  }

  /**
   * Close the connection
   */
  close(): void {
    this._closed = true;
    // Zero the ephemeral private key
    if (this.localPrivkey) {
      this.localPrivkey.fill(0);
      this.localPrivkey = null;
    }
    if (this.ws) {
      if (this.subId && this.connected) {
        try { this.ws.send(JSON.stringify(['CLOSE', this.subId])); } catch {}
      }
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;

    // Clean up connect listener
    this._connectResolve = null;

    // Reject all pending
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Connection closed'));
    }
    this.pending.clear();
  }

  // -- NIP-46 methods --

  async getPublicKey(): Promise<string> {
    return this._sendRequest('get_public_key', []);
  }

  async signEventRemote(event: Partial<UnsignedEvent>): Promise<SignedEvent> {
    const result = await this._sendRequest('sign_event', [JSON.stringify(event)]);
    const signed: SignedEvent = typeof result === 'string' ? JSON.parse(result) : result;
    // Verify the bunker returned a valid signed event
    if (!signed || !signed.sig || !signed.id || !signed.pubkey) {
      throw new Error('Remote signer returned invalid event');
    }
    if (!await verifyEvent(signed)) {
      throw new Error('Remote signer returned event with invalid signature');
    }
    if (signed.kind !== event.kind) {
      throw new Error('Remote signer returned event with mismatched kind');
    }
    if (signed.content !== event.content) {
      throw new Error('Remote signer returned event with mismatched content');
    }
    return signed;
  }

  async nip04EncryptRemote(thirdPartyPubkey: string, plaintext: string): Promise<string> {
    return this._sendRequest('nip04_encrypt', [thirdPartyPubkey, plaintext]);
  }

  async nip04DecryptRemote(thirdPartyPubkey: string, ciphertext: string): Promise<string> {
    return this._sendRequest('nip04_decrypt', [thirdPartyPubkey, ciphertext]);
  }

  async nip44EncryptRemote(thirdPartyPubkey: string, plaintext: string): Promise<string> {
    return this._sendRequest('nip44_encrypt', [thirdPartyPubkey, plaintext]);
  }

  async nip44DecryptRemote(thirdPartyPubkey: string, ciphertext: string): Promise<string> {
    return this._sendRequest('nip44_decrypt', [thirdPartyPubkey, ciphertext]);
  }

  // -- Internal --

  /**
   * Decrypt event content, auto-detecting NIP-04 vs NIP-44 format.
   * NIP-04 uses `ciphertext?iv=iv` format; NIP-44 is pure base64.
   * Some implementations use `&iv=` as separator instead of `?iv=`.
   */
  async _decrypt(content: string, theirPubkey: Uint8Array): Promise<string> {
    // Detect NIP-04: look for IV separator in any common variant
    const ivMatch = content.match(/[?&]iv=/);
    if (ivMatch) {
      this._encryptionMethod = 'nip04';
      // Normalize to standard ?iv= format for our NIP-04 implementation
      const normalized = content.replace('&iv=', '?iv=');
      return nip04Decrypt(normalized, this.localPrivkey!, theirPubkey);
    }
    // Otherwise try NIP-44
    this._encryptionMethod = 'nip44';
    return nip44Decrypt(content, this.localPrivkey!, theirPubkey);
  }

  /**
   * Encrypt content using the signer's detected encryption method.
   */
  async _encrypt(content: string, theirPubkey: Uint8Array): Promise<string> {
    if (this._encryptionMethod === 'nip44') {
      return nip44Encrypt(content, this.localPrivkey!, theirPubkey);
    }
    return nip04Encrypt(content, this.localPrivkey!, theirPubkey);
  }

  async _sendRequest(method: string, params: string[]): Promise<string> {
    if (!this.connected) throw new Error('Not connected');

    const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('');
    const content = JSON.stringify({ id, method, params });

    // Encrypt to the bunker's pubkey (NIP-04 or NIP-44 based on signer's format)
    const encrypted = await this._encrypt(content, hexToBytes(this.bunkerPubkey!));

    // Create a kind 24133 event
    const event: UnsignedEvent = {
      created_at: Math.floor(Date.now() / 1000),
      kind: 24133,
      tags: [['p', this.bunkerPubkey!]],
      content: encrypted
    };

    const signed = await signEvent(event, this.localPrivkey!);
    this.ws!.send(JSON.stringify(['EVENT', signed]));

    // Wait for response
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`NIP-46 request timeout: ${method}`));
      }, REQUEST_TIMEOUT);

      this.pending.set(id, { resolve, reject, timer });
    });
  }

  async _handleMessage(raw: string): Promise<void> {
    try {
      const msg = JSON.parse(raw);
      console.log('[NIP-46] WS message:', msg[0], msg[1] || '');
      if (msg[0] !== 'EVENT' || !msg[2]) return;

      const event = msg[2] as SignedEvent;
      console.log('[NIP-46] Event kind:', event.kind, 'from:', event.pubkey?.slice(0, 12), 'tags:', JSON.stringify(event.tags));
      if (event.kind !== 24133) return;

      // Verify event signature before processing
      if (!await verifyEvent(event)) {
        console.warn('[NIP-46] Event signature verification FAILED');
        return;
      }

      // Determine the sender pubkey for decryption
      const senderPubkey = this.bunkerPubkey || event.pubkey;
      console.log('[NIP-46] Decrypting with sender:', senderPubkey.slice(0, 12), 'bunkerPubkey:', this.bunkerPubkey?.slice(0, 12) || 'null');
      console.log('[NIP-46] Content (first 80 chars):', event.content.slice(0, 80), '| length:', event.content.length, '| has ?iv=:', event.content.includes('?iv='));

      // In normal mode, only accept events from the known bunker
      if (this.bunkerPubkey && event.pubkey !== this.bunkerPubkey) {
        console.warn('[NIP-46] Rejected: event.pubkey mismatch');
        return;
      }

      // Decrypt the response using the sender's pubkey (auto-detects NIP-04 vs NIP-44)
      const decrypted = await this._decrypt(event.content, hexToBytes(senderPubkey));
      console.log('[NIP-46] Decrypted (via', this._encryptionMethod + '):', decrypted.slice(0, 200));

      const response = JSON.parse(decrypted);
      console.log('[NIP-46] Response:', JSON.stringify({ id: response.id, method: response.method, result: response.result?.toString().slice(0, 50), error: response.error, paramsLen: response.params?.length }));

      // Handle incoming connect request from signer (nostrconnect:// flow)
      if (!this.bunkerPubkey && response.method === 'connect') {
        console.log('[NIP-46] Connect request received! connectSecret set:', !!this.connectSecret, '_connectResolve set:', !!this._connectResolve);
        // Validate shared secret if one was set
        if (this.connectSecret) {
          const receivedSecret = response.params?.[1];
          if (receivedSecret !== this.connectSecret) {
            console.warn('[NIP-46] Secret mismatch! expected:', this.connectSecret.slice(0, 8) + '...', 'received:', receivedSecret?.slice(0, 8) || 'undefined');
            return;
          }
          this.connectSecret = null; // One-time use
        }
        this.bunkerPubkey = event.pubkey;
        console.log('[NIP-46] Bunker pubkey set to:', event.pubkey.slice(0, 12));
        if (this._connectResolve) {
          this._connectResolve(event.pubkey);
          this._connectResolve = null;
          console.log('[NIP-46] Connect resolved successfully');
        } else {
          console.warn('[NIP-46] _connectResolve was null -- connect event arrived before listenForConnect()?');
        }
        // Send ack back to the signer using same encryption method
        if (response.id) {
          const ackContent = JSON.stringify({ id: response.id, result: 'ack' });
          const encrypted = await this._encrypt(ackContent, hexToBytes(this.bunkerPubkey!));
          const ackEvent: UnsignedEvent = {
            created_at: Math.floor(Date.now() / 1000),
            kind: 24133,
            tags: [['p', this.bunkerPubkey!]],
            content: encrypted
          };
          const signed = await signEvent(ackEvent, this.localPrivkey!);
          if (this.connected && this.ws) {
            this.ws.send(JSON.stringify(['EVENT', signed]));
            console.log('[NIP-46] Ack sent to signer');
          }
        }
        return;
      }

      // Handle normal request/response
      const entry = this.pending.get(response.id);
      if (!entry) {
        console.warn('[NIP-46] No pending entry for response id:', response.id);
        return;
      }

      clearTimeout(entry.timer);
      this.pending.delete(response.id);

      if (response.error) {
        entry.reject(new Error(response.error));
      } else {
        entry.resolve(response.result);
      }
    } catch (err) {
      console.error('[NIP-46] _handleMessage error:', err);
    }
  }

  _reconnect(): void {
    if (this._reconnecting || this._closed) return;
    console.log('[NIP-46] Scheduling reconnect in', RECONNECT_DELAY, 'ms');
    this._reconnecting = true;

    setTimeout(() => {
      if (!this._closed) {
        this.connect().catch((err) => {
          console.error('[NIP-46] Reconnect failed:', err);
          this._reconnecting = false;
          this._reconnect();
        });
      }
    }, RECONNECT_DELAY);
  }
}
