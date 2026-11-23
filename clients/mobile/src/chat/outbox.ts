import { ApiError, errorText, refusedAccess, refusedToken } from '../connection/api';
import { busyRetries, inTail, nextStep, unsent, type Failure, type Outgoing } from './chat-state';
import type { Message } from '../connection/contracts';

const busyDelays = [3000, 10000, 30000];
const waitDelays = [5000, 15000, 30000, 60000];
const closedReason = 'This message was not sent before the app closed.';
export const hedgeAfter = 1500;

export async function sendQuickly(
  send: () => Promise<unknown>,
  {
    recover,
    suspect,
    after = hedgeAfter,
    onHedge = () => {},
    cancelled = () => false,
  }: {
    recover(): Promise<void>;
    suspect(): boolean;
    after?: number;
    onHedge?(): void;
    cancelled?(): boolean;
  },
) {
  const first = send();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<'slow'>((resolve) => {
    timer = setTimeout(() => resolve('slow'), after);
  });
  const winner = await Promise.race([first.then(() => 'sent' as const), slow]).finally(() =>
    clearTimeout(timer),
  );
  if (winner === 'sent' || cancelled()) return;
  if (!suspect()) {
    await first;
    return;
  }
  first.catch(() => {});
  onHedge();
  await recover();
  if (cancelled()) return;
  await send();
}

export interface OutboxDeps {
  thread(): string | null;
  sendText(item: Outgoing, threadId: string): Promise<unknown>;
  sendAudio(item: Outgoing, threadId: string, sendId: string): Promise<unknown>;
  arrived(sendId: string): Promise<boolean>;
  stale(): boolean;
  suspect(): boolean;
  recover(): Promise<void>;
  hedgeAfter?: number;
  newId(): string;
  later(run: () => void, delay: number): void;
  onChange(items: Outgoing[]): void;
  onRefused(status: number): void;
  onDropped(reason: string): void;
  onDelivered(): void;
}

export function createOutbox(deps: OutboxDeps) {
  let items: Outgoing[] = [];
  let stopped = false;
  let online = false;
  let inFlight: string | null = null;
  const held = new Set<string>();
  const waits = new Map<string, number>();
  const recovered = new Set<string>();

  const publish = () => {
    if (!stopped) deps.onChange(items);
  };
  const present = (id: string) => items.some((entry) => entry.id === id);
  const update = (id: string, change: (item: Outgoing) => Outgoing) => {
    items = items.map((entry) => (entry.id === id ? change(entry) : entry));
    publish();
  };
  const remove = (id: string) => {
    items = items.filter((entry) => entry.id !== id);
    held.delete(id);
    waits.delete(id);
    recovered.delete(id);
    publish();
  };
  const later = (run: () => void, delay: number) =>
    deps.later(() => {
      if (!stopped) run();
    }, delay);

  function hold(id: string, delay: number) {
    held.add(id);
    later(() => {
      held.delete(id);
      pump();
    }, delay);
  }

  function wake(id: string) {
    const count = waits.get(id) ?? 0;
    waits.set(id, count + 1);
    later(
      () => {
        const item = items.find((entry) => entry.id === id);
        if (!online || item?.status !== 'waiting') return;
        update(id, (entry) => ({ ...entry, status: 'queued' }));
        pump();
      },
      waitDelays[Math.min(count, waitDelays.length - 1)],
    );
  }

  function pump() {
    if (stopped || inFlight) return;
    const next = items.find((entry) => entry.status !== 'failed' && entry.status !== 'sent');
    if (!next || next.status !== 'queued' || held.has(next.id)) return;
    void deliver(next);
  }

  async function deliver(item: Outgoing): Promise<void> {
    const thread = deps.thread();
    if (!thread) return hold(item.id, 1000);
    const sendId = item.sendId ?? item.id;
    inFlight = item.id;
    update(item.id, (entry) => ({ ...entry, status: 'sending' }));
    try {
      if (deps.stale()) await deps.recover();
      if (stopped || !present(item.id)) return;
      if (item.audio) await deps.sendAudio(item, thread, sendId);
      else
        await sendQuickly(() => deps.sendText(item, thread), {
          recover: deps.recover,
          suspect: deps.suspect,
          after: deps.hedgeAfter,
          onHedge: () => recovered.add(item.id),
          cancelled: () => stopped || !present(item.id),
        });
      if (stopped) return;
      waits.delete(item.id);
      recovered.delete(item.id);
      if (present(item.id))
        update(item.id, (entry) => ({ ...entry, sendId, status: 'sent', error: undefined }));
      deps.onDelivered();
    } catch (problem) {
      if (stopped) return;
      if (refusedToken(problem)) {
        inFlight = null;
        return deps.onRefused(401);
      }
      await settleFailure(item, sendId, problem);
    } finally {
      if (inFlight === item.id) inFlight = null;
    }
    pump();
  }

  async function settleFailure(item: Outgoing, sendId: string, problem: unknown) {
    const reason = refusedAccess(problem) ?? errorText(problem);
    const failure: Failure =
      problem instanceof ApiError
        ? { status: problem.status, retryable: problem.retryable, reason: problem.reason }
        : { status: 0 };
    const voice = Boolean(item.audio);
    const check = voice || failure.status === 409;
    const delivered = check ? await deps.arrived(sendId).catch(() => undefined) : undefined;
    if (stopped || !present(item.id)) return;
    const attempts = item.attempts ?? 0;
    const step = nextStep(failure, delivered, {
      voice,
      attempts,
      recovered: recovered.has(item.id),
    });
    if (step === 'done') {
      update(item.id, (entry) => ({ ...entry, sendId, status: 'sent', error: undefined }));
      return deps.onDelivered();
    }
    if (step === 'drop') {
      remove(item.id);
      return deps.onDropped(reason);
    }
    if (step === 'recover') {
      recovered.add(item.id);
      update(item.id, (entry) => ({ ...entry, sendId, status: 'queued' }));
      await deps.recover();
      return;
    }
    if (step === 'wait') {
      update(item.id, (entry) => ({ ...entry, sendId, status: 'waiting', error: reason }));
      return wake(item.id);
    }
    if (step === 'retry' || step === 'renew') {
      recovered.delete(item.id);
      update(item.id, (entry) => ({
        ...entry,
        sendId: step === 'renew' ? deps.newId() : sendId,
        attempts: attempts + 1,
        status: 'queued',
        error: reason,
      }));
      return hold(item.id, step === 'renew' ? 0 : busyDelays[Math.min(attempts, busyRetries - 1)]);
    }
    update(item.id, (entry) => ({ ...entry, sendId, status: 'failed', error: reason }));
  }

  return {
    items: () => items,
    add(item: Outgoing) {
      items = [...items, { ...item, status: 'queued' }];
      publish();
      pump();
    },
    retry(id: string, createdAt: string) {
      const item = items.find((entry) => entry.id === id);
      if (!item || item.status !== 'failed') return;
      items = [
        ...items.filter((entry) => entry.id !== id),
        { ...item, createdAt, attempts: 0, status: 'queued', error: undefined },
      ];
      waits.delete(id);
      publish();
      pump();
    },
    discard(id: string) {
      const item = items.find((entry) => entry.id === id);
      if (!item || item.status === 'sent') return;
      remove(id);
      pump();
    },
    restore(saved: Outgoing[], messages: Message[]) {
      const known = new Set(messages.map((message) => message.id));
      const back = saved
        .filter((item) => !known.has(item.sendId ?? item.id) && !present(item.id))
        .map((item): Outgoing =>
          item.status === 'failed' || !inTail(item, messages)
            ? { ...item, status: 'failed', error: item.error ?? closedReason }
            : { ...item, status: 'queued' },
        );
      if (!back.length) return;
      items = [...items, ...back];
      publish();
      pump();
    },
    setOnline(next: boolean) {
      online = next;
      if (!next) return;
      const waiting = items.filter((entry) => entry.status === 'waiting');
      if (waiting.length) {
        items = items.map((entry) =>
          entry.status === 'waiting' ? { ...entry, status: 'queued' } : entry,
        );
        publish();
      }
      pump();
    },
    settle(messages: Message[]) {
      const next = unsent(items, messages);
      if (next.length === items.length) return;
      items = next;
      publish();
      pump();
    },
    stop() {
      stopped = true;
    },
  };
}

export type Outbox = ReturnType<typeof createOutbox>;
