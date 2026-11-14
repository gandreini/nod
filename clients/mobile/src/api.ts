import type { Connection } from './connection';
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

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export async function read<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
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
  return data as T;
}

export function unreachable(connection: Connection, error: unknown) {
  return new ApiError(0, `Could not reach ${new URL(connection.origin).host}: ${String(error)}`);
}

export async function request<T>(
  connection: Connection,
  path: string,
  method: Method = 'GET',
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${connection.origin}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${connection.token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    throw unreachable(connection, error);
  }
  return read<T>(response);
}

function api<T>(connection: Connection, path: string, body?: unknown) {
  return request<T>(connection, path, body === undefined ? 'GET' : 'POST', body);
}

export function getState(connection: Connection) {
  return api<AppState>(connection, '/api/state');
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

export function sendText(connection: Connection, input: OutgoingText) {
  return api<SubmitMessageResponse>(connection, '/api/messages', {
    clientMessageId: input.id,
    text: input.text,
    threadId: input.threadId,
    ...(input.replyToMessageId ? { replyToMessageId: input.replyToMessageId } : {}),
    ...(input.questionAnswer ? { questionAnswer: input.questionAnswer } : {}),
    ...(input.approvalAnswer ? { approvalAnswer: input.approvalAnswer } : {}),
    ...(input.attachmentIds?.length ? { attachmentIds: input.attachmentIds } : {}),
  });
}

export function appSetupStatus(connection: Connection, hashes: string[], connectionIds: string[]) {
  return api<AppSetupStatus>(connection, '/api/apps/setup-status', { hashes, connectionIds });
}

export function stopThread(connection: Connection) {
  return api<{ ok: true }>(connection, '/api/thread/stop', {});
}

export function artifactSource(connection: Connection, url: string) {
  return {
    uri: `${connection.origin}${url}`,
    headers: { Authorization: `Bearer ${connection.token}` },
  };
}

async function postForm<T>(
  connection: Connection,
  path: string,
  form: FormData,
  signal?: AbortSignal,
) {
  let response: Response;
  try {
    response = await fetch(`${connection.origin}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${connection.token}` },
      body: form,
      signal,
    });
  } catch (error) {
    throw unreachable(connection, error);
  }
  return read<T>(response);
}

export function postAudio(
  connection: Connection,
  input: { id: string; threadId: string },
  file: Blob,
  name: string,
) {
  const form = new FormData();
  form.append(
    'message',
    JSON.stringify({ clientMessageId: input.id, threadId: input.threadId, text: '' }),
  );
  form.append('file', file, name);
  return postForm<SubmitMessageResponse>(connection, '/api/messages/audio', form);
}

export function postUpload(connection: Connection, file: Blob, name: string, signal?: AbortSignal) {
  const form = new FormData();
  form.append('file', file, name);
  return postForm<Artifact>(connection, '/api/uploads', form, signal);
}
