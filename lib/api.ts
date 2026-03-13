import type { DistanceInfo } from './types.ts';

// Validation helpers for oracle responses
function isValidPubkey(pubkey: string): boolean {
    return typeof pubkey === 'string' && /^[a-f0-9]{64}$/i.test(pubkey);
}

function isValidHops(hops: unknown): boolean {
    return hops === null || (Number.isInteger(hops) && (hops as number) >= 0 && (hops as number) <= 100);
}

function isValidPaths(paths: unknown): boolean {
    return paths === null || paths === undefined || (Number.isInteger(paths) && (paths as number) >= 0);
}

interface DistanceResponse {
    hops: number | null;
    paths?: number | null;
}

interface FollowsResponse {
    follows: string[];
}

interface CommonFollowsResponse {
    common: string[];
}

interface PathResponse {
    path: string[] | null;
}

function validateDistanceResponse(data: unknown): DistanceResponse {
    if (typeof data !== 'object' || data === null) {
        throw new Error('Invalid oracle response: expected object');
    }
    const d = data as Record<string, unknown>;
    if (!isValidHops(d.hops)) {
        throw new Error('Invalid oracle response: hops must be null or a non-negative integer');
    }
    if (d.paths !== undefined && !isValidPaths(d.paths)) {
        throw new Error('Invalid oracle response: paths must be null or a non-negative integer');
    }
    return data as DistanceResponse;
}

function validateBatchResponse(data: unknown): Record<string, number | null> {
    if (typeof data !== 'object' || data === null) {
        throw new Error('Invalid oracle batch response: expected object');
    }
    for (const [pubkey, hops] of Object.entries(data as Record<string, unknown>)) {
        if (!isValidPubkey(pubkey)) {
            throw new Error(`Invalid oracle batch response: invalid pubkey ${pubkey}`);
        }
        if (!isValidHops(hops)) {
            throw new Error(`Invalid oracle batch response: invalid hops for ${pubkey}`);
        }
    }
    return data as Record<string, number | null>;
}

function validateFollowsResponse(data: unknown): FollowsResponse {
    if (typeof data !== 'object' || data === null) {
        throw new Error('Invalid oracle follows response: expected object');
    }
    const d = data as Record<string, unknown>;
    if (!Array.isArray(d.follows)) {
        throw new Error('Invalid oracle follows response: follows must be an array');
    }
    for (const pubkey of d.follows) {
        if (!isValidPubkey(pubkey)) {
            throw new Error(`Invalid oracle follows response: invalid pubkey ${pubkey}`);
        }
    }
    return data as FollowsResponse;
}

function validateCommonFollowsResponse(data: unknown): CommonFollowsResponse {
    if (typeof data !== 'object' || data === null) {
        throw new Error('Invalid oracle common-follows response: expected object');
    }
    const d = data as Record<string, unknown>;
    if (!Array.isArray(d.common)) {
        throw new Error('Invalid oracle common-follows response: common must be an array');
    }
    for (const pubkey of d.common) {
        if (!isValidPubkey(pubkey)) {
            throw new Error(`Invalid oracle common-follows response: invalid pubkey ${pubkey}`);
        }
    }
    return data as CommonFollowsResponse;
}

function validatePathResponse(data: unknown): PathResponse {
    if (typeof data !== 'object' || data === null) {
        throw new Error('Invalid oracle path response: expected object');
    }
    const d = data as Record<string, unknown>;
    if (d.path !== null && !Array.isArray(d.path)) {
        throw new Error('Invalid oracle path response: path must be null or an array');
    }
    if (Array.isArray(d.path)) {
        for (const pubkey of d.path) {
            if (!isValidPubkey(pubkey)) {
                throw new Error(`Invalid oracle path response: invalid pubkey ${pubkey}`);
            }
        }
    }
    return data as PathResponse;
}

export class RemoteOracle {
    private readonly baseUrl: string;

    constructor(baseUrl: string) {
        this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    }

    async getDistance(from: string, to: string): Promise<number | null> {
        const url = `${this.baseUrl}/distance?from=${from}&to=${to}`;
        const res = await fetch(url);

        if (!res.ok) {
            if (res.status === 404) {
                return null; // Not found in graph
            }
            throw new Error(`Oracle error: ${res.status}`);
        }

        const data = await res.json();
        validateDistanceResponse(data);
        return data.hops ?? null;
    }

    // Get full distance info including path count and bridges
    async getDistanceInfo(from: string, to: string): Promise<DistanceInfo | null> {
        const url = `${this.baseUrl}/distance?from=${from}&to=${to}`;
        const res = await fetch(url);

        if (!res.ok) {
            if (res.status === 404) {
                return null;
            }
            throw new Error(`Oracle error: ${res.status}`);
        }

        const data = await res.json();
        return validateDistanceResponse(data) as DistanceInfo;
    }

    // Batch query for multiple targets
    async getDistanceBatch(from: string, targets: string[]): Promise<Record<string, number | null>> {
        const url = `${this.baseUrl}/distance/batch`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from, targets })
        });

        if (!res.ok) {
            throw new Error(`Oracle batch error: ${res.status}`);
        }

        const data = await res.json();
        return validateBatchResponse(data);
    }

    // Get oracle stats
    async getStats(): Promise<unknown> {
        const url = `${this.baseUrl}/stats`;
        const res = await fetch(url);

        if (!res.ok) {
            throw new Error(`Oracle stats error: ${res.status}`);
        }

        return res.json();
    }

    // Health check
    async isHealthy(): Promise<boolean> {
        try {
            const url = `${this.baseUrl}/health`;
            const res = await fetch(url, { method: 'GET' });
            return res.ok;
        } catch {
            return false;
        }
    }

    // Get follows for a pubkey
    async getFollows(pubkey: string): Promise<string[]> {
        const url = `${this.baseUrl}/follows?pubkey=${pubkey}`;
        const res = await fetch(url);

        if (!res.ok) {
            if (res.status === 404) {
                return [];
            }
            throw new Error(`Oracle follows error: ${res.status}`);
        }

        const data = await res.json();
        validateFollowsResponse(data);
        return data.follows ?? [];
    }

    // Get common follows between two pubkeys
    async getCommonFollows(from: string, to: string): Promise<string[]> {
        const url = `${this.baseUrl}/common-follows?from=${from}&to=${to}`;
        const res = await fetch(url);

        if (!res.ok) {
            if (res.status === 404) {
                return [];
            }
            throw new Error(`Oracle common-follows error: ${res.status}`);
        }

        const data = await res.json();
        validateCommonFollowsResponse(data);
        return data.common ?? [];
    }

    // Get path between two pubkeys
    async getPath(from: string, to: string): Promise<string[] | null> {
        const url = `${this.baseUrl}/path?from=${from}&to=${to}`;
        const res = await fetch(url);

        if (!res.ok) {
            if (res.status === 404) {
                return null;
            }
            throw new Error(`Oracle path error: ${res.status}`);
        }

        const data = await res.json();
        validatePathResponse(data);
        return data.path ?? null;
    }
}
