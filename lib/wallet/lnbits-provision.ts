/**
 * LNbits auto-provisioning with challenge-response
 *
 * Two-step flow:
 *   1. GET  /api/provision/challenge → { challenge: "<hex>" }
 *   2. POST /api/provision           → { name, event: <signed-kind-27235> }
 *
 * The caller supplies a signFn that signs the challenge as a NIP-98
 * kind:27235 event. The proxy verifies signature + pubkey before
 * creating the wallet via LNbits admin API.
 *
 * @module lib/wallet/lnbits-provision
 */

import type { SignedEvent } from '../types.ts';

export const DEFAULT_LNBITS_URL = 'https://zaps.nostr-wot.com';

interface ProvisionResponse {
  id: string;
  name: string;
  adminkey: string;
  inkey: string;
  balance_msat: number;
  user: string;
  nwcUri?: string;
}

/**
 * Create a new wallet via the provisioning proxy.
 *
 * @param instanceUrl - The provisioning server base URL
 * @param walletName - Name for the new wallet (e.g. "WoT:npub1abc...")
 * @param signFn - Signs a challenge string, returns a kind:27235 SignedEvent
 * @param fetchFn - Optional fetch override for testing
 * @returns The admin key and wallet ID
 */
export async function provisionLnbitsWallet(
  instanceUrl: string,
  walletName: string,
  signFn: (challenge: string) => Promise<SignedEvent>,
  fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<{ adminKey: string; walletId: string; nwcUri?: string }> {
  const baseUrl = instanceUrl.replace(/\/+$/, '');

  // Step 1: Fetch challenge
  const challengeRes = await fetchFn(`${baseUrl}/api/provision/challenge`);
  if (!challengeRes.ok) {
    throw new Error(`Challenge request failed: ${challengeRes.status}`);
  }
  const { challenge } = (await challengeRes.json()) as { challenge: string };

  // Step 2: Sign the challenge
  const signedEvent = await signFn(challenge);

  // Step 3: Provision with signed event
  const res = await fetchFn(`${baseUrl}/api/provision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: walletName, event: signedEvent }),
  });
  if (!res.ok) {
    throw new Error(`Wallet provisioning failed: ${res.status}`);
  }
  const data = (await res.json()) as ProvisionResponse;
  return { adminKey: data.adminkey, walletId: data.id, nwcUri: data.nwcUri };
}
