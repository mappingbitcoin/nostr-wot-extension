/**
 * NIP-49 — Encrypted Private Key (ncryptsec)
 *
 * This implementation uses PBKDF2 (210K iterations, SHA-256) instead of scrypt
 * as the KDF, since Web Crypto API doesn't support scrypt.
 * The format is: version(1) + salt(16) + iv(12) + encrypted(48) = 77 bytes
 * Encrypted with AES-256-GCM (nonce = 12-byte iv).
 *
 * Note: This is NOT interoperable with standard NIP-49 implementations
 * that use scrypt + XChaCha20-Poly1305. It is a local-only encrypted backup format.
 */

import { hexToBytes, bytesToHex } from './utils.ts';
import { bech32Encode, bech32Decode, convertBits } from './bech32.ts';

const VERSION: number = 0x01;
const PBKDF2_ITERATIONS: number = 210000;

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

/**
 * Encrypt a private key with a password and encode as ncryptsec
 */
export async function ncryptsecEncode(privkeyHex: string, password: string): Promise<string> {
    const privkeyBytes = hexToBytes(privkeyHex);
    if (privkeyBytes.length !== 32) throw new Error('Invalid private key length');

    try {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await deriveKey(password, salt);

        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key, privkeyBytes as BufferSource
        );

        // Format: version(1) + salt(16) + iv(12) + ciphertext(32+16=48)
        const payload = new Uint8Array(1 + 16 + 12 + encrypted.byteLength);
        payload[0] = VERSION;
        payload.set(salt, 1);
        payload.set(iv, 17);
        payload.set(new Uint8Array(encrypted), 29);

        const data5bit = convertBits(Array.from(payload), 8, 5, true);
        return bech32Encode('ncryptsec', data5bit!);
    } finally {
        privkeyBytes.fill(0);
    }
}

/**
 * Decrypt an ncryptsec string with a password
 */
export async function ncryptsecDecode(ncryptsec: string, password: string): Promise<string> {
    const decoded = bech32Decode(ncryptsec);
    if (!decoded || decoded.hrp !== 'ncryptsec') throw new Error('Invalid ncryptsec');

    const payload = new Uint8Array(convertBits(decoded.data, 5, 8, false)!);

    const version = payload[0];
    if (version !== VERSION) throw new Error('Unsupported ncryptsec version');

    const salt = payload.slice(1, 17);
    const iv = payload.slice(17, 29);
    const ciphertext = payload.slice(29);

    const key = await deriveKey(password, salt);

    try {
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key, ciphertext
        );
        const decryptedBytes = new Uint8Array(decrypted);
        const hex = bytesToHex(decryptedBytes);
        decryptedBytes.fill(0);
        return hex;
    } catch {
        throw new Error('Wrong password or corrupted data');
    }
}
