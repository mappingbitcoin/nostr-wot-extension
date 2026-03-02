# Crypto Library -- `lib/crypto/`

Pure JavaScript implementations with no external dependencies. All cryptographic primitives are implemented from scratch using the Web Crypto API where available (PBKDF2, AES-GCM, HMAC-SHA512) and manual implementations where needed (secp256k1, Schnorr).

| File | Purpose |
|------|---------|
| `secp256k1.ts` | Elliptic curve operations on the secp256k1 curve. MSB-first windowed scalar multiplication for `scalarMulG`. Point addition, doubling, and public key derivation (`getPublicKey`). |
| `schnorr.ts` | BIP-340 Schnorr signature creation and verification. Used by NIP-01 for event signing. |
| `nip01.ts` | Nostr event ID computation (SHA-256 of serialized `[0, pubkey, created_at, kind, tags, content]`) and event signing via Schnorr. |
| `nip04.ts` | NIP-04 legacy encrypted direct messages. AES-256-CBC with a shared secret derived from ECDH on secp256k1. **Error normalization**: decrypt failures produce a generic `"Decryption failed"` message to prevent padding oracle attacks. |
| `nip44.ts` | NIP-44 v2 encryption. ChaCha20 stream cipher + HMAC-SHA256 authentication. Uses `hkdfExpand` (not full HKDF) for message key derivation. |
| `nip49.ts` | NIP-49 encrypted private key format (`ncryptsec`). Encode/decode with password-based encryption. **Zeroing**: input `privkeyBytes` are zeroed after encode; decrypted bytes are zeroed after hex extraction. |
| `bip32.ts` | Hierarchical deterministic key derivation (BIP-32). HMAC-SHA512 based. Master key from seed via `HMAC-SHA512(key="Bitcoin seed", data=seed)`. Supports both hardened (index >= 0x80000000) and non-hardened child derivation. Exports `NIP06_PATH = "m/44'/1237'/0'/0/0"`. |
| `bip39.ts` | Mnemonic generation from 128-bit entropy (12 words) and seed derivation via PBKDF2-SHA512 (2048 iterations, salt `"mnemonic" + passphrase`). |
| `bech32.ts` | Bech32 and bech32m encoding/decoding for Nostr entities: `npubEncode`, `npubDecode`, `nsecEncode`, `nsecDecode`. |
| `bip39-wordlist.js` | BIP-39 English wordlist (2048 words). Plain JS, no TypeScript needed. |
| `utils.ts` | Hex-to-bytes and bytes-to-hex conversion utilities (`hexToBytes`, `bytesToHex`). |
