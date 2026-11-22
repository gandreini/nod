import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ApiError,
  errorText,
  refusedAccess,
  request,
  tokenRefused,
  refusedToken,
} from '../connection/api';
import { useChatVersion, useNodBase } from '../connection/nod-context';

export function useRequest() {
  const { connection, refused } = useNodBase();
  return useCallback(
    async <T = unknown>(path: string, method: Parameters<typeof request>[2], body?: unknown) => {
      try {
        return await request<T>(connection, path, method, body);
      } catch (problem) {
        if (refusedToken(problem)) {
          const notice = tokenRefused(connection.origin);
          refused(notice);
          throw new Error(notice);
        }
        throw new Error(refusedAccess(problem) ?? errorText(problem));
      }
    },
    [connection, refused],
  );
}

export function useResource<T>(path: string, options: { optional?: boolean } = {}) {
  const { connection, refused } = useNodBase();
  const version = useChatVersion();
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const latest = useRef(0);
  const optional = Boolean(options.optional);

  const load = useCallback(async () => {
    const call = ++latest.current;
    setLoading(true);
    try {
      const next = await request<T>(connection, path);
      if (call !== latest.current) return;
      setData(next);
      setError(undefined);
    } catch (problem) {
      if (call !== latest.current) return;
      if (optional && problem instanceof ApiError && problem.status === 403) return;
      if (refusedToken(problem)) return refused(tokenRefused(connection.origin));
      setError(refusedAccess(problem) ?? errorText(problem));
    } finally {
      if (call === latest.current) setLoading(false);
    }
  }, [connection, optional, path, refused]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [version, load]),
  );

  const replace = useCallback(
    (next: T | undefined | ((current: T | undefined) => T | undefined)) => {
      latest.current++;
      setLoading(false);
      setData(next);
    },
    [],
  );

  return { data, error, loading, reload: load, setData: replace };
}
