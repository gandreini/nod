import * as SecureStore from 'expo-secure-store';
import type { Connection } from './connection';

const key = 'nod.connection';

export async function loadConnection(): Promise<Connection | null> {
  const value = await SecureStore.getItemAsync(key);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<Connection>;
    if (
      typeof parsed.origin === 'string' &&
      typeof parsed.token === 'string' &&
      typeof parsed.owner === 'string'
    )
      return { origin: parsed.origin, token: parsed.token, owner: parsed.owner };
  } catch {}
  await SecureStore.deleteItemAsync(key);
  return null;
}

export function saveConnection(connection: Connection) {
  return SecureStore.setItemAsync(key, JSON.stringify(connection));
}

export function forgetConnection() {
  return SecureStore.deleteItemAsync(key);
}
