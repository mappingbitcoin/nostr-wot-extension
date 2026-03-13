import { useState, useEffect, useCallback, useRef } from 'react';
import { rpc } from '@shared/rpc.ts';

interface UseRpcOptions<T> {
  defaultValue?: T | null;
  lazy?: boolean;
  transform?: (result: unknown) => T;
}

interface UseRpcResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: (overrideParams?: unknown) => Promise<T | null>;
  call: (overrideParams?: unknown) => Promise<T | null>;
}

export default function useRpc<T = unknown>(
  method: string,
  params: unknown = {},
  { defaultValue = null, lazy = false, transform }: UseRpcOptions<T> = {}
): UseRpcResult<T> {
  const [data, setData] = useState<T | null>(defaultValue ?? null);
  const [loading, setLoading] = useState<boolean>(!lazy);
  const [error, setError] = useState<string | null>(null);

  const paramsRef = useRef(params);
  const paramsKey = JSON.stringify(params);
  // Only update ref when serialized value changes
  if (JSON.stringify(paramsRef.current) !== paramsKey) {
    paramsRef.current = params;
  }

  const call = useCallback(async (overrideParams?: unknown): Promise<T | null> => {
    setLoading(true);
    setError(null);
    try {
      let result: unknown = await rpc(method, overrideParams ?? paramsRef.current);
      if (transform) result = transform(result);
      setData(result as T);
      return result as T;
    } catch (e: unknown) {
      setError((e as Error).message);
      return defaultValue ?? null;
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, paramsKey]);

  useEffect(() => { if (!lazy) call(); }, [call, lazy]);

  return { data, loading, error, reload: call, call };
}
