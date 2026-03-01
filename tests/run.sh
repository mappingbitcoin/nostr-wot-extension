#!/usr/bin/env bash
# Run all tests using Node.js built-in test runner (Node 20+)
set -euo pipefail

cd "$(dirname "$0")/.."

# Crypto tests (no browser mock needed)
node --import tsx --test tests/crypto/*.test.ts

# Module tests (need browser mock for vault/permissions/accounts)
node --import tsx --import ./tests/helpers/register-mocks.ts --test tests/vault.test.ts tests/permissions.test.ts tests/accounts.test.ts tests/signer.test.ts tests/security-hardening.test.ts tests/communication.test.ts

# Badge engine tests (pure functions mirrored from IIFE, no browser mock needed)
node --import tsx --test tests/badges/engine.test.ts
