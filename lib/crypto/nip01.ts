/**
 * NIP-01 — Nostr Event ID Computation and Signing
 *
 * Implements the core Nostr event format: computing the event ID as a SHA-256
 * hash of the canonical serialization, and signing/verifying with BIP-340 Schnorr.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/01.md — NIP-01
 *
 * @module lib/crypto/nip01
 */

import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes, sha256 } from './utils.ts';
import type { UnsignedEvent, SignedEvent } from '../types.ts';

export async function computeEventId(event: UnsignedEvent): Promise<string> {
  const serialized = JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content
  ]);
  const bytes = new TextEncoder().encode(serialized);
  const hash = await sha256(bytes);
  return bytesToHex(hash);
}

export async function signEvent(event: UnsignedEvent, privkey: Uint8Array): Promise<SignedEvent> {
  const pubkey = bytesToHex(schnorr.getPublicKey(privkey));

  const signedEvent: SignedEvent = {
    ...event,
    pubkey,
    id: '',
    sig: ''
  };

  const id = await computeEventId(signedEvent);
  signedEvent.id = id;

  const sig = bytesToHex(schnorr.sign(hexToBytes(id), privkey));
  signedEvent.sig = sig;

  return signedEvent;
}

export async function verifyEvent(event: SignedEvent): Promise<boolean> {
  try {
    const expectedId = await computeEventId(event);
    if (expectedId !== event.id) return false;
    return schnorr.verify(hexToBytes(event.sig), hexToBytes(event.id), hexToBytes(event.pubkey));
  } catch {
    return false;
  }
}
