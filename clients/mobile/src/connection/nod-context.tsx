import { router } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { setDateFormat } from '../../../../src/web/lib/date-format';
import { request } from './api';
import type { Connection } from './connection';
import type { Preferences } from './contracts';
import { useChat } from '../chat/use-chat';
import { usePush } from '../push/use-push';
import type { Capabilities } from './capabilities';
import { useCapabilities } from './use-capabilities';

interface NodBase {
  connection: Connection;
  push: ReturnType<typeof usePush>;
  capabilities: Capabilities;
  refused(notice: string): void;
  disconnect(): Promise<void>;
  ask(text: string): void;
}

interface Nod extends NodBase {
  chat: ReturnType<typeof useChat>;
}

const BaseContext = createContext<NodBase | null>(null);
const VersionContext = createContext(0);
const NodContext = createContext<Nod | null>(null);

export function NodProvider({
  connection,
  refused,
  disconnect,
  children,
}: {
  connection: Connection;
  refused(notice: string, from: Connection): void;
  disconnect(from: Connection): Promise<void>;
  children: ReactNode;
}) {
  const refusedHere = useCallback(
    (notice: string) => refused(notice, connection),
    [connection, refused],
  );
  const disconnectHere = useCallback(() => disconnect(connection), [connection, disconnect]);
  const chat = useChat(connection, refusedHere);
  const capabilities = useCapabilities(connection, refusedHere);
  const push = usePush(connection, refusedHere, capabilities);
  const send = chat.send;
  const ask = useCallback(
    (text: string) => {
      send(text);
      router.navigate('/');
    },
    [send],
  );
  useEffect(() => {
    request<Preferences>(connection, '/api/preferences')
      .then(setDateFormat)
      .catch(() => {});
  }, [connection, chat.version]);
  const base = useMemo(
    () => ({
      connection,
      push,
      capabilities,
      refused: refusedHere,
      disconnect: disconnectHere,
      ask,
    }),
    [ask, capabilities, connection, disconnectHere, push, refusedHere],
  );
  const full = useMemo(() => ({ ...base, chat }), [base, chat]);
  return (
    <BaseContext.Provider value={base}>
      <VersionContext.Provider value={chat.version}>
        <NodContext.Provider value={full}>{children}</NodContext.Provider>
      </VersionContext.Provider>
    </BaseContext.Provider>
  );
}

export function useNod() {
  const value = useContext(NodContext);
  if (!value) throw new Error('useNod needs a connected NodProvider.');
  return value;
}

export function useNodBase() {
  const value = useContext(BaseContext);
  if (!value) throw new Error('useNodBase needs a connected NodProvider.');
  return value;
}

export function useChatVersion() {
  return useContext(VersionContext);
}
