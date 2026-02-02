import * as storage from './storage.js';

export class LocalGraph {
    constructor() {
        this.ready = storage.initDB();
    }

    async ensureReady() {
        await this.ready;
    }

    async getDistance(from, to, maxHops = 6) {
        await this.ensureReady();

        if (from === to) return 0;

        const visited = new Set([from]);
        let frontier = [from];
        let hops = 0;

        while (frontier.length > 0 && hops < maxHops) {
            hops++;
            const nextFrontier = [];

            for (const pubkey of frontier) {
                const follows = await storage.getFollows(pubkey);
                for (const followed of follows) {
                    if (followed === to) return hops;
                    if (!visited.has(followed)) {
                        visited.add(followed);
                        nextFrontier.push(followed);
                    }
                }
            }

            frontier = nextFrontier;
        }

        return null; // Not found within maxHops
    }
}
