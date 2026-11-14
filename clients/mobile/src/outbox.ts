import { ApiError } from './api';
import { unsent, voiceStep, type Outgoing } from './chat-state';
import type { Message } from './contracts';

export const retryDelays = [3000, 10000, 30000, 60000, 120000];

export interface OutboxDeps {
  thread(): string | null;
  sendText(item: Outgoing, threadId: string): Promise<unknown>;
  sendAudio(item: Outgoing, threadId: string, sendId: string): Promise<unknown>;
  arrived(sendId: string): Promise<boolean>;
  newId(): string;
  later(run: () => void, delay: number): void;
  onChange(items: Outgoing[]): void;
  onRefused(status: number): void;
  onDelivered(): void;
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function refusedAccess(problem: unknown) {
  return problem instanceof ApiError && problem.status === 403
    ? `The server refused the request: ${problem.message}`
    : undefined;
}

export function createOutbox(deps: OutboxDeps) {
  let items: Outgoing[] = [];
  let stopped = false;

  const publish = () => {
    if (!stopped) deps.onChange(items);
  };
  const update = (id: string, change: (item: Outgoing) => Outgoing) => {
    items = items.map((entry) => (entry.id === id ? change(entry) : entry));
    publish();
  };
  const later = (run: () => void, delay: number) =>
    deps.later(() => {
      if (!stopped) run();
    }, delay);

  async function deliver(item: Outgoing): Promise<void> {
    if (stopped) return;
    const thread = deps.thread();
    if (!thread) return later(() => void deliver(item), 1000);
    const sendId = item.sendId ?? item.id;
    try {
      if (item.audio) {
        await deps.sendAudio(item, thread, sendId);
        if (stopped) return;
        update(item.id, (entry) => ({ ...entry, sendId, status: 'sent', error: undefined }));
      } else await deps.sendText(item, thread);
      if (!stopped) deps.onDelivered();
    } catch (problem) {
      if (stopped) return;
      if (problem instanceof ApiError && problem.status === 401) return deps.onRefused(401);
      const reason = refusedAccess(problem) ?? describe(problem);
      if (!item.audio)
        return update(item.id, (entry) => ({ ...entry, status: 'failed', error: reason }));
      const failure =
        problem instanceof ApiError
          ? { status: problem.status, retryable: problem.retryable, reason: problem.reason }
          : { status: 0 };
      const delivered = await deps.arrived(sendId).catch(() => undefined);
      if (stopped) return;
      const step = voiceStep(failure, delivered);
      if (step === 'done') {
        update(item.id, (entry) => ({ ...entry, sendId, status: 'sent', error: undefined }));
        return deps.onDelivered();
      }
      const attempts = item.attempts ?? 0;
      if ((step === 'retry' || step === 'renew') && attempts < retryDelays.length) {
        const next: Outgoing = {
          ...item,
          sendId: step === 'renew' ? deps.newId() : sendId,
          attempts: attempts + 1,
          status: 'sending',
          error: reason,
        };
        update(item.id, () => next);
        return later(() => void deliver(next), retryDelays[attempts]);
      }
      update(item.id, (entry) => ({
        ...entry,
        status: 'failed',
        final: step === 'stop',
        error: reason,
      }));
    }
  }

  return {
    items: () => items,
    deliver,
    add(item: Outgoing) {
      items = [...items, item];
      publish();
      return deliver(item);
    },
    retry(id: string) {
      const item = items.find((entry) => entry.id === id);
      if (!item || item.status !== 'failed') return;
      const next: Outgoing = {
        ...item,
        ...(item.audio ? { sendId: item.final ? deps.newId() : item.sendId, attempts: 0 } : {}),
        status: 'sending',
        final: false,
        error: undefined,
      };
      update(id, () => next);
      return deliver(next);
    },
    discard(id: string) {
      items = items.filter((entry) => entry.id !== id || entry.status !== 'failed');
      publish();
    },
    restore(saved: Outgoing[], arrived: Set<string>) {
      const waiting = saved.filter(
        (item) =>
          !arrived.has(item.sendId ?? item.id) && !items.some((entry) => entry.id === item.id),
      );
      const revived = waiting.map((item): Outgoing =>
        item.final
          ? { ...item, status: 'failed' }
          : { ...item, attempts: 0, status: 'sending', error: undefined },
      );
      if (!revived.length) return Promise.resolve();
      items = [...items, ...revived];
      publish();
      return Promise.all(revived.filter((item) => item.status === 'sending').map(deliver)).then(
        () => {},
      );
    },
    revive() {
      const stalled = items.filter((item) => item.audio && item.status === 'failed' && !item.final);
      if (!stalled.length) return Promise.resolve();
      const revived = stalled.map((item): Outgoing => ({
        ...item,
        attempts: 0,
        status: 'sending',
      }));
      items = items.map((entry) => revived.find((item) => item.id === entry.id) ?? entry);
      publish();
      return Promise.all(revived.map(deliver)).then(() => {});
    },
    settle(messages: Message[]) {
      const next = unsent(items, messages);
      if (next.length === items.length) return;
      items = next;
      publish();
    },
    stop() {
      stopped = true;
    },
  };
}

export type Outbox = ReturnType<typeof createOutbox>;
