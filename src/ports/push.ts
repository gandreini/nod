export type PushPlatform = 'android';

export interface PushDevice {
  token: string;
  platform: PushPlatform;
}

export interface PushNotification {
  title: string;
  body: string;
  data: Record<string, string>;
}

export type PushResult =
  | { status: 'sent' }
  | { status: 'gone' }
  | { status: 'failed'; reason: string; httpStatus?: number };

export interface PushSender {
  platforms: readonly PushPlatform[];
  send(
    device: PushDevice,
    notification: PushNotification,
    signal?: AbortSignal,
  ): Promise<PushResult>;
}
