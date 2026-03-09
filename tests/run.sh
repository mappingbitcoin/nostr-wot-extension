#!/usr/bin/env bash
# Run all tests using Node.js built-in test runner (Node 20+)
set -euo pipefail

cd "$(dirname "$0")/.."

# Crypto tests (no browser mock needed)
node --import tsx --test tests/crypto/*.test.ts

# Wallet tests (no browser mock needed)
node --import tsx --test tests/wallet/types.test.ts tests/wallet/lnbits.test.ts tests/wallet/nwc.test.ts tests/wallet/index.test.ts tests/wallet/lnbits-provision.test.ts tests/wallet/bolt11.test.ts tests/inject-webln.test.ts

# Module + wallet tests (need browser mock for vault/permissions/accounts)
node --import tsx --import ./tests/helpers/register-mocks.ts --test tests/vault.test.ts tests/permissions.test.ts tests/accounts.test.ts tests/signer.test.ts tests/security-hardening.test.ts tests/communication.test.ts tests/wallet/permissions.test.ts tests/wallet/background-handlers.test.ts tests/vault-wallet.test.ts

# Badge engine tests (pure functions mirrored from IIFE, no browser mock needed)
node --import tsx --test tests/badges/engine.test.ts
