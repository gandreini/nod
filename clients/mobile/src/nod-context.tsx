import { router } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, type ReactNode } from 'react';
import { setDateFormat } from '../../../src/web/lib/date-format';
import { request } from './api';
import type { Connection } from './connection';
import type { Preferences } from './contracts';
import { useChat } from './use-chat';

interface Nod {
  connection: Connection;
  chat: ReturnType<typeof useChat>;
  refused(notice: string): void;
  disconnect(): Promise<void>;
  ask(text: string): void;
}

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
  return (
    <NodContext.Provider
      value={{ connection, chat, refused: refusedHere, disconnect: disconnectHere, ask }}
    >
      {children}
    </NodContext.Provider>
  );
}

export function useNod() {
  const value = useContext(NodContext);
  if (!value) throw new Error('useNod needs a connected NodProvider.');
  return value;
}
