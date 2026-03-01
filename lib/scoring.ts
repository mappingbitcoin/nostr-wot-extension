/**
 * Centralized trust score calculation
 *
 * Formula: score = base + pathBonus (capped at maxPathBonus)
 *
 * Where:
 * - base: base score per hop distance (1 hop = 100%, 2 hops = 50%, etc.)
 * - pathBonus: bonus based on number of shortest paths, capped at maxPathBonus
 */

import type { ScoringConfig } from './types.ts';

export const DEFAULT_SCORING: ScoringConfig = {
    distanceWeights: { 1: 1.0, 2: 0.5, 3: 0.25, 4: 0.1 },
    pathBonus: { 2: 0.15, 3: 0.1, 4: 0.05 },
    maxPathBonus: 0.5
};

/**
 * Calculate trust score from hops and path count
 *
 * @param hops - Number of hops (0 = self, 1 = direct follow, etc.)
 * @param paths - Number of shortest paths (null if unknown)
 * @param scoring - Scoring configuration
 * @returns Score between 0 and 1
 */
export function calculateScore(hops: number | null | undefined, paths: number | null, scoring: ScoringConfig = DEFAULT_SCORING): number {
    // Self = maximum trust
    if (hops === 0) return 1.0;

    // Not connected
    if (hops === null || hops === undefined) return 0;

    const { distanceWeights, pathBonus, maxPathBonus } = scoring;

    // Get base score for this hop distance (use hop 4 for anything beyond)
    const hopKey = Math.min(hops, 4);
    const base = distanceWeights?.[hopKey] ?? DEFAULT_SCORING.distanceWeights[hopKey] ?? 0.1;

    // Calculate path bonus (only for hops > 1 with multiple paths)
    let bonus = 0;
    if (paths !== null && paths > 1 && hops > 1) {
        // Get path bonus for this hop level
        let pathBonusValue: number;
        if (typeof pathBonus === 'object') {
            pathBonusValue = pathBonus[hopKey] ?? DEFAULT_SCORING.pathBonus[hopKey] ?? 0.05;
        } else {
            // Legacy single value
            pathBonusValue = (pathBonus as unknown as number) ?? 0.1;
        }
        // Bonus = pathBonusValue * (paths - 1), capped at maxPathBonus
        bonus = Math.min(pathBonusValue * (paths - 1), maxPathBonus ?? 0.5);
    }

    // Final score: base + pathBonus (capped)
    const score = base + bonus;

    // Clamp to [0, 1]
    return Math.min(Math.max(score, 0), 1);
}
