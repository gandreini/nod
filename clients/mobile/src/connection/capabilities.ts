import { ApiError, request, refusedToken } from './api';
import type { Connection } from './connection';

export interface Capabilities {
  push?: { version: number; platforms: string[] };
  voice?: { version: number };
}

function version(value: unknown) {
  const number = (value as { version?: unknown } | null)?.version;
  return typeof number === 'number' && Number.isInteger(number) ? number : undefined;
}

export function parseCapabilities(value: unknown): Capabilities {
  const features = (value as { features?: unknown } | null)?.features;
  if (!features || typeof features !== 'object' || Array.isArray(features)) return {};
  const { push, voice } = features as { push?: { platforms?: unknown }; voice?: unknown };
  const parsed: Capabilities = {};
  const pushVersion = version(push);
  if (
    pushVersion !== undefined &&
    Array.isArray(push?.platforms) &&
    push.platforms.every((platform) => typeof platform === 'string')
  )
    parsed.push = { version: pushVersion, platforms: push.platforms as string[] };
  const voiceVersion = version(voice);
  if (voiceVersion !== undefined) parsed.voice = { version: voiceVersion };
  return parsed;
}

export async function loadCapabilities(
  connection: Connection,
  signal?: AbortSignal,
): Promise<Capabilities | undefined> {
  try {
    return parseCapabilities(
      await request<unknown>(
        connection,
        '/api/fork/capabilities',
        'GET',
        undefined,
        signal,
        15_000,
      ),
    );
  } catch (error) {
    if (refusedToken(error)) throw error;
    if (error instanceof ApiError && (error.status === 0 || error.status >= 500)) return undefined;
    return {};
  }
}
