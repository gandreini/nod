import type { Message } from './contracts';

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
