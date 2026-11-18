import { Directory, File, Paths } from 'expo-file-system';
import type { Outgoing } from '../chat/chat-state';

const folder = new Directory(Paths.document, 'pending-voice');

function index(origin: string) {
  return new File(folder, `${origin.replace(/[^a-z0-9]+/gi, '_')}.json`);
}

export async function keepRecording(uri: string, id: string) {
  folder.create({ intermediates: true, idempotent: true });
  const target = new File(folder, `${id}.wav`);
  await new File(uri).copy(target);
  return target.uri;
}

function kept(uri: string) {
  const name = uri.split('/').pop();
  const here = name ? new File(folder, name) : null;
  return here?.exists ? here.uri : uri;
}

export function dropRecording(uri: string, anywhere = false) {
  try {
    const file = new File(uri);
    if ((anywhere || file.uri.startsWith(folder.uri)) && file.exists) file.delete();
  } catch {}
}

export async function savePending(origin: string, items: Outgoing[]) {
  const file = index(origin);
  if (!items.length) {
    if (file.exists) file.delete();
    return;
  }
  folder.create({ intermediates: true, idempotent: true });
  await file.write(JSON.stringify({ origin, items }));
}

export async function loadPending(origin: string): Promise<Outgoing[]> {
  const file = index(origin);
  if (!file.exists) return [];
  const saved = JSON.parse(await file.text()) as { origin?: string; items?: Outgoing[] } | null;
  if (saved?.origin !== origin || !Array.isArray(saved.items))
    throw new Error(`${file.uri} does not hold this server’s voice messages`);
  return saved.items
    .map((item) =>
      item.audio ? { ...item, audio: { ...item.audio, uri: kept(item.audio.uri) } } : item,
    )
    .filter((item) => !item.audio || new File(item.audio.uri).exists);
}

export async function forgetPending(origin: string) {
  const items = await loadPending(origin).catch((): Outgoing[] => []);
  items.forEach((item) => item.audio && dropRecording(item.audio.uri));
  const file = index(origin);
  if (file.exists) file.delete();
}
