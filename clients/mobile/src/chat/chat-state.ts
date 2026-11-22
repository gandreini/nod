import {
  classifyVerificationReply,
  securityCodeIn,
} from '../../../../src/shared/verification-code';
import type { Activity, Message, VerificationRequest } from '../connection/contracts';

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
  privateText?: string;
  audio?: Recording;
  files?: LocalFile[];
  attachmentIds?: string[];
  status: 'queued' | 'sending' | 'waiting' | 'failed' | 'sent';
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

export function inTail(item: Outgoing, messages: Message[]) {
  const at = Date.parse(item.createdAt);
  return !messages.some((message) => Date.parse(message.createdAt) > at);
}

export type Step = 'done' | 'recover' | 'wait' | 'retry' | 'renew' | 'fail' | 'drop';

export interface Failure {
  status: number;
  retryable?: boolean;
  reason?: string;
}

export const busyRetries = 3;

export function nextStep(
  failure: Failure,
  delivered: boolean | undefined,
  { voice, attempts, recovered = false }: { voice: boolean; attempts: number; recovered?: boolean },
): Step {
  if (delivered) return 'done';
  const { status } = failure;
  const reason = failure.reason ?? '';
  if (status === 0) return recovered ? 'wait' : 'recover';
  if (voice && status === 400 && /no speech was detected/i.test(reason)) return 'drop';
  const again = attempts < busyRetries ? 'retry' : 'fail';
  if (status === 429 || status >= 500) return again;
  if (status === 409 && /work is stopping/i.test(reason)) return again;
  if (voice && status === 409 && /may already be in the conversation/i.test(reason))
    return delivered === false ? 'renew' : again;
  return 'fail';
}

export function privateCode(text: string, requests: VerificationRequest[] = []) {
  if (!text.trim() || !requests.length) return undefined;
  const otp =
    classifyVerificationReply(text).kind !== 'ordinary' &&
    requests.some((request) => request.kind === 'otp');
  const card =
    Boolean(securityCodeIn(text)) && requests.some((request) => request.kind === 'payment');
  if (!otp && !card) return undefined;
  return requests.every((request) => request.kind === 'payment')
    ? 'Security code sent securely.'
    : 'Verification code sent securely.';
}

export function codeRequestTargets(requests: VerificationRequest[] = [], messages: Message[]) {
  return new Map(
    requests.flatMap((request) => {
      const target = messages.findLast(
        (message) => message.role === 'assistant' && message.turnId === request.turnId,
      );
      return target ? [[target.id, request.kind] as const] : [];
    }),
  );
}

export function persistable(item: Outgoing) {
  if (item.privateText) return false;
  if (item.audio || item.files?.length) return true;
  const reply = classifyVerificationReply(item.text).kind;
  return reply !== 'code' && reply !== 'wrapped' && !securityCodeIn(item.text);
}
