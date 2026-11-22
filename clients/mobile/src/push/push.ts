import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { request } from '../connection/api';
import type { Connection } from '../connection/connection';

export const pushBuild = Platform.OS === 'android' && Constants.expoConfig?.extra?.push === true;

const key = 'nod.push';

export interface PushChoice {
  origin: string;
  enabled: boolean;
  asked: boolean;
  token?: string;
}

export async function loadPushChoice(connection: Connection): Promise<PushChoice> {
  const fresh = { origin: connection.origin, enabled: false, asked: false };
  try {
    const saved = JSON.parse((await SecureStore.getItemAsync(key)) ?? 'null') as PushChoice | null;
    return saved?.origin === connection.origin ? saved : fresh;
  } catch {
    return fresh;
  }
}

function saveChoice(choice: PushChoice) {
  return SecureStore.setItemAsync(key, JSON.stringify(choice));
}

async function prepareChannel() {
  await Notifications.setNotificationChannelAsync('messages', {
    name: 'Messages from Nod',
    importance: Notifications.AndroidImportance.HIGH,
  });
}

async function register(connection: Connection, choice: PushChoice, known?: string) {
  const token = known ?? String((await Notifications.getDevicePushTokenAsync()).data);
  await request(connection, '/api/fork/push/devices', 'PUT', { token, platform: 'android' });
  if (choice.token && choice.token !== token)
    await request(connection, '/api/fork/push/devices', 'DELETE', { token: choice.token }).catch(
      () => {},
    );
  await saveChoice({ ...choice, enabled: true, asked: true, token });
}

export async function enablePush(connection: Connection): Promise<'on' | 'denied'> {
  await prepareChannel();
  const current = await Notifications.getPermissionsAsync();
  const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
  const choice = await loadPushChoice(connection);
  if (!permission.granted) {
    await saveChoice({ ...choice, enabled: false, asked: true });
    return 'denied';
  }
  await register(connection, choice);
  return 'on';
}

export async function disablePush(connection: Connection) {
  const choice = await loadPushChoice(connection);
  if (choice.token)
    await request(connection, '/api/fork/push/devices', 'DELETE', { token: choice.token });
  await saveChoice({ origin: connection.origin, enabled: false, asked: true });
}

export async function refreshPush(connection: Connection, token?: string) {
  const choice = await loadPushChoice(connection);
  if (!choice.enabled || (token !== undefined && token === choice.token)) return;
  if (!(await Notifications.getPermissionsAsync()).granted) {
    await disablePush(connection);
    return;
  }
  await prepareChannel();
  await register(connection, choice, token);
}

export async function markAsked(connection: Connection) {
  await saveChoice({ ...(await loadPushChoice(connection)), asked: true });
}

export async function forgetPush(connection: Connection, tellServer: boolean) {
  if (!pushBuild) return;
  const choice = await loadPushChoice(connection);
  if (tellServer && choice.token)
    await request(
      connection,
      '/api/fork/push/devices',
      'DELETE',
      { token: choice.token },
      undefined,
      10_000,
    ).catch(() => {});
  if (choice.token) await Notifications.unregisterForNotificationsAsync().catch(() => {});
  await SecureStore.deleteItemAsync(key);
}
