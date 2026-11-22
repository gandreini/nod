import type { Connection } from './connection';
import { ownedArtifact } from './links';
import type {
  Artifact,
  AppSetupStatus,
  AppState,
  Message,
  MessageHistoryPage,
  QuestionAnswer,
  SubmitMessageResponse,
} from './contracts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly retryable?: boolean,
    readonly reason?: string,
  ) {
    super(message);
  }
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function refusedAccess(problem: unknown) {
  return problem instanceof ApiError && problem.status === 403
    ? `The server refused the request: ${problem.message}`
    : undefined;
}

export function refusedToken(problem: unknown): problem is ApiError {
  return problem instanceof ApiError && problem.status === 401;
}

export function tokenRefused(origin: string, status = 401) {
  return `${new URL(origin).host} no longer accepts the saved token (HTTP ${status}). Connect again with the current token.`;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export async function read<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: unknown;
  let parsed = false;
  try {
    data = text ? JSON.parse(text) : undefined;
    parsed = true;
  } catch {}
  if (!response.ok) {
    const detail = data as
      { message?: unknown; error?: unknown; code?: unknown; retryable?: unknown } | undefined;
    const reason =
      typeof detail?.message === 'string'
        ? detail.message
        : typeof detail?.error === 'string'
          ? detail.error
          : text.slice(0, 200) || response.statusText;
    throw new ApiError(
      response.status,
      `${reason} (HTTP ${response.status})`,
      typeof detail?.code === 'string' ? detail.code : undefined,
      typeof detail?.retryable === 'boolean' ? detail.retryable : undefined,
      reason,
    );
  }
  if (text && !parsed)
    throw new ApiError(
      response.status,
      `${response.url ? new URL(response.url).host : 'The server'} did not answer with JSON (HTTP ${response.status})`,
    );
  return data as T;
}

export function unreachable(connection: Connection, error: unknown) {
  const host = new URL(connection.origin).host;
  return new ApiError(
    0,
    `Can't reach ${host}. Check your connection.`,
    undefined,
    undefined,
    String(error),
  );
}

export async function fetchWithin(url: string, init: RequestInit = {}, timeout = 30_000) {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeout);
  try {
    return await fetch(url, { ...init, signal: deadline.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function request<T>(
  connection: Connection,
  path: string,
  method: Method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
  timeout = 30_000,
): Promise<T> {
  const form = body instanceof FormData;
  const deadline = new AbortController();
  let late = false;
  const timer = setTimeout(() => {
    late = true;
    deadline.abort();
  }, timeout);
  const cancel = () => deadline.abort();
  if (signal?.aborted) cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    let response: Response;
    try {
      response = await fetch(`${connection.origin}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${connection.token}`,
          ...(body === undefined || form ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: form ? body : JSON.stringify(body) }),
        signal: deadline.signal,
      });
      return await read<T>(response);
    } catch (error) {
      if (late)
        throw new ApiError(
          0,
          `${new URL(connection.origin).host} didn't answer within ${Math.round(timeout / 1000)} seconds. Check your connection.`,
        );
      if (error instanceof ApiError) throw error;
      throw unreachable(connection, error);
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

function api<T>(connection: Connection, path: string, body?: unknown) {
  return request<T>(connection, path, body === undefined ? 'GET' : 'POST', body);
}

export function getState(connection: Connection, signal?: AbortSignal) {
  return request<AppState>(connection, '/api/state', 'GET', undefined, signal, 15_000);
}

export async function messageArrived(connection: Connection, id: string) {
  try {
    await api<unknown>(connection, `/api/messages/around/${encodeURIComponent(id)}`);
    return true;
  } catch (problem) {
    if (problem instanceof ApiError && problem.status === 404) return false;
    throw problem;
  }
}

export function olderMessages(connection: Connection, threadId: string, oldest: Message) {
  const query = new URLSearchParams({
    threadId,
    before: oldest.createdAt,
    beforeId: oldest.id,
  });
  return api<MessageHistoryPage>(connection, `/api/messages?${query}`);
}

export interface OutgoingText {
  id: string;
  text: string;
  threadId: string;
  replyToMessageId?: string;
  questionAnswer?: QuestionAnswer;
  approvalAnswer?: { approvalId: string; approved: boolean };
  attachmentIds?: string[];
}

export function sendText(connection: Connection, input: OutgoingText, timeout = 10_000) {
  return request<SubmitMessageResponse>(
    connection,
    '/api/messages',
    'POST',
    {
      clientMessageId: input.id,
      text: input.text,
      threadId: input.threadId,
      ...(input.replyToMessageId ? { replyToMessageId: input.replyToMessageId } : {}),
      ...(input.questionAnswer ? { questionAnswer: input.questionAnswer } : {}),
      ...(input.approvalAnswer ? { approvalAnswer: input.approvalAnswer } : {}),
      ...(input.attachmentIds?.length ? { attachmentIds: input.attachmentIds } : {}),
    },
    undefined,
    timeout,
  );
}

export function appSetupStatus(connection: Connection, hashes: string[], connectionIds: string[]) {
  return api<AppSetupStatus>(connection, '/api/apps/setup-status', { hashes, connectionIds });
}

export function stopThread(connection: Connection) {
  return request<{ ok: true }>(connection, '/api/thread/stop', 'POST');
}

export function artifactSource(connection: Connection, url: string) {
  if (!ownedArtifact(url))
    throw new Error(`${url} is not a Nod file address, so Nod did not send it your token.`);
  return {
    uri: `${connection.origin}${url}`,
    headers: { Authorization: `Bearer ${connection.token}` },
  };
}

export function postAudio(
  connection: Connection,
  input: { id: string; threadId: string },
  file: Blob,
  name: string,
  timeout = 180_000,
) {
  const form = new FormData();
  form.append(
    'message',
    JSON.stringify({ clientMessageId: input.id, threadId: input.threadId, text: '' }),
  );
  form.append('file', file, name);
  return request<SubmitMessageResponse>(
    connection,
    '/api/messages/audio',
    'POST',
    form,
    undefined,
    timeout,
  );
}

export function postUpload(connection: Connection, file: Blob, name: string, signal?: AbortSignal) {
  const form = new FormData();
  form.append('file', file, name);
  return request<Artifact>(connection, '/api/uploads', 'POST', form, signal, 600_000);
}
