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

        return res.json();
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

        return res.json();
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
        return data.path ?? null;
    }
}
