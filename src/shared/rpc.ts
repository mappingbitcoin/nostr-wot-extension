import browser from '@shared/browser.ts';

class RpcError extends Error {
  method: string;

  constructor(message: string, method: string) {
    super(message);
    this.name = 'RpcError';
    this.method = method;
  }
}

// Sends { method, params } to background, unwraps { result } / { error }
export async function rpc<T = unknown>(method: string, params: unknown = {}): Promise<T> {
  const resp = await browser.runtime.sendMessage({ method, params });
  if (resp?.error) throw new RpcError(resp.error, method);
  return resp?.result as T;
}

// Fire-and-forget (for 'configUpdated' etc.)
export function rpcNotify(method: string, params: unknown = {}): void {
  browser.runtime.sendMessage({ method, params }).catch(() => {});
}
