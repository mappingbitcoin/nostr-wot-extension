import { rpc } from '@shared/rpc.ts';

const BLOSSOM_SERVER = 'https://blossom.primal.net';

interface BlossomUploadResult {
  url: string;
}

interface BlossomUploadResponse {
  url: string;
}

/**
 * Upload a file to Blossom (BUD-06).
 * Signs a kind:24242 auth event via the vault, then PUTs the file.
 */
export async function uploadToBlossom(file: File): Promise<BlossomUploadResult> {
  const buf = await file.arrayBuffer();
  const hashBytes = await crypto.subtle.digest('SHA-256', buf);
  const sha256hex = [...new Uint8Array(hashBytes)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  const expiration = String(Math.floor(Date.now() / 1000) + 300);

  const authEvent = {
    created_at: Math.floor(Date.now() / 1000),
    kind: 24242,
    tags: [
      ['t', 'upload'],
      ['x', sha256hex],
      ['expiration', expiration],
    ],
    content: '',
  };

  const signed = await rpc('signEvent', { event: authEvent });
  const authHeader = 'Nostr ' + btoa(JSON.stringify(signed));

  const res = await fetch(`${BLOSSOM_SERVER}/upload`, {
    method: 'PUT',
    headers: {
      Authorization: authHeader,
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: buf,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Upload failed: ${text}`);
  }

  const data: BlossomUploadResponse = await res.json();
  return { url: data.url };
}
