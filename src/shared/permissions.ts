import { t } from '@lib/i18n.js';
import { KIND_LABELS } from '@shared/constants.ts';

interface NostrEvent {
  tags?: string[][];
  [key: string]: unknown;
}

/**
 * Human-readable labels for permission keys.
 * These are the keys stored in permissions (not wire method names).
 */
const PERM_LABELS: Record<string, string> = {
  'signEvent:0': 'perm.editProfile',
  'signEvent:1': 'perm.post',
  'signEvent:3': 'perm.updateContacts',
  'signEvent:5': 'perm.deleteEvent',
  'signEvent:6': 'perm.repost',
  'signEvent:7': 'perm.reaction',
  'signEvent:9734': 'perm.zap',
  'signEvent:30023': 'perm.article',
  'readMessages': 'perm.readMessages',
  'sendMessages': 'perm.sendMessages',
  'getPublicKey': 'perm.readProfile',
};

/** Fallback labels for wire method names (used when permKey is unavailable). */
const WIRE_METHOD_LABELS: Record<string, string> = {
  'signEvent': 'approval.signEvent',
  'nip04Encrypt': 'activity.sendMessage',
  'nip04Decrypt': 'activity.readMessage',
  'nip44Encrypt': 'activity.sendMessage',
  'nip44Decrypt': 'activity.readMessage',
  'getPublicKey': 'perm.readProfile',
};

/**
 * Known platform-specific actions for kind 30078 (App-specific Data).
 * Keyed by platform prefix extracted from the d-tag identifier.
 */
const PLATFORM_ACTIONS: Record<string, Record<string, string>> = {
  'Primal': {
    'get_membership_status': 'platform.membershipStatus',
    'get_app_settings': 'platform.primalSettings',
    'set_app_settings': 'platform.primalSettings',
  },
};

/**
 * Extracts a platform label from a kind 30078 event's d-tag.
 * @param event - Nostr event object with tags
 * @returns Human-readable label or null
 */
function getPlatformLabel(event: NostrEvent): string | null {
  if (!event?.tags) return null;
  const dTag = event.tags.find((tag) => tag[0] === 'd');
  if (!dTag || !dTag[1]) return null;

  // d-tag format: ["d", "Platform-App Name", "action_name"]
  const identifier = dTag[1];
  const action = dTag[2] || '';

  // Try to match a known platform by prefix
  for (const [platform, actions] of Object.entries(PLATFORM_ACTIONS)) {
    if (identifier.startsWith(platform)) {
      if (actions[action]) return t(actions[action]);
      // Unknown action for known platform -- humanize it
      const label = action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      return `${platform}: ${label || identifier}`;
    }
  }

  // Unknown platform -- show app identifier + humanized action
  const label = action
    ? action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : null;
  return label ? `${identifier}: ${label}` : identifier;
}

/**
 * Universal label formatter for permissions, methods, and events.
 * Single source of truth for all human-readable event/permission labels.
 *
 * @param key - Permission key ('signEvent:7'), method name ('nip04Encrypt'),
 *              or methodKey ('signEvent:30078')
 * @param event - Optional Nostr event for platform-specific detection (kind 30078)
 * @returns Human-readable translated label
 */
export function formatLabel(key: string, event?: NostrEvent): string {
  // Platform-specific: kind 30078 with event data
  if (key === 'signEvent:30078' && event) {
    const label = getPlatformLabel(event);
    if (label) return label;
  }

  // Known permission labels (translated)
  if (PERM_LABELS[key]) return t(PERM_LABELS[key]);

  // Unknown signEvent kind -- try KIND_LABELS for a human-readable name
  const match = key.match(/^signEvent:(\d+)$/);
  if (match) {
    const kind = parseInt(match[1]);
    if (KIND_LABELS[kind]) return KIND_LABELS[kind];
    return t('perm.signEventKind', { kind: match[1] });
  }

  // Wire method fallback
  if (WIRE_METHOD_LABELS[key]) return t(WIRE_METHOD_LABELS[key]);

  return key;
}
