import { Directory, File, Paths } from 'expo-file-system';
import type { Outgoing } from './chat-state';

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
  try {
    const file = index(origin);
    if (!file.exists) return [];
    const saved = JSON.parse(await file.text()) as { origin?: string; items?: Outgoing[] };
    if (saved.origin !== origin || !Array.isArray(saved.items)) return [];
    return saved.items.filter((item) => item.audio && new File(item.audio.uri).exists);
  } catch {
    return [];
  }
}

export async function forgetPending(origin: string) {
  const items = await loadPending(origin);
  items.forEach((item) => item.audio && dropRecording(item.audio.uri));
  const file = index(origin);
  if (file.exists) file.delete();
}
