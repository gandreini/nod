import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import EventSource from 'react-native-sse';
import type { Connection } from '../connection/connection';
import type { Activity } from '../connection/contracts';
import { resetConnections } from '../../modules/nod-network';
import { liveHeld } from './live-holds';

export interface ServerEvent {
  type?: string;
  threadId?: string;
  turnId?: string;
  text?: string;
  streamId?: string;
  done?: boolean;
  items?: Activity[];
}

export interface ServerEventHandlers {
  received(event: ServerEvent): void;
  refused(status: number): void;
  failed(message: string): void;
  resumed(): void;
  stalled(): void;
}

export const resumeHedge = 3000;
const firstDelay = 3000;
const maxDelay = 30000;
const silentLimit = 25000;
const recoverGap = 5000;
const quietLimit = 20000;

export function useServerEvents(connection: Connection, handlers: ServerEventHandlers) {
  const [live, setLive] = useState(false);
  const latest = useRef(handlers);
  const control = useRef<(() => void) | null>(null);
  const health = useRef<{
    stale(): boolean;
    suspect(): boolean;
    recover(): Promise<void>;
  } | null>(null);

  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    const events = new EventSource<never>(`${connection.origin}/api/events`, {
      headers: { Authorization: `Bearer ${connection.token}` },
      pollingInterval: 0,
      timeout: 0,
    });
    let delay = firstDelay;
    let pending: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let paused = false;
    let resumeCheck: ReturnType<typeof setTimeout> | null = null;
    const clearPending = () => {
      if (pending) clearTimeout(pending);
      pending = null;
    };
    const reopen = () => {
      events.close();
      events.open();
    };
    const retry = () => {
      if (pending || stopped || paused) return;
      pending = setTimeout(() => {
        pending = null;
        if (!stopped && !paused) reopen();
      }, delay);
      delay = Math.min(delay * 2, maxDelay);
    };
    const reconnect = () => {
      if (stopped || paused) return;
      clearPending();
      delay = firstDelay;
      reopen();
    };
    control.current = reconnect;
    let open = false;
    let heard = Date.now();
    const inner = events as unknown as { _pollAgain(): void; _handleEvent(text: string): void };
    inner._pollAgain = () => {
      open = false;
      setLive(false);
      retry();
    };
    const handle = inner._handleEvent.bind(events);
    inner._handleEvent = (text) => {
      heard = Date.now();
      delay = firstDelay;
      handle(text);
    };
    let recovered = 0;
    const recover = async () => {
      if (Date.now() - recovered < recoverGap) return;
      recovered = Date.now();
      heard = Date.now();
      open = false;
      setLive(false);
      clearPending();
      await resetConnections(connection.origin);
      reconnect();
    };
    health.current = {
      stale: () => !stopped && !paused && open && Date.now() - heard >= silentLimit,
      suspect: () => !stopped && (!open || Date.now() - heard >= quietLimit),
      recover,
    };
    const watch = setInterval(() => {
      if (!open || stopped || paused || Date.now() - heard < silentLimit) return;
      void recover();
    }, 5000);
    events.addEventListener('open', () => {
      open = true;
      heard = Date.now();
      clearPending();
      setLive(true);
    });
    events.addEventListener('error', (event) => {
      open = false;
      setLive(false);
      const status = 'xhrStatus' in event ? event.xhrStatus : undefined;
      if (status === 401) {
        stopped = true;
        clearPending();
        events.close();
        return latest.current.refused(status);
      }
      if (status === 403)
        latest.current.failed(
          `The server refused the live connection: ${'message' in event && event.message ? event.message : 'access denied'} (HTTP 403)`,
        );
      retry();
    });
    events.addEventListener('message', (event) => {
      if (!event.data) return;
      let data: ServerEvent;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      latest.current.received(data);
    });
    const lifecycle = AppState.addEventListener('change', (status) => {
      if (stopped) return;
      if (status === 'background' && !liveHeld()) {
        paused = true;
        open = false;
        if (resumeCheck) clearTimeout(resumeCheck);
        resumeCheck = null;
        clearPending();
        setLive(false);
        events.close();
        return;
      }
      if (status !== 'active' || !paused) return;
      paused = false;
      latest.current.resumed();
      void resetConnections(connection.origin).then(() => {
        if (stopped || paused) return;
        reconnect();
        if (resumeCheck) clearTimeout(resumeCheck);
        resumeCheck = setTimeout(() => {
          resumeCheck = null;
          if (stopped || paused || open) return;
          recovered = 0;
          void recover().then(() => latest.current.stalled());
        }, resumeHedge);
      });
    });
    return () => {
      stopped = true;
      if (resumeCheck) clearTimeout(resumeCheck);
      clearPending();
      clearInterval(watch);
      lifecycle.remove();
      events.removeAllEventListeners();
      events.close();
      if (control.current === reconnect) control.current = null;
      health.current = null;
    };
  }, [connection]);

  const reconnect = useCallback(() => control.current?.(), []);
  const stale = useCallback(() => health.current?.stale() ?? false, []);
  const suspect = useCallback(() => health.current?.suspect() ?? true, []);
  const recover = useCallback(async () => {
    await (health.current?.recover() ?? resetConnections(connection.origin));
  }, [connection.origin]);
  return { live, reconnect, stale, suspect, recover };
}
