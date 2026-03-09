# Nostr WoT Extension -- Documentation

## Overview

The Nostr WoT Extension is a Manifest V3 browser extension that combines an **NIP-07 Identity Provider** (signer) with a **Web of Trust Distance Checker**. It targets Chrome and Firefox, built with Vite + TypeScript + React.

---

## Documentation Index

### Core Architecture

| Document | Description |
|----------|-------------|
| [Architecture](architecture.md) | Extension structure, entry points, manifest, type system |
| [Message Flow](message-flow.md) | Page-to-background communication, validation layers, rate limiting |
| [Storage](storage.md) | IndexedDB schema, pubkey ID mapping, write buffering, graph cache |

### Identity & Security

| Document | Description |
|----------|-------------|
| [Security](security.md) | Vault encryption, key handling, MemoryVaultPayload, zeroing, error normalization |
| [Accounts](accounts.md) | Account types, registry, switching, per-account databases |
| [Signer](signer.md) | NIP-07 signing flow, permission cascade, prompt system, NIP-46 |

### Web of Trust

| Document | Description |
|----------|-------------|
| [Syncing](syncing.md) | BFS crawl, relay management, batching, abort, progress |
| [Graph & Scoring](graph-and-scoring.md) | BFS cache, O(1) lookups, scoring formula, trust levels |
| [Badges](badges.md) | WoT badge injection, site adapters, rendering pipeline |
| [Adding Badge Support](add_badge.md) | How to write a site adapter for badge injection |

### Lightning Wallet

| Document | Description |
|----------|-------------|
| [Wallet](wallet.md) | Providers (NWC/LNbits), auto-provisioning, WebLN API, permissions, BOLT11 decoder, UI |

### Configuration & Infrastructure

| Document | Description |
|----------|-------------|
| [Configuration](configuration.md) | Mode system, default config, profile metadata caching |
| [Crypto Library](crypto.md) | Pure JS crypto: secp256k1, Schnorr, NIP-04/44/49, BIP-32/39, bech32 |
| [Component Standards](component-standards.md) | Shared components, hooks, utilities, CSS patterns, import aliases |
| [Testing](testing.md) | Test runner, test files, communication test suite, infrastructure |

---

## Quick Reference

**Build**: `npm run build` (Vite + @crxjs/vite-plugin)

**Package**: `npm run package:chrome` / `npm run package:firefox` (builds + zips for store submission, see [DEPLOY.md](../DEPLOY.md))

**Test**: `./tests/run.sh` (Node.js built-in test runner + tsx)

**Key files**:
- `background.ts` -- service worker / background script (central coordinator)
- `content.ts` -- content script (ISOLATED world, message bridge)
- `inject.ts` -- page script (MAIN world, exposes `window.nostr`)
- `lib/vault.ts` -- encrypted key vault
- `lib/signer.ts` -- NIP-07 signing coordinator
- `lib/permissions.ts` -- permission cascade
- `lib/storage.ts` -- IndexedDB + graph cache
- `lib/graph.ts` -- BFS distance queries
- `lib/wallet/` -- wallet providers (NWC, LNbits), auto-provisioning, BOLT11 decoder
- `lib/types.ts` -- shared TypeScript interfaces

**Path aliases** (configured in `vite.config.ts`):
- `@components` -> `src/components`
- `@shared` -> `src/shared`
- `@lib` -> `lib`
- `@assets` -> `src/assets`
