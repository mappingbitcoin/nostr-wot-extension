export function getDomainFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function isValidWssUrl(url: string): boolean {
  try { const u = new URL(url); return u.protocol === 'wss:'; } catch { return false; }
}

export function isValidHttpsUrl(url: string): boolean {
  try { const u = new URL(url); return u.protocol === 'https:'; } catch { return false; }
}
