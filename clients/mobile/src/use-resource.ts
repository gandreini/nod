import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, request } from './api';
import { useNod } from './nod-context';

export function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function useResource<T>(path: string, options: { optional?: boolean } = {}) {
  const { connection, chat, refused } = useNod();
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
      if (problem instanceof ApiError && problem.status === 401)
        return refused(
          `${new URL(connection.origin).host} no longer accepts the saved token (HTTP 401). Connect again with the current token.`,
        );
      setError(
        problem instanceof ApiError && problem.status === 403
          ? `The server refused the request: ${problem.message}`
          : describe(problem),
      );
    } finally {
      if (call === latest.current) setLoading(false);
    }
  }, [connection, optional, path, refused]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(() => {
    if (chat.version) void load();
  }, [chat.version, load]);

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
