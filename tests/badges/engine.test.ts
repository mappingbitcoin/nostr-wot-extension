/**
 * Badge Engine Tests — Pure Function Coverage
 *
 * The badge engine (badges/engine.ts) is an IIFE that runs in MAIN world.
 * Its pure utility functions cannot be imported directly, so we mirror them
 * here — the same pattern used in tests/communication.test.ts for content
 * script logic.
 *
 * Covered functions:
 *   - bech32Polymod, bech32HrpExpand, verifyBech32Checksum (checksum math)
 *   - validateNpub (format + checksum validation)
 *   - convertBits, bech32CreateChecksum, hexToNpub (hex → npub encoding)
 *   - normalizePubkey (npub/hex → validated npub)
 *   - normalizeConfig (v1 → v2 config migration)
 *   - scoreToColor (gradient interpolation)
 *   - buildCustomAdapters (config → runtime adapter objects)
 *
 * Cross-validation suite imports lib/crypto/bech32.ts npubEncode to confirm
 * the engine's standalone bech32 implementation agrees with the library.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

// ── Test vectors (shared with tests/crypto/bech32.test.ts) ──

const TEST_PUBKEY_HEX = 'dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659';
const ZERO_HEX = '0000000000000000000000000000000000000000000000000000000000000001';
const ALL_ZEROS_HEX = '0000000000000000000000000000000000000000000000000000000000000000';
const ALL_ONES_HEX = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

// ══════════════════════════════════════════════════════════════
// Mirrored pure functions from badges/engine.ts (IIFE internals)
// ══════════════════════════════════════════════════════════════
//
// These are exact copies of the functions inside the badge engine IIFE.
// If the production code changes, these must be updated to match.

// Lines 111-112: regex constants
const NPUB_STRICT = /^npub1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{58}$/;
const NPUB_EXTRACT = /npub1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{58}/;

// Lines 115-116: bech32 constants
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

// Lines 118-128: bech32Polymod
function bech32Polymod(values: number[]): number {
    let chk = 1;
    for (const v of values) {
        const b = chk >> 25;
        chk = ((chk & 0x1ffffff) << 5) ^ v;
        for (let i = 0; i < 5; i++) {
            if ((b >> i) & 1) chk ^= GEN[i];
        }
    }
    return chk;
}

// Lines 130-136: bech32HrpExpand
function bech32HrpExpand(hrp: string): number[] {
    const ret: number[] = [];
    for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) >> 5);
    ret.push(0);
    for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) & 31);
    return ret;
}

// Lines 138-150: verifyBech32Checksum
function verifyBech32Checksum(str: string): boolean {
    const sep = str.lastIndexOf('1');
    if (sep < 1 || sep + 7 > str.length) return false;
    const hrp = str.slice(0, sep);
    const data: number[] = [];
    for (let i = sep + 1; i < str.length; i++) {
        const c = CHARSET.indexOf(str[i]);
        if (c === -1) return false;
        data.push(c);
    }
    return bech32Polymod(bech32HrpExpand(hrp).concat(data)) === 1;
}

// Lines 158-163: validateNpub
function validateNpub(candidate: string | null | undefined): string | null {
    if (!candidate || typeof candidate !== 'string') return null;
    if (!NPUB_STRICT.test(candidate)) return null;
    if (!verifyBech32Checksum(candidate)) return null;
    return candidate;
}

// Line 167: hex pubkey regex
const HEX_PUBKEY = /^[0-9a-f]{64}$/;

// Lines 169-179: convertBits
function convertBits(data: number[], from: number, to: number, pad: boolean): number[] {
    let acc = 0, bits = 0;
    const result: number[] = [], maxv = (1 << to) - 1;
    for (const v of data) {
        acc = (acc << from) | v;
        bits += from;
        while (bits >= to) { bits -= to; result.push((acc >> bits) & maxv); }
    }
    if (pad && bits > 0) result.push((acc << (to - bits)) & maxv);
    return result;
}

// Lines 181-187: bech32CreateChecksum
function bech32CreateChecksum(hrp: string, data: number[]): number[] {
    const values = bech32HrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
    const mod = bech32Polymod(values) ^ 1;
    const result: number[] = [];
    for (let i = 0; i < 6; i++) result.push((mod >> (5 * (5 - i))) & 31);
    return result;
}

// Lines 189-198: hexToNpub
function hexToNpub(hex: string): string | null {
    const bytes: number[] = [];
    for (let i = 0; i < 64; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16));
    const data5 = convertBits(bytes, 8, 5, true);
    if (!data5) return null;
    const checksum = bech32CreateChecksum('npub', data5);
    let result = 'npub1';
    for (const d of data5.concat(checksum)) result += CHARSET[d];
    return result;
}

// Lines 204-209: normalizePubkey
function normalizePubkey(raw: string | null): string | null {
    if (!raw || typeof raw !== 'string') return null;
    if (raw.startsWith('npub1')) return validateNpub(raw);
    if (HEX_PUBKEY.test(raw)) return hexToNpub(raw);
    return null;
}

// ── Config types (mirrored from engine.ts) ──

interface StrategyConfig {
    label?: string;
    selectors: string;
    extractFrom?: string;
    insertPosition?: string;
    customCSS?: string;
    displayMode?: string;
    enabled?: boolean;
}

interface AdapterConfig {
    version?: number;
    strategies?: StrategyConfig[];
    selectors?: string;
    extractFrom?: string;
    insertPosition?: string;
    customCSS?: string;
}

// Lines 225-245: normalizeConfig
function normalizeConfig(cfg: AdapterConfig | null): { version: number; strategies: StrategyConfig[] } {
    if (!cfg) return { version: 2, strategies: [] };
    if (cfg.version === 2 && Array.isArray(cfg.strategies)) {
        if (cfg.customCSS && cfg.strategies.length > 0 && !cfg.strategies.some(s => s.customCSS)) {
            cfg.strategies[0].customCSS = cfg.customCSS;
        }
        for (const s of cfg.strategies) { if (s.customCSS == null) s.customCSS = ''; }
        return cfg as { version: number; strategies: StrategyConfig[] };
    }
    const strategies: StrategyConfig[] = [];
    if (cfg.selectors || cfg.extractFrom || cfg.insertPosition) {
        strategies.push({
            label: '',
            selectors: cfg.selectors || '',
            extractFrom: cfg.extractFrom || 'href',
            insertPosition: cfg.insertPosition || 'after',
            customCSS: cfg.customCSS || '',
        });
    }
    return { version: 2, strategies };
}

// Lines 250-280: buildCustomAdapters (simplified — no DOM insertBadge/extractPubkey)
interface TestAdapter {
    name: string;
    strategyIdx: number;
    displayMode: string | null;
    match: (hostname: string) => boolean;
    selectors: string[];
    extractFrom: string;
    insertPosition: string;
}

function buildCustomAdapters(domain: string, rawCfg: AdapterConfig): TestAdapter[] {
    const cfg = normalizeConfig(rawCfg);
    return cfg.strategies
        .filter(s => (s.selectors || '').trim() && s.enabled !== false)
        .map((strategy, idx) => {
            const sels = strategy.selectors.split('\n').map(s => s.trim()).filter(Boolean);
            return {
                name: 'custom:' + domain + ':' + idx,
                strategyIdx: idx,
                displayMode: strategy.displayMode || null,
                match: (h: string) => h.includes(domain),
                selectors: sels,
                extractFrom: strategy.extractFrom || 'href',
                insertPosition: strategy.insertPosition || 'after',
            };
        });
}

// Lines 475-497: COLOR_STOPS and scoreToColor
interface ColorStop {
    score: number;
    r: number;
    g: number;
    b: number;
}

const COLOR_STOPS: ColorStop[] = [
    { score: 0,   r: 107, g: 114, b: 128 },
    { score: 50,  r: 245, g: 158, b: 11  },
    { score: 65,  r: 234, g: 179, b: 8   },
    { score: 70,  r: 34,  g: 197, b: 94  },
    { score: 100, r: 56,  g: 189, b: 248 },
];

function scoreToColor(score: number): { r: number; g: number; b: number } {
    const s = Math.max(0, Math.min(100, score));
    let lo = COLOR_STOPS[0], hi = COLOR_STOPS[COLOR_STOPS.length - 1];
    for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
        if (s >= COLOR_STOPS[i].score && s <= COLOR_STOPS[i + 1].score) {
            lo = COLOR_STOPS[i]; hi = COLOR_STOPS[i + 1]; break;
        }
    }
    const range = hi.score - lo.score;
    const t = range === 0 ? 0 : (s - lo.score) / range;
    const r = Math.round(lo.r + (hi.r - lo.r) * t);
    const g = Math.round(lo.g + (hi.g - lo.g) * t);
    const b = Math.round(lo.b + (hi.b - lo.b) * t);
    return { r, g, b };
}

// ══════════════════════════════════════════════════════════════
// Suite 1: bech32 validation
// ══════════════════════════════════════════════════════════════

describe('badge engine: bech32 validation', () => {
    // Derive a known valid npub from the test vector hex
    const VALID_NPUB = hexToNpub(TEST_PUBKEY_HEX)!;

    it('validateNpub accepts a known valid npub', () => {
        assert.strictEqual(validateNpub(VALID_NPUB), VALID_NPUB);
    });

    it('validateNpub rejects null', () => {
        assert.strictEqual(validateNpub(null), null);
    });

    it('validateNpub rejects empty string', () => {
        assert.strictEqual(validateNpub(''), null);
    });

    it('validateNpub rejects undefined', () => {
        assert.strictEqual(validateNpub(undefined), null);
    });

    it('validateNpub rejects string without npub1 prefix', () => {
        assert.strictEqual(validateNpub('nsec1' + 'q'.repeat(58)), null);
    });

    it('validateNpub rejects npub with wrong length (too short)', () => {
        assert.strictEqual(validateNpub('npub1' + 'q'.repeat(50)), null);
    });

    it('validateNpub rejects npub with wrong length (too long)', () => {
        assert.strictEqual(validateNpub('npub1' + 'q'.repeat(60)), null);
    });

    it('validateNpub rejects npub with invalid bech32 characters', () => {
        // Uppercase and non-charset chars
        assert.strictEqual(validateNpub('npub1' + 'A'.repeat(58)), null);
        assert.strictEqual(validateNpub('npub1' + 'b'.repeat(58)), null); // 'b' not in charset
    });

    it('validateNpub rejects crafted string with corrupted checksum', () => {
        // Take a valid npub and flip the last character
        const corrupted = VALID_NPUB.slice(0, -1) + (VALID_NPUB.endsWith('q') ? 'p' : 'q');
        assert.strictEqual(validateNpub(corrupted), null);
    });

    it('verifyBech32Checksum returns true for valid bech32', () => {
        assert.strictEqual(verifyBech32Checksum(VALID_NPUB), true);
    });

    it('verifyBech32Checksum returns false for truncated input', () => {
        assert.strictEqual(verifyBech32Checksum(VALID_NPUB.slice(0, 20)), false);
    });
});

// ══════════════════════════════════════════════════════════════
// Suite 2: hexToNpub conversion
// ══════════════════════════════════════════════════════════════

describe('badge engine: hexToNpub conversion', () => {
    it('converts known hex to valid npub', () => {
        const npub = hexToNpub(TEST_PUBKEY_HEX);
        assert.ok(npub);
        assert.ok(npub!.startsWith('npub1'));
        assert.strictEqual(npub!.length, 63); // npub1 + 58 chars
    });

    it('round-trip: hexToNpub output passes validateNpub', () => {
        const npub = hexToNpub(TEST_PUBKEY_HEX)!;
        assert.strictEqual(validateNpub(npub), npub);
    });

    it('converts all-zeros hex to valid npub', () => {
        const npub = hexToNpub(ALL_ZEROS_HEX);
        assert.ok(npub);
        assert.strictEqual(validateNpub(npub), npub);
    });

    it('wrong-length hex is guarded by normalizePubkey, not hexToNpub', () => {
        // hexToNpub itself doesn't validate length (it iterates 0..62 in steps of 2).
        // Length validation happens in normalizePubkey via HEX_PUBKEY regex.
        assert.strictEqual(normalizePubkey('abcd'), null);
        assert.strictEqual(normalizePubkey(TEST_PUBKEY_HEX.slice(0, 62)), null);
    });

    it('consistent with lib/crypto/bech32 npubEncode for the same input', async () => {
        const { npubEncode } = await import('../../lib/crypto/bech32.js');
        const engineNpub = hexToNpub(TEST_PUBKEY_HEX);
        const libNpub = npubEncode(TEST_PUBKEY_HEX);
        assert.strictEqual(engineNpub, libNpub);
    });
});

// ══════════════════════════════════════════════════════════════
// Suite 3: normalizePubkey
// ══════════════════════════════════════════════════════════════

describe('badge engine: normalizePubkey', () => {
    const VALID_NPUB = hexToNpub(TEST_PUBKEY_HEX)!;

    it('returns validated npub when given a valid npub', () => {
        assert.strictEqual(normalizePubkey(VALID_NPUB), VALID_NPUB);
    });

    it('converts 64-char hex to npub', () => {
        const result = normalizePubkey(TEST_PUBKEY_HEX);
        assert.ok(result);
        assert.ok(result!.startsWith('npub1'));
        assert.strictEqual(result, VALID_NPUB);
    });

    it('returns null for null', () => {
        assert.strictEqual(normalizePubkey(null), null);
    });

    it('returns null for empty string', () => {
        assert.strictEqual(normalizePubkey(''), null);
    });

    it('returns null for invalid hex (63 chars)', () => {
        assert.strictEqual(normalizePubkey('a'.repeat(63)), null);
    });

    it('returns null for invalid hex (65 chars)', () => {
        assert.strictEqual(normalizePubkey('a'.repeat(65)), null);
    });

    it('returns null for invalid hex (non-hex chars)', () => {
        assert.strictEqual(normalizePubkey('g'.repeat(64)), null);
    });

    it('returns null for npub with bad checksum', () => {
        const corrupted = VALID_NPUB.slice(0, -1) + (VALID_NPUB.endsWith('q') ? 'p' : 'q');
        assert.strictEqual(normalizePubkey(corrupted), null);
    });

    it('returns null for nsec prefix', () => {
        assert.strictEqual(normalizePubkey('nsec1' + 'q'.repeat(58)), null);
    });

    it('returns null for nprofile prefix', () => {
        assert.strictEqual(normalizePubkey('nprofile1' + 'q'.repeat(58)), null);
    });
});

// ══════════════════════════════════════════════════════════════
// Suite 4: normalizeConfig
// ══════════════════════════════════════════════════════════════

describe('badge engine: normalizeConfig', () => {
    it('returns { version: 2, strategies: [] } for null input', () => {
        const result = normalizeConfig(null);
        assert.deepStrictEqual(result, { version: 2, strategies: [] });
    });

    it('passes through valid v2 config unchanged', () => {
        const cfg: AdapterConfig = {
            version: 2,
            strategies: [
                { selectors: '.profile-link', extractFrom: 'href', insertPosition: 'after', customCSS: '.wot-badge { color: red; }' }
            ]
        };
        const result = normalizeConfig(cfg);
        assert.strictEqual(result.version, 2);
        assert.strictEqual(result.strategies.length, 1);
        assert.strictEqual(result.strategies[0].selectors, '.profile-link');
        assert.strictEqual(result.strategies[0].customCSS, '.wot-badge { color: red; }');
    });

    it('migrates v1 config with selectors/extractFrom/insertPosition to v2', () => {
        const cfg: AdapterConfig = {
            selectors: 'a[href*="/p/"]',
            extractFrom: 'text',
            insertPosition: 'before',
        };
        const result = normalizeConfig(cfg);
        assert.strictEqual(result.version, 2);
        assert.strictEqual(result.strategies.length, 1);
        assert.strictEqual(result.strategies[0].selectors, 'a[href*="/p/"]');
        assert.strictEqual(result.strategies[0].extractFrom, 'text');
        assert.strictEqual(result.strategies[0].insertPosition, 'before');
    });

    it('uses defaults for missing extractFrom and insertPosition', () => {
        const cfg: AdapterConfig = { selectors: '.user' };
        const result = normalizeConfig(cfg);
        assert.strictEqual(result.strategies[0].extractFrom, 'href');
        assert.strictEqual(result.strategies[0].insertPosition, 'after');
    });

    it('migrates top-level customCSS into first strategy when strategies have none', () => {
        const cfg: AdapterConfig = {
            version: 2,
            strategies: [
                { selectors: '.a' },
                { selectors: '.b' }
            ],
            customCSS: '.wot-badge { font-size: 12px; }',
        };
        const result = normalizeConfig(cfg);
        assert.strictEqual(result.strategies[0].customCSS, '.wot-badge { font-size: 12px; }');
    });

    it('ensures every strategy gets a customCSS field', () => {
        const cfg: AdapterConfig = {
            version: 2,
            strategies: [
                { selectors: '.a' },
                { selectors: '.b' }
            ],
        };
        const result = normalizeConfig(cfg);
        for (const s of result.strategies) {
            assert.ok('customCSS' in s, 'Strategy should have customCSS field');
            assert.strictEqual(s.customCSS, '');
        }
    });

    it('returns empty strategies for v1 config with no selectors', () => {
        const cfg: AdapterConfig = {};
        const result = normalizeConfig(cfg);
        assert.strictEqual(result.version, 2);
        assert.deepStrictEqual(result.strategies, []);
    });
});

// ══════════════════════════════════════════════════════════════
// Suite 5: scoreToColor gradient
// ══════════════════════════════════════════════════════════════

describe('badge engine: scoreToColor gradient', () => {
    it('score 0 returns gray', () => {
        assert.deepStrictEqual(scoreToColor(0), { r: 107, g: 114, b: 128 });
    });

    it('score 100 returns light blue', () => {
        assert.deepStrictEqual(scoreToColor(100), { r: 56, g: 189, b: 248 });
    });

    it('score 50 returns orange', () => {
        assert.deepStrictEqual(scoreToColor(50), { r: 245, g: 158, b: 11 });
    });

    it('score 70 returns green', () => {
        assert.deepStrictEqual(scoreToColor(70), { r: 34, g: 197, b: 94 });
    });

    it('score 65 returns yellow', () => {
        assert.deepStrictEqual(scoreToColor(65), { r: 234, g: 179, b: 8 });
    });

    it('score below 0 clamps to gray', () => {
        assert.deepStrictEqual(scoreToColor(-50), { r: 107, g: 114, b: 128 });
    });

    it('score above 100 clamps to light blue', () => {
        assert.deepStrictEqual(scoreToColor(150), { r: 56, g: 189, b: 248 });
    });

    it('midpoint between two stops interpolates correctly', () => {
        // Midpoint between score 0 (gray) and score 50 (orange) = score 25
        // t = (25 - 0) / (50 - 0) = 0.5
        // r = round(107 + (245 - 107) * 0.5) = round(107 + 69) = 176
        // g = round(114 + (158 - 114) * 0.5) = round(114 + 22) = 136
        // b = round(128 + (11 - 128) * 0.5)  = round(128 - 58.5) = 70
        const color = scoreToColor(25);
        assert.strictEqual(color.r, 176);
        assert.strictEqual(color.g, 136);
        assert.strictEqual(color.b, 70);
    });
});

// ══════════════════════════════════════════════════════════════
// Suite 6: buildCustomAdapters
// ══════════════════════════════════════════════════════════════

describe('badge engine: buildCustomAdapters', () => {
    it('builds adapters from a v2 config with one strategy', () => {
        const cfg: AdapterConfig = {
            version: 2,
            strategies: [
                { selectors: '.profile-link\n.user-card', extractFrom: 'href', insertPosition: 'after' }
            ],
        };
        const adapters = buildCustomAdapters('example.com', cfg);
        assert.strictEqual(adapters.length, 1);
        assert.deepStrictEqual(adapters[0].selectors, ['.profile-link', '.user-card']);
    });

    it('filters out strategies with empty selectors', () => {
        const cfg: AdapterConfig = {
            version: 2,
            strategies: [
                { selectors: '' },
                { selectors: '.valid' }
            ],
        };
        const adapters = buildCustomAdapters('example.com', cfg);
        assert.strictEqual(adapters.length, 1);
        assert.strictEqual(adapters[0].selectors[0], '.valid');
    });

    it('filters out strategies with enabled: false', () => {
        const cfg: AdapterConfig = {
            version: 2,
            strategies: [
                { selectors: '.disabled', enabled: false },
                { selectors: '.enabled' }
            ],
        };
        const adapters = buildCustomAdapters('example.com', cfg);
        assert.strictEqual(adapters.length, 1);
        assert.strictEqual(adapters[0].selectors[0], '.enabled');
    });

    it('sets correct name format: custom:{domain}:{idx}', () => {
        const cfg: AdapterConfig = {
            version: 2,
            strategies: [
                { selectors: '.a' },
                { selectors: '.b' }
            ],
        };
        const adapters = buildCustomAdapters('nostr.com', cfg);
        assert.strictEqual(adapters[0].name, 'custom:nostr.com:0');
        assert.strictEqual(adapters[1].name, 'custom:nostr.com:1');
    });

    it('adapter match function checks hostname includes domain', () => {
        const cfg: AdapterConfig = {
            version: 2,
            strategies: [{ selectors: '.user' }],
        };
        const adapters = buildCustomAdapters('nostr.com', cfg);
        assert.strictEqual(adapters[0].match('www.nostr.com'), true);
        assert.strictEqual(adapters[0].match('nostr.com'), true);
        assert.strictEqual(adapters[0].match('evil.com'), false);
    });

    it('defaults extractFrom to href', () => {
        const cfg: AdapterConfig = {
            version: 2,
            strategies: [{ selectors: '.user' }],
        };
        const adapters = buildCustomAdapters('example.com', cfg);
        assert.strictEqual(adapters[0].extractFrom, 'href');
    });
});

// ══════════════════════════════════════════════════════════════
// Suite 7: cross-validation with lib/crypto/bech32
// ══════════════════════════════════════════════════════════════

describe('badge engine: cross-validation with lib/crypto/bech32', () => {
    it('hexToNpub matches npubEncode for multiple vectors', async () => {
        const { npubEncode } = await import('../../lib/crypto/bech32.js');

        for (const hex of [TEST_PUBKEY_HEX, ZERO_HEX, ALL_ZEROS_HEX]) {
            const engineResult = hexToNpub(hex);
            const libResult = npubEncode(hex);
            assert.strictEqual(engineResult, libResult, `Mismatch for hex: ${hex}`);
        }
    });

    it('validateNpub(npubEncode(hex)) always returns the npub', async () => {
        const { npubEncode } = await import('../../lib/crypto/bech32.js');

        for (const hex of [TEST_PUBKEY_HEX, ZERO_HEX, ALL_ZEROS_HEX]) {
            const npub = npubEncode(hex);
            assert.strictEqual(validateNpub(npub), npub, `validateNpub should accept npubEncode output for ${hex}`);
        }
    });

    it('both implementations agree on all-zeros and all-ones inputs', async () => {
        const { npubEncode } = await import('../../lib/crypto/bech32.js');

        const engineZeros = hexToNpub(ALL_ZEROS_HEX);
        const libZeros = npubEncode(ALL_ZEROS_HEX);
        assert.strictEqual(engineZeros, libZeros);

        const engineOnes = hexToNpub(ALL_ONES_HEX);
        const libOnes = npubEncode(ALL_ONES_HEX);
        assert.strictEqual(engineOnes, libOnes);
    });
});

// ── Suite 8: build output validation ──
// Verifies the badge engine compiles to valid JavaScript and the build
// pipeline produces the files the runtime expects. Catches TS migration
// regressions where raw TypeScript ends up in dist.

describe('badge engine: build output validation', () => {
    it('badges/engine.ts compiles to valid JavaScript with esbuild', async () => {
        const { readFileSync } = await import('fs');
        const { transform } = await import('esbuild');
        const { resolve } = await import('path');
        const { fileURLToPath } = await import('url');

        const root = fileURLToPath(new URL('../..', import.meta.url));
        const src = readFileSync(resolve(root, 'badges/engine.ts'), 'utf-8');

        // Should not throw — if it does, the engine has syntax esbuild can't strip
        const result = await transform(src, {
            loader: 'ts',
            format: 'iife',
            target: 'es2022',
        });

        assert.ok(result.code.length > 0, 'compiled output should not be empty');
        // Output must not contain TypeScript-only syntax
        assert.ok(!result.code.includes('interface '), 'output should not contain interface declarations');
        assert.ok(!result.code.includes('declare global'), 'output should not contain declare global');
    });

    it('compiled output contains no export statement (classic script compat)', async () => {
        const { readFileSync } = await import('fs');
        const { transform } = await import('esbuild');
        const { resolve } = await import('path');
        const { fileURLToPath } = await import('url');

        const root = fileURLToPath(new URL('../..', import.meta.url));
        const src = readFileSync(resolve(root, 'badges/engine.ts'), 'utf-8');
        const result = await transform(src, {
            loader: 'ts',
            format: 'iife',
            target: 'es2022',
        });

        // scripting.executeScript loads files as classic scripts — export would be a SyntaxError
        assert.ok(!/\bexport\s/.test(result.code), 'IIFE output must not contain export statements');
    });

    it('domain-handlers.ts references badges/engine.js (not .ts)', async () => {
        const { readFileSync } = await import('fs');
        const { resolve } = await import('path');
        const { fileURLToPath } = await import('url');

        const root = fileURLToPath(new URL('../..', import.meta.url));
        const bg = readFileSync(resolve(root, 'lib/bg/domain-handlers.ts'), 'utf-8');

        assert.ok(bg.includes("'badges/engine.js'"), 'domain-handlers.ts should reference badges/engine.js');
        assert.ok(!bg.includes("'badges/engine.ts'"), 'domain-handlers.ts should NOT reference badges/engine.ts');
    });
});
