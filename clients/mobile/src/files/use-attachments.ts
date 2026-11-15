import { randomUUID } from 'expo-crypto';
import { getDocumentAsync } from 'expo-document-picker';
import {
  launchCameraAsync,
  launchImageLibraryAsync,
  requestCameraPermissionsAsync,
  type ImagePickerAsset,
} from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { checkSize, type AttachSource, type Draft } from './attachments';
import { allowIn } from '../connection/permissions';
import type { Connection } from '../connection/connection';
import { uploadFile } from './uploads';
import { ApiError, errorText, refusedAccess, tokenRefused } from '../connection/api';
import { useNod } from '../connection/nod-context';

type Picked = { uri: string; name: string; mimeType: string; size?: number };

function fromImage(asset: ImagePickerAsset): Picked {
  const video = asset.type === 'video';
  const extension = video ? 'mp4' : 'jpg';
  return {
    uri: asset.uri,
    name: asset.fileName || `${video ? 'video' : 'photo'}-${Date.now()}.${extension}`,
    mimeType: asset.mimeType || (video ? 'video/mp4' : 'image/jpeg'),
    size: asset.fileSize,
  };
}

export function useAttachments(connection: Connection) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState<string>();
  const { refused } = useNod();
  const uploads = useRef(new Map<string, AbortController>());

  useEffect(() => {
    const running = uploads.current;
    return () => running.forEach((controller) => controller.abort());
  }, []);

  const upload = useCallback(
    async (draft: Draft) => {
      const controller = new AbortController();
      uploads.current.set(draft.id, controller);
      try {
        const artifact = await uploadFile(connection, draft, controller.signal);
        if (controller.signal.aborted) return;
        setDrafts((current) =>
          current.map((item) =>
            item.id === draft.id ? { ...item, state: 'ready', artifact, error: undefined } : item,
          ),
        );
      } catch (problem) {
        if (controller.signal.aborted) return;
        if (problem instanceof ApiError && problem.status === 401)
          return refused(tokenRefused(connection.origin, problem.status));
        const reason = refusedAccess(problem) ?? errorText(problem);
        setDrafts((current) =>
          current.map((item) =>
            item.id === draft.id ? { ...item, state: 'failed', error: reason } : item,
          ),
        );
      } finally {
        if (uploads.current.get(draft.id) === controller) uploads.current.delete(draft.id);
      }
    },
    [connection, refused],
  );

  const add = useCallback(
    (files: Picked[]) => {
      const checked = files.map((file) => ({ file, problem: checkSize(file) }));
      const tooLarge = checked.flatMap(({ problem }) => (problem ? [problem] : []));
      setError(tooLarge.length ? tooLarge.join(' ') : undefined);
      const accepted = checked
        .filter(({ problem }) => !problem)
        .map(({ file }): Draft => ({ ...file, id: randomUUID(), state: 'uploading' }));
      if (!accepted.length) return;
      setDrafts((current) => [...current, ...accepted]);
      accepted.forEach((draft) => void upload(draft));
    },
    [upload],
  );

  async function pick(source: AttachSource) {
    setError(undefined);
    try {
      if (source === 'files') {
        const result = await getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
        if (result.canceled) return;
        return add(
          result.assets.map((asset) => ({
            uri: asset.uri,
            name: asset.name,
            mimeType: asset.mimeType || 'application/octet-stream',
            size: asset.size,
          })),
        );
      }
      if (source === 'camera') {
        const permission = await requestCameraPermissionsAsync();
        if (!permission.granted)
          return setError(`Nod needs the camera to take a photo. ${allowIn}`);
        const result = await launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 });
        if (result.canceled) return;
        return add(result.assets.map(fromImage));
      }
      const result = await launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: true,
        quality: 0.85,
      });
      if (result.canceled) return;
      add(result.assets.map(fromImage));
    } catch (problem) {
      setError(`Could not add the file: ${errorText(problem)}`);
    }
  }

  function remove(id: string) {
    uploads.current.get(id)?.abort();
    uploads.current.delete(id);
    setDrafts((current) => current.filter((item) => item.id !== id));
  }

  function retry(id: string) {
    const draft = drafts.find((item) => item.id === id);
    if (!draft || draft.state !== 'failed') return;
    const next: Draft = { ...draft, state: 'uploading', error: undefined };
    setDrafts((current) => current.map((item) => (item.id === id ? next : item)));
    void upload(next);
  }

  function clear() {
    setDrafts([]);
    setError(undefined);
  }

  return { drafts, error, clearError: () => setError(undefined), pick, remove, retry, clear };
}
