import type { Activity, Message } from '../connection/contracts';

export function workState(activity: Activity[], outgoing: Outgoing[], writing: boolean) {
  const working = activity.some((item) => !item.background);
  const sending = outgoing.some((item) => item.status === 'sending' && !item.attempts);
  return { working, thinking: (working || sending) && !writing };
}

export interface Recording {
  uri: string;
  mimeType: string;
  name: string;
  durationMillis: number;
}

export interface LocalFile {
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
}

export interface Outgoing {
  id: string;
  sendId?: string;
  attempts?: number;
  text: string;
  audio?: Recording;
  files?: LocalFile[];
  attachmentIds?: string[];
  status: 'sending' | 'sent' | 'failed';
  final?: boolean;
  error?: string;
  createdAt: string;
}

function order(a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) {
  const time = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  return time || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()].sort(order);
}

export function keepOlder(older: Message[], previous: Message[], next: Message[]): Message[] {
  const start = next[0];
  if (!older.length || !start) return older;
  return mergeMessages(
    older,
    previous.filter((message) => order(message, start) < 0),
  );
}

export type TimelineRow = { key: string; message: Message } | { key: string; outgoing: Outgoing };

export function timeline(messages: Message[], outgoing: Outgoing[]): TimelineRow[] {
  const rows = [
    ...messages.map((message) => ({ at: Date.parse(message.createdAt), key: message.id, message })),
    ...outgoing.map((item) => ({ at: Date.parse(item.createdAt), key: item.id, outgoing: item })),
  ];
  return rows.sort((a, b) => a.at - b.at).map(({ at: _at, ...row }) => row);
}

export function sendTime(now: Date, messages: Message[]) {
  const latest = Math.max(0, ...messages.map((message) => Date.parse(message.createdAt)));
  return new Date(Math.max(now.getTime(), latest + 1)).toISOString();
}

export function unsent(outgoing: Outgoing[], messages: Message[]): Outgoing[] {
  const delivered = new Set(messages.map((item) => item.id));
  return outgoing.filter((item) => !delivered.has(item.sendId ?? item.id));
}

export type VoiceStep = 'done' | 'retry' | 'renew' | 'stop';

export function voiceStep(
  failure: { status: number; retryable?: boolean; reason?: string },
  delivered: boolean | undefined,
): VoiceStep {
  if (delivered) return 'done';
  const { status } = failure;
  if (status === 0 || status === 429 || status >= 500 || failure.retryable === true) return 'retry';
  if (status === 409 && /may already be in the conversation/i.test(failure.reason ?? ''))
    return delivered === false ? 'renew' : 'retry';
  return 'stop';
}
