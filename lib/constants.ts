/**
 * Shared constants — timeouts, rate limits, and other magic numbers.
 * @module lib/constants
 */

// ── Timeouts ──

/** Signer request timeout (2 minutes) */
export const SIGNER_REQUEST_TIMEOUT_MS = 120_000;

/** NWC wallet request timeout (1 minute) */
export const NWC_REQUEST_TIMEOUT_MS = 60_000;

/** Mute list fetch timeout */
export const MUTE_LIST_FETCH_TIMEOUT_MS = 8_000;

/** WoT API call timeout (inject.ts → content.ts) */
export const WOT_CALL_TIMEOUT_MS = 30_000;

/** NIP-07 call timeout (inject.ts → content.ts) */
export const NIP07_CALL_TIMEOUT_MS = 120_000;

/** WebLN call timeout (inject.ts → content.ts) */
export const WEBLN_CALL_TIMEOUT_MS = 120_000;

// ── Rate Limits ──

/** Background handler rate limit (per method, per second) */
export const BG_RATE_LIMIT_PER_SECOND = 50;

/** Content script rate limit (per second) */
export const CONTENT_RATE_LIMIT_PER_SECOND = 100;

// ── Crypto ──

/** PBKDF2 iterations for vault encryption */
export const PBKDF2_ITERATIONS = 210_000;

/** Minimum password length */
export const MIN_PASSWORD_LENGTH = 8;

// ── Cache ──

/** Profile metadata cache TTL (30 minutes) */
export const PROFILE_CACHE_TTL_MS = 30 * 60 * 1000;

/** Activity log max entries per domain */
export const ACTIVITY_LOG_MAX_PER_DOMAIN = 200;

/** Activity log global max entries */
export const ACTIVITY_LOG_GLOBAL_MAX = 2000;

// ── Vault ──

/** Default auto-lock timeout (15 minutes) */
export const DEFAULT_AUTO_LOCK_MS = 900_000;

/** Vault unlock polling interval */
export const VAULT_POLL_INTERVAL_MS = 500;

// ── Onboarding ──

/** Pending onboarding account TTL (5 minutes) */
export const ONBOARDING_PENDING_TTL_MS = 5 * 60 * 1000;
