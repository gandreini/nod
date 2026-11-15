import { randomUUID } from 'expo-crypto';
import { fetch } from 'expo/fetch';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, errorText, read, request, tokenRefused, unreachable } from '../connection/api';
import type { Connection } from '../connection/connection';
import { frameReader, toBase64 } from './frames';
import { queueInput, type HandoffInput } from './input';

const frameInterval = 1000 / 15;
const answerTimeout = 75_000;
const firstFrameTimeout = 15_000;
const retryDelay = 1000;

export type Frame = { id: number; uri: string };

export function useBrowserHandoff(
  connection: Connection,
  turnId: string,
  refused: (notice: string) => void,
) {
  const view = useRef(randomUUID());
  const pending = useRef<HandoffInput[]>([]);
  const sending = useRef<Promise<void> | null>(null);
  const lifetime = useRef(new AbortController());
  const latest = useRef<Uint8Array | null>(null);
  const showing = useRef(false);
  const shownAt = useRef(0);
  const frames = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [attempt, setAttempt] = useState(0);
  const [failures, setFailures] = useState(0);
  const [live, setLive] = useState(false);
  const [frame, setFrame] = useState<Frame>();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [error, setError] = useState('');
  const [streamError, setStreamError] = useState('');
  const [busy, setBusy] = useState<'back' | 'reload' | 'done' | null>(null);
  const [end, setEnd] = useState<'ended' | 'returned'>();
  const unavailable = failures >= 3;

  const stopInput = useCallback(() => {
    lifetime.current.abort();
    pending.current.length = 0;
  }, []);

  useEffect(() => {
    if (lifetime.current.signal.aborted) lifetime.current = new AbortController();
    return () => {
      stopInput();
      clearTimeout(timer.current);
    };
  }, [stopInput]);

  const closedBy = useCallback(
    (problem: unknown) => {
      if (!(problem instanceof ApiError)) return false;
      if (problem.status === 401) refused(tokenRefused(connection.origin, problem.status));
      else if (problem.status === 423) {
        stopInput();
        setLive(false);
        setEnd('ended');
      } else return false;
      return true;
    },
    [connection.origin, refused, stopInput],
  );

  const post = useCallback(
    async (path: string, body: unknown) => {
      const signal = lifetime.current.signal;
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort);
      let late = false;
      const timeout = setTimeout(() => {
        late = true;
        controller.abort();
      }, answerTimeout);
      try {
        return await request(connection, path, 'POST', body, controller.signal);
      } catch (problem) {
        if (late)
          throw new Error(
            'The browser did not confirm this request. Check the page before trying again.',
          );
        throw problem;
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
      }
    },
    [connection],
  );

  const flush = useCallback((): Promise<void> => {
    const signal = lifetime.current.signal;
    sending.current ??= (async () => {
      while (pending.current.length && !signal.aborted) {
        const inputs = pending.current.splice(0);
        try {
          await post('/api/browser-handoff', { turnId, inputs });
          if (
            !signal.aborted &&
            inputs.some((input) => input.type !== 'mouse' || input.event !== 'move')
          )
            setError('');
        } catch (problem) {
          if (signal.aborted) return;
          pending.current.length = 0;
          if (!closedBy(problem)) {
            setError(errorText(problem));
            setLive(false);
            setAttempt((value) => value + 1);
          }
          throw problem;
        }
      }
    })().finally(() => {
      sending.current = null;
      if (pending.current.length && !signal.aborted) void flush().catch(() => {});
    });
    return sending.current;
  }, [closedBy, post, turnId]);

  const pump = useCallback(() => {
    if (showing.current || timer.current || !latest.current) return;
    const wait = shownAt.current + frameInterval - Date.now();
    if (wait > 0) {
      timer.current = setTimeout(() => {
        timer.current = undefined;
        pump();
      }, wait);
      return;
    }
    const bytes = latest.current;
    latest.current = null;
    showing.current = true;
    shownAt.current = Date.now();
    setFrame({ id: ++frames.current, uri: `data:image/jpeg;base64,${toBase64(bytes)}` });
  }, []);

  const shown = useCallback(
    (width?: number, height?: number) => {
      showing.current = false;
      setLive(true);
      setFailures(0);
      setStreamError('');
      if (width && height)
        setSize((current) =>
          current.width === width && current.height === height ? current : { width, height },
        );
      pump();
    },
    [pump],
  );

  const missed = useCallback(() => {
    showing.current = false;
    pump();
  }, [pump]);

  useEffect(() => {
    if (end || unavailable) return;
    const controller = new AbortController();
    latest.current = null;
    showing.current = false;
    setLive(false);
    void (async () => {
      const query = new URLSearchParams({ turnId, view: `${view.current}-${attempt}` });
      let response;
      try {
        response = await fetch(`${connection.origin}/api/browser-handoff/stream?${query}`, {
          headers: { Authorization: `Bearer ${connection.token}` },
          signal: controller.signal,
        });
      } catch (problem) {
        throw unreachable(connection, problem);
      }
      if (!response.ok) await read(response as unknown as Response);
      if (!response.body) throw new Error('The browser view could not connect.');
      const reader = response.body.getReader();
      const parse = frameReader((bytes) => {
        latest.current = bytes;
        pump();
      });
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) throw new Error('The browser view ended.');
          parse(next.value);
        }
      } finally {
        reader.cancel().catch(() => {});
      }
    })().catch((problem) => {
      if (controller.signal.aborted) return;
      setLive(false);
      if (closedBy(problem)) return;
      setStreamError(errorText(problem));
      setFailures((value) => value + 1);
    });
    return () => controller.abort();
  }, [attempt, closedBy, connection, end, pump, turnId, unavailable]);

  useEffect(() => {
    if (end || live || unavailable) return;
    const wait = setTimeout(() => {
      setStreamError('No page arrived in 15 seconds.');
      setFailures((value) => value + 1);
    }, firstFrameTimeout);
    return () => clearTimeout(wait);
  }, [attempt, end, failures, live, unavailable]);

  useEffect(() => {
    if (end || !failures || unavailable) return;
    const wait = setTimeout(() => setAttempt((value) => value + 1), retryDelay);
    return () => clearTimeout(wait);
  }, [end, failures, unavailable]);

  function send(inputs: HandoffInput[]) {
    if (!live || busy || end) return;
    for (const input of inputs) queueInput(pending.current, input);
    void flush().catch(() => {});
  }

  async function navigate(action: 'back' | 'reload') {
    setBusy(action);
    try {
      await flush();
      await post('/api/browser-handoff/navigate', { turnId, action });
      setError('');
    } catch (problem) {
      if (!closedBy(problem)) setError(errorText(problem));
    } finally {
      setBusy(null);
    }
  }

  async function done() {
    setBusy('done');
    try {
      await flush();
      await post('/api/browser-handoff/done', { turnId });
      stopInput();
      setEnd('returned');
      return true;
    } catch (problem) {
      if (!closedBy(problem)) setError(errorText(problem));
      return false;
    } finally {
      setBusy(null);
    }
  }

  function reconnect() {
    setFailures(0);
    setError('');
    setStreamError('');
    setAttempt((value) => value + 1);
  }

  const status =
    busy === 'done'
      ? 'Returning control…'
      : unavailable
        ? 'Disconnected'
        : live
          ? 'You have control'
          : failures
            ? 'Reconnecting…'
            : 'Opening browser…';

  return {
    frame,
    size,
    live,
    busy,
    end,
    error,
    streamError,
    unavailable,
    status,
    shown,
    missed,
    send,
    navigate,
    done,
    reconnect,
  };
}

export type BrowserHandoff = ReturnType<typeof useBrowserHandoff>;
