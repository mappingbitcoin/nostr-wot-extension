import browser from './browser.ts';

/**
 * Maps known Nostr client domains to their icon paths.
 * Icons live in icons/clients/<name>.svg.
 */
const CLIENT_ICONS: Record<string, string> = {
  'primal.net': 'icons/clients/primal.svg',
  'www.primal.net': 'icons/clients/primal.svg',
  'app.primal.net': 'icons/clients/primal.svg',
  'coracle.social': 'icons/clients/coracle.svg',
  'www.coracle.social': 'icons/clients/coracle.svg',
};

/**
 * Returns a resolved URL for a known client icon, or null.
 */
export function getClientIconUrl(domain: string): string | null {
  const path = CLIENT_ICONS[domain];
  return path ? browser.runtime.getURL(path) : null;
}

/**
 * Returns a Google favicon URL for any domain.
 */
export function getFaviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
}
