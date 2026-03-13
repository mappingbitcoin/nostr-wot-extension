/**
 * Miscellaneous handlers: activity log, mute lists, local blocks,
 * profile metadata, NIP-46 sessions, relay/event publishing, health checks.
 *
 * This module is a re-export façade — all logic has been split into focused modules:
 *   - activity-handlers.ts  — activity log
 *   - profile-handlers.ts   — profile metadata, mute lists, local blocks
 *   - publish-handlers.ts   — broadcasting, signing, NIP-46 sessions, health checks
 *
 * @module lib/bg/misc-handlers
 */

import type { HandlerFn } from './state.ts';

// Re-export for backward compatibility
export { logActivity, handlers as activityHandlers } from './activity-handlers.ts';
export { fetchKind0, fetchMuteList, fetchProfileMetadata, handlers as profileHandlers } from './profile-handlers.ts';
export { broadcastEvent, handlers as publishHandlers } from './publish-handlers.ts';

import { handlers as activityHandlers } from './activity-handlers.ts';
import { handlers as profileHandlers } from './profile-handlers.ts';
import { handlers as publishHandlers } from './publish-handlers.ts';

// Combined handlers map — contains ALL handlers from the three sub-modules
const handlers = new Map<string, HandlerFn>();
for (const group of [activityHandlers, profileHandlers, publishHandlers]) {
    for (const [k, v] of group) handlers.set(k, v);
}
export { handlers };
