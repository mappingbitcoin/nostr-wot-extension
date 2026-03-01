# Self-Review Checklist

Every code change must pass through these gates. No exceptions, no shortcuts.

## Before Writing Code

Read existing code and documentation before modifying anything.

**Always read:**
- The file you're about to modify
- Its existing tests (search `tests/` for matching filenames)

**Read based on what you're changing:**

| Changing | Read first |
|----------|-----------|
| `lib/`, `background.ts`, `content.ts`, `inject.ts` | `docs/architecture.md`, `docs/message-flow.md` |
| `lib/crypto/`, `lib/vault.ts`, `lib/signer.ts` | `docs/security.md` |
| Message handling, new RPC methods | `docs/message-flow.md` |
| `src/components/`, `src/popup/` | `docs/component-standards.md` |
| Test files or test infrastructure | `docs/testing.md` |
| Badge engine (`badges/engine.ts`) | `tests/badges/engine.test.ts` |

## After Writing Code

Complete every step before claiming work is done.

1. **Run targeted tests** — run the specific test file(s) for the area you changed.
2. **Run full suite** — `./tests/run.sh` (module tests may hang after completion due to open handles in mock — this is known, not a failure).
3. **Run the build** — `npm run build` must succeed with no errors.
4. **Verify test coverage** — every new or changed function must have a test. If none exists, write one. Work is not done until the test exists.
5. **Update documentation** — if your change alters behavior described in any `docs/` file, update that doc in the same changeset. A code change without its corresponding doc update is incomplete work. Do not defer this.

**Hard rule:** Never claim "done" or "all tests pass" without actually running the commands and reading the output. No assumptions. No "should work." Show the TAP summary or build output.

## Anti-Rationalization

These thoughts mean stop and verify:

| If you think... | Do this instead |
|-----------------|-----------------|
| "This is a small change, it won't break anything" | Run the tests. |
| "I know what this function does" | Read it. Read its tests. Then modify. |
| "The docs probably don't cover this" | Check. They probably do. |
| "I'll update the docs later" | Update them now, in this changeset. |
| "Tests pass for the file I changed" | Run the full suite. Cross-module regressions are real. |
| "This new function is simple enough it doesn't need a test" | It does. Write one. |
| "The build will be fine" | Run it. Verify the output. |

## Key Commands

```bash
# Targeted test (example: crypto)
node --import tsx --test tests/crypto/*.test.ts

# Targeted test (example: badge engine)
node --import tsx --test tests/badges/engine.test.ts

# Module tests (need browser mock)
node --import tsx --import ./tests/helpers/register-mocks.ts --test tests/vault.test.ts tests/permissions.test.ts tests/accounts.test.ts tests/signer.test.ts tests/security-hardening.test.ts tests/communication.test.ts

# Full suite
./tests/run.sh

# Build
npm run build
```
