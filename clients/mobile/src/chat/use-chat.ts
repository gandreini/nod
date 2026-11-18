import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { initialStreamState, streamReducer } from '../../../../src/web/lib/streams';
import {
  ApiError,
  errorText,
  getState,
  olderMessages,
  refusedAccess,
  sendText,
  stopThread,
  tokenRefused,
} from '../connection/api';
import { prepareTranscription, sendAudio } from '../files/uploads';
import type { Answer } from './cards';
import { attachmentIds, type Draft } from '../files/attachments';
import {
  keepOlder,
  mergeMessages,
  sendTime,
  workState,
  type Outgoing,
  type Recording,
} from './chat-state';
import { createOutbox, type Outbox } from './outbox';
import { dropRecording, keepRecording, loadPending, savePending } from '../voice/pending-voice';
import type { Connection } from '../connection/connection';
import type { AppState, Message } from '../connection/contracts';
import { useServerEvents, type ServerEvent } from './use-server-events';

export function useChat(connection: Connection, onRefused: (notice: string) => void) {
  const [state, setState] = useState<AppState | null>(null);
  const [older, setOlder] = useState<Message[]>([]);
  const [hasEarlier, setHasEarlier] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const [streams, dispatch] = useReducer(streamReducer, initialStreamState);
  const [error, setError] = useState<string>();
  const [voiceError, setVoiceError] = useState<string>();
  const [version, setVersion] = useState(0);
  const threadId = useRef<string | null>(null);
  const stateRef = useRef<AppState | null>(null);
  const inFlight = useRef(false);
  const again = useRef(false);
  const alive = useRef(true);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    alive.current = true;
    const pending = timers.current;
    return () => {
      alive.current = false;
      pending.forEach((timer) => clearTimeout(timer));
      pending.clear();
    };
  }, []);

  const later = useCallback((run: () => void, delay: number) => {
    if (!alive.current) return;
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      if (alive.current) run();
    }, delay);
    timers.current.add(timer);
  }, []);

  const refused = useCallback(
    (status: number) => {
      if (!alive.current) return;
      onRefused(tokenRefused(connection.origin, status));
    },
    [connection.origin, onRefused],
  );

  const refresh = useCallback(async () => {
    if (inFlight.current) {
      again.current = true;
      return;
    }
    inFlight.current = true;
    try {
      const next = await getState(connection);
      if (!alive.current) return;
      if (threadId.current && threadId.current !== next.threadId) setOlder([]);
      if (threadId.current !== next.threadId) setHasEarlier(Boolean(next.hasEarlierMessages));
      else if (next.hasEarlierMessages) setHasEarlier(true);
      const previous = stateRef.current;
      if (previous?.threadId === next.threadId)
        setOlder((current) => keepOlder(current, previous.messages, next.messages));
      threadId.current = next.threadId;
      stateRef.current = next;
      dispatch({
        type: 'persisted',
        threadId: next.threadId,
        streamIds: next.messages.flatMap((item) => (item.streamId ? [item.streamId] : [])),
        discardedTurnIds: next.turns
          .filter((turn) => turn.status === 'failed' || turn.status === 'cancelled')
          .map((turn) => turn.id),
      });
      setState(next);
      outbox.current?.settle(next.messages);
      setError(undefined);
    } catch (problem) {
      if (!alive.current) return;
      if (problem instanceof ApiError && problem.status === 401) return refused(problem.status);
      setError(refusedAccess(problem) ?? errorText(problem));
    } finally {
      inFlight.current = false;
      if (again.current && alive.current) {
        again.current = false;
        void refresh();
      }
    }
  }, [connection, refused]);

  const received = useCallback(
    (data: ServerEvent) => {
      if (data.type === 'refresh') {
        void refresh();
        setVersion((value) => value + 1);
      }
      if (data.type === 'activity' && Array.isArray(data.items)) {
        const items = data.items;
        setState((current) => (current ? { ...current, activity: items } : current));
      }
      if (
        data.type === 'delta' &&
        typeof data.threadId === 'string' &&
        typeof data.turnId === 'string'
      ) {
        if (threadId.current && data.threadId !== threadId.current) return void refresh();
        dispatch({
          type: 'delta',
          threadId: data.threadId,
          turnId: data.turnId,
          text: typeof data.text === 'string' ? data.text : '',
          ...(typeof data.streamId === 'string' ? { streamId: data.streamId } : {}),
          done: data.done === true,
        });
      }
    },
    [refresh],
  );

  const { live, reconnect: reconnectEvents } = useServerEvents(connection, {
    opened: () => {
      void refresh();
      void outbox.current?.revive();
    },
    received,
    refused,
    failed: setError,
    resumed: () => {
      void refresh();
      setVersion((value) => value + 1);
      void outbox.current?.revive();
    },
  });

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const deliveredRef = useRef<() => void>(() => {});
  deliveredRef.current = () => void refresh();
  const refusedRef = useRef(refused);
  refusedRef.current = refused;
  const outbox = useRef<Outbox | null>(null);
  if (!outbox.current)
    outbox.current = createOutbox({
      thread: () => threadId.current,
      sendText: (item, thread) =>
        sendText(connection, {
          id: item.id,
          text: item.text,
          threadId: thread,
          attachmentIds: item.attachmentIds,
        }),
      sendAudio: async (item, thread, sendId) => {
        await prepareTranscription(connection);
        await sendAudio(connection, { id: sendId, threadId: thread, ...item.audio! });
      },
      arrived: (sendId) =>
        getState(connection).then((next) => next.messages.some((message) => message.id === sendId)),
      newId: randomUUID,
      later,
      onChange: (items) => {
        if (alive.current) setOutgoing(items);
      },
      onRefused: (status) => refusedRef.current(status),
      onDelivered: () => deliveredRef.current(),
    });
  useEffect(() => () => outbox.current?.stop(), []);

  const send = useCallback((text: string, attachments: Draft[] = []) => {
    void outbox.current!.add({
      id: randomUUID(),
      text,
      ...(attachments.length
        ? {
            files: attachments.map(({ uri, name, mimeType, size }) => ({
              uri,
              name,
              mimeType,
              size,
            })),
            attachmentIds: attachmentIds(attachments),
          }
        : {}),
      status: 'sending',
      createdAt: sendTime(new Date(), stateRef.current?.messages ?? []),
    });
  }, []);

  const sendVoice = useCallback(async (audio: Recording) => {
    const id = randomUUID();
    const uri = await keepRecording(audio.uri, id).catch(() => audio.uri);
    if (uri !== audio.uri) dropRecording(audio.uri, true);
    if (!alive.current) return;
    void outbox.current!.add({
      id,
      text: '',
      audio: { ...audio, uri },
      status: 'sending',
      createdAt: sendTime(new Date(), stateRef.current?.messages ?? []),
    });
  }, []);

  const retry = useCallback((id: string) => void outbox.current!.retry(id), []);
  const discard = useCallback((id: string) => outbox.current!.discard(id), []);

  const kept = useRef(new Set<string>());
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (!hydrated) return;
    const voices = outgoing.filter((item) => item.audio && item.status !== 'sent');
    savePending(connection.origin, voices).catch((problem) => {
      if (alive.current)
        setVoiceError(`Could not keep the unsent voice message: ${errorText(problem)}`);
    });
    const now = new Set(voices.map((item) => item.audio!.uri));
    kept.current.forEach((uri) => {
      if (!now.has(uri)) dropRecording(uri);
    });
    kept.current = now;
  }, [connection.origin, hydrated, outgoing]);

  const restored = useRef(false);
  const restore = useCallback(() => {
    restored.current = true;
    loadPending(connection.origin).then(
      (items) => {
        if (!alive.current) return;
        setHydrated(true);
        const arrived = new Set(stateRef.current?.messages.map((message) => message.id));
        void outbox.current!.restore(items, arrived);
      },
      (problem) => {
        if (!alive.current) return;
        setHydrated(true);
        setVoiceError(`Unsent voice messages could not be read: ${errorText(problem)}`);
      },
    );
  }, [connection.origin]);
  const ready = state !== null;
  useEffect(() => {
    if (ready && !restored.current) restore();
  }, [ready, restore]);

  const reconnect = useCallback(() => {
    reconnectEvents();
    void refresh();
    setVoiceError(undefined);
  }, [reconnectEvents, refresh]);

  const answer: Answer = useCallback(
    async (reply) => {
      const thread = threadId.current;
      if (!thread) throw new Error('The conversation is still loading. Try again in a moment.');
      try {
        await sendText(connection, { id: randomUUID(), threadId: thread, ...reply });
        void refresh();
        return 'sent';
      } catch (problem) {
        if (problem instanceof ApiError) {
          if (problem.status === 401) {
            refused(problem.status);
            return 'unavailable';
          }
          const stale =
            problem.code === 'question_unavailable' ||
            problem.code === 'approval_unavailable' ||
            (Boolean(reply.approvalAnswer) && /no longer waiting/i.test(problem.reason ?? ''));
          if (problem.status === 409 && stale) {
            void refresh();
            return 'unavailable';
          }
          const access = refusedAccess(problem);
          if (access) throw new Error(access);
        }
        throw problem;
      }
    },
    [connection, refresh, refused],
  );

  const stop = useCallback(async () => {
    try {
      await stopThread(connection);
      void refresh();
    } catch (problem) {
      setError(`Stop failed: ${errorText(problem)}`);
    }
  }, [connection, refresh]);

  const messages = useMemo(() => mergeMessages(older, state?.messages ?? []), [older, state]);
  const pendingQuestions = useMemo(
    () =>
      new Set(
        state?.pendingAnswerChoiceMessageIds ??
          messages.filter((item) => item.answerChoicesPending).map((item) => item.id),
      ),
    [messages, state],
  );

  const loadOlder = useCallback(async () => {
    const thread = threadId.current;
    const oldest = messages[0];
    if (!thread || !oldest || !hasEarlier || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await olderMessages(connection, thread, oldest);
      if (!alive.current || threadId.current !== thread) return;
      setOlder((current) => mergeMessages(page.messages, current));
      setHasEarlier(page.hasMore);
    } catch (problem) {
      if (alive.current) setError(`Older messages did not load: ${errorText(problem)}`);
    } finally {
      if (alive.current) setLoadingOlder(false);
    }
  }, [connection, hasEarlier, loadingOlder, messages]);

  const turns = useMemo(() => state?.turns ?? [], [state]);
  const activity = state?.activity ?? [];
  const active = Object.entries(streams.active).map(([id, stream]) => ({ id, ...stream }));
  const writing = active.some((stream) => stream.text);
  const work = workState(activity, outgoing, writing);

  return {
    ready: state !== null,
    messages,
    turns,
    outgoing,
    streams: active,
    activity,
    ...work,
    live,
    version,
    error: error ?? voiceError,
    hasEarlier,
    loadingOlder,
    pendingQuestions,
    send,
    sendVoice,
    answer,
    retry,
    discard,
    stop,
    loadOlder,
    refresh,
    reconnect,
  };
}
