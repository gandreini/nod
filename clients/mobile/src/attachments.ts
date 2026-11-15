import { fileBytes } from '../../../src/shared/files';
import type { Artifact } from './contracts';

export interface Draft {
  id: string;
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
  state: 'uploading' | 'ready' | 'failed';
  artifact?: Artifact;
  error?: string;
}

export function checkSize(file: { name: string; size?: number }) {
  if (file.size === undefined || file.size <= fileBytes) return undefined;
  return `${file.name} is larger than ${fileBytes / 1024 / 1024} MB, the most Nod accepts.`;
}

export function sendable(text: string, drafts: Draft[]) {
  return (
    (text.trim().length > 0 || drafts.length > 0) && drafts.every((item) => item.state === 'ready')
  );
}

export function attachmentIds(drafts: Draft[]) {
  return drafts.flatMap((item) => (item.artifact ? [item.artifact.id] : []));
}

export function isImage(mimeType: string) {
  return /^image\/(png|jpeg|webp|gif|heic|heif|avif|bmp)$/i.test(mimeType);
}

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export type AttachSource = 'camera' | 'photos' | 'files';
