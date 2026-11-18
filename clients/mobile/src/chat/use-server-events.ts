import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import EventSource from 'react-native-sse';
import type { Connection } from '../connection/connection';
import type { Activity } from '../connection/contracts';

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
  opened(): void;
  received(event: ServerEvent): void;
  refused(status: number): void;
  failed(message: string): void;
  resumed(): void;
}

const firstDelay = 3000;
const maxDelay = 30000;
const silentLimit = 45000;

export function useServerEvents(connection: Connection, handlers: ServerEventHandlers) {
  const [live, setLive] = useState(false);
  const latest = useRef(handlers);
  const control = useRef<(() => void) | null>(null);

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
    const clearPending = () => {
      if (pending) clearTimeout(pending);
      pending = null;
    };
    const reopen = () => {
      events.close();
      events.open();
    };
    const retry = () => {
      if (pending || stopped) return;
      pending = setTimeout(() => {
        pending = null;
        if (!stopped) reopen();
      }, delay);
      delay = Math.min(delay * 2, maxDelay);
    };
    const reconnect = () => {
      if (stopped) return;
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
      handle(text);
    };
    const watch = setInterval(() => {
      if (!open || stopped || Date.now() - heard < silentLimit) return;
      open = false;
      setLive(false);
      reconnect();
    }, silentLimit / 3);
    events.addEventListener('open', () => {
      open = true;
      heard = Date.now();
      clearPending();
      delay = firstDelay;
      setLive(true);
      latest.current.opened();
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
      if (status !== 'active' || stopped) return;
      reconnect();
      latest.current.resumed();
    });
    return () => {
      stopped = true;
      clearPending();
      clearInterval(watch);
      lifecycle.remove();
      events.removeAllEventListeners();
      events.close();
      if (control.current === reconnect) control.current = null;
    };
  }, [connection]);

  const reconnect = useCallback(() => control.current?.(), []);
  return { live, reconnect };
}
