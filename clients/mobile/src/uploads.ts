import { File } from 'expo-file-system';
import { ApiError, postAudio, postUpload, request } from './api';
import type { Connection } from './connection';

function filePart(uri: string, name: string, mimeType: string) {
  const file = new File(uri);
  return { name, type: mimeType, bytes: () => file.bytes() } as unknown as Blob;
}

export function sendAudio(
  connection: Connection,
  input: { id: string; threadId: string; uri: string; mimeType: string; name: string },
) {
  return postAudio(connection, input, filePart(input.uri, input.name, input.mimeType), input.name);
}

const preparations = new Map<string, Promise<unknown>>();

export function prepareTranscription(connection: Connection) {
  let pending = preparations.get(connection.origin);
  if (!pending) {
    pending = request(connection, '/api/speech/prepare', 'POST', { inputOnly: true }).catch(
      (error: unknown) => {
        preparations.delete(connection.origin);
        if (error instanceof ApiError && error.status === 404) return;
        throw error;
      },
    );
    preparations.set(connection.origin, pending);
  }
  return pending;
}

export function uploadFile(
  connection: Connection,
  input: { uri: string; name: string; mimeType: string },
  signal?: AbortSignal,
) {
  return postUpload(
    connection,
    filePart(input.uri, input.name, input.mimeType),
    input.name,
    signal,
  );
}
