import { Directory, Paths } from 'expo-file-system';

const folder = new Directory(Paths.cache, 'nod-files');

export function downloadsFolder() {
  folder.create({ intermediates: true, idempotent: true });
  return folder;
}

export function clearDownloads() {
  try {
    if (folder.exists) folder.delete();
  } catch {}
}
