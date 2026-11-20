import { importPKCS8, SignJWT } from 'jose';
import { z } from 'zod';
import type { PushDevice, PushNotification, PushResult, PushSender } from '../../ports/push.ts';

const accountShape = z.object({
  type: z.literal('service_account'),
  project_id: z.string().regex(/^[a-z0-9-]{1,64}$/),
  client_email: z.email(),
  private_key: z.string().includes('PRIVATE KEY'),
  token_uri: z.url(),
});

export type ServiceAccount = z.infer<typeof accountShape>;

export function parseServiceAccount(raw: string): ServiceAccount {
  const text = raw.trim();
  for (const candidate of [text, Buffer.from(text, 'base64').toString('utf8')]) {
    try {
      const parsed = accountShape.safeParse(JSON.parse(candidate));
      if (parsed.success) return parsed.data;
    } catch {}
  }
  throw new Error(
    'NOD_FCM_SERVICE_ACCOUNT must be a Firebase service account JSON, or its base64.',
  );
}

const scope = 'https://www.googleapis.com/auth/firebase.messaging';

export function createFcmSender(
  account: ServiceAccount,
  options: { fcmOrigin?: string; fetch?: typeof fetch } = {},
): PushSender {
  const request = options.fetch ?? fetch;
  const fcmOrigin = options.fcmOrigin ?? 'https://fcm.googleapis.com';
  let cached: { token: string; until: number } | undefined;

  async function accessToken(signal?: AbortSignal): Promise<string | PushResult> {
    if (cached && cached.until > Date.now()) return cached.token;
    const key = await importPKCS8(account.private_key, 'RS256');
    const assertion = await new SignJWT({ scope })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(account.client_email)
      .setAudience(account.token_uri)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);
    const response = await request(account.token_uri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: signal ?? AbortSignal.timeout(15_000),
    });
    const json = (await response.json().catch(() => ({}))) as {
      access_token?: unknown;
      expires_in?: unknown;
      error?: unknown;
      error_description?: unknown;
    };
    if (!response.ok || typeof json.access_token !== 'string') {
      const detail = [json.error, json.error_description]
        .filter((part) => typeof part === 'string')
        .join(': ');
      return {
        status: 'failed',
        httpStatus: response.status,
        reason: `Google refused the Firebase service account: ${detail || response.statusText} (HTTP ${response.status})`,
      };
    }
    const seconds = typeof json.expires_in === 'number' ? json.expires_in : 3600;
    cached = { token: json.access_token, until: Date.now() + (seconds - 60) * 1000 };
    return cached.token;
  }

  async function send(
    device: PushDevice,
    notification: PushNotification,
    signal?: AbortSignal,
  ): Promise<PushResult> {
    try {
      const token = await accessToken(signal);
      if (typeof token !== 'string') return token;
      const response = await request(
        `${fcmOrigin}/v1/projects/${account.project_id}/messages:send`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: {
              token: device.token,
              notification: { title: notification.title, body: notification.body },
              data: notification.data,
              android: { priority: 'HIGH', notification: { channel_id: 'messages' } },
            },
          }),
          signal: signal ?? AbortSignal.timeout(15_000),
        },
      );
      if (response.ok) return { status: 'sent' };
      const json = (await response.json().catch(() => ({}))) as {
        error?: { message?: unknown; status?: unknown; details?: { errorCode?: unknown }[] };
      };
      const codes = (json.error?.details ?? []).map((detail) => detail.errorCode);
      if (response.status === 404 || codes.includes('UNREGISTERED')) return { status: 'gone' };
      if (response.status === 401) cached = undefined;
      const message =
        typeof json.error?.message === 'string' ? json.error.message : response.statusText;
      const status = typeof json.error?.status === 'string' ? `${json.error.status}, ` : '';
      return {
        status: 'failed',
        httpStatus: response.status,
        reason: `FCM refused the notification: ${message} (${status}HTTP ${response.status})`,
      };
    } catch (error) {
      return {
        status: 'failed',
        reason: `FCM could not be reached: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return { platforms: ['android'], send };
}
