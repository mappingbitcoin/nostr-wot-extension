// Validation helpers for oracle responses
function isValidPubkey(pubkey) {
    return typeof pubkey === 'string' && /^[a-f0-9]{64}$/i.test(pubkey);
}

function isValidHops(hops) {
    return hops === null || (Number.isInteger(hops) && hops >= 0 && hops <= 100);
}

function isValidPaths(paths) {
    return paths === null || paths === undefined || (Number.isInteger(paths) && paths >= 0);
}

function validateDistanceResponse(data) {
    if (typeof data !== 'object' || data === null) {
        throw new Error('Invalid oracle response: expected object');
    }
    if (!isValidHops(data.hops)) {
        throw new Error('Invalid oracle response: hops must be null or a non-negative integer');
    }
    if (data.paths !== undefined && !isValidPaths(data.paths)) {
        throw new Error('Invalid oracle response: paths must be null or a non-negative integer');
    }
    return data;
}

function validateBatchResponse(data) {
    if (typeof data !== 'object' || data === null) {
        throw new Error('Invalid oracle batch response: expected object');
    }
    for (const [pubkey, hops] of Object.entries(data)) {
        if (!isValidPubkey(pubkey)) {
            throw new Error(`Invalid oracle batch response: invalid pubkey ${pubkey}`);
        }
        if (!isValidHops(hops)) {
            throw new Error(`Invalid oracle batch response: invalid hops for ${pubkey}`);
        }
    }
    return data;
}

function validateFollowsResponse(data) {
    if (typeof data !== 'object' || data === null) {
        throw new Error('Invalid oracle follows response: expected object');
    }
    if (!Array.isArray(data.follows)) {
        throw new Error('Invalid oracle follows response: follows must be an array');
    }
    for (const pubkey of data.follows) {
        if (!isValidPubkey(pubkey)) {
            throw new Error(`Invalid oracle follows response: invalid pubkey ${pubkey}`);
        }
    }
    return data;
}

function validateCommonFollowsResponse(data) {
    if (typeof data !== 'object' || data === null) {
        throw new Error('Invalid oracle common-follows response: expected object');
    }
    if (!Array.isArray(data.common)) {
        throw new Error('Invalid oracle common-follows response: common must be an array');
    }
    for (const pubkey of data.common) {
        if (!isValidPubkey(pubkey)) {
            throw new Error(`Invalid oracle common-follows response: invalid pubkey ${pubkey}`);
        }
    }
    return data;
}

function validatePathResponse(data) {
    if (typeof data !== 'object' || data === null) {
        throw new Error('Invalid oracle path response: expected object');
    }
    if (data.path !== null && !Array.isArray(data.path)) {
        throw new Error('Invalid oracle path response: path must be null or an array');
    }
    if (Array.isArray(data.path)) {
        for (const pubkey of data.path) {
            if (!isValidPubkey(pubkey)) {
                throw new Error(`Invalid oracle path response: invalid pubkey ${pubkey}`);
            }
        }
    }
    return data;
}

export class RemoteOracle {
    constructor(baseUrl) {
        this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    }

    async getDistance(from, to) {
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
    async getDistanceInfo(from, to) {
        const url = `${this.baseUrl}/distance?from=${from}&to=${to}`;
        const res = await fetch(url);

        if (!res.ok) {
            if (res.status === 404) {
                return null;
            }
            throw new Error(`Oracle error: ${res.status}`);
        }

        const data = await res.json();
        return validateDistanceResponse(data);
    }

    // Batch query for multiple targets
    async getDistanceBatch(from, targets) {
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
    async getStats() {
        const url = `${this.baseUrl}/stats`;
        const res = await fetch(url);

        if (!res.ok) {
            throw new Error(`Oracle stats error: ${res.status}`);
        }

        return res.json();
    }

    // Health check
    async isHealthy() {
        try {
            const url = `${this.baseUrl}/health`;
            const res = await fetch(url, { method: 'GET' });
            return res.ok;
        } catch {
            return false;
        }
    }

    // Get follows for a pubkey
    async getFollows(pubkey) {
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
    async getCommonFollows(from, to) {
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
    async getPath(from, to) {
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
