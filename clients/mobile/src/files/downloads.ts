import { Directory, File, Paths } from 'expo-file-system';

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

export function dropPicked(uri: string) {
  try {
    const file = new File(uri);
    if (file.uri.startsWith(Paths.cache.uri) && file.exists) file.delete();
  } catch {}
}

export function clearPicked() {
  for (const name of ['DocumentPicker', 'ImagePicker']) {
    try {
      const picked = new Directory(Paths.cache, name);
      if (picked.exists) picked.delete();
    } catch {}
  }
}
