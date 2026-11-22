import { z } from 'zod';
import type { VoiceAgents, VoiceEngineSettings } from '../../ports/voice.ts';

const engineCreated = z.object({ speech_engine_id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) });
const tokenIssued = z.object({ token: z.string().min(1).max(8192) });

function body(settings: VoiceEngineSettings) {
  return {
    name: settings.name,
    speech_engine: {
      ws_url: settings.wsUrl,
      request_headers: { [settings.secretHeader]: settings.secret },
    },
    tts: { model_id: settings.ttsModel, voice_id: settings.voiceId },
    language: settings.language,
    auth: { enable_auth: true },
    privacy: { record_voice: false },
  };
}

export function createElevenLabsVoiceAgents(
  key: string,
  options: { origin?: string; fetch?: typeof fetch } = {},
): VoiceAgents {
  const origin = options.origin ?? 'https://api.elevenlabs.io';
  const request = options.fetch ?? fetch;

  async function call(path: string, init: RequestInit, signal?: AbortSignal, hidden?: string) {
    const response = await request(`${origin}${path}`, {
      ...init,
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', ...init.headers },
      signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]),
    });
    const text = await response.text();
    if (!response.ok) {
      let reason = text.slice(0, 300) || response.statusText;
      try {
        const detail = JSON.parse(text)?.detail;
        reason =
          typeof detail === 'string'
            ? detail
            : typeof detail?.message === 'string'
              ? detail.message
              : reason;
      } catch {}
      if (hidden) reason = reason.replaceAll(hidden, '[voice secret]');
      throw Object.assign(
        new Error(
          `ElevenLabs refused ${init.method ?? 'GET'} ${path}: ${reason} (HTTP ${response.status})`,
        ),
        { statusCode: 502, status: response.status },
      );
    }
    return text ? JSON.parse(text) : undefined;
  }

  return {
    async createEngine(settings, signal) {
      const created = engineCreated.parse(
        await call(
          '/v1/speech-engine',
          { method: 'POST', body: JSON.stringify(body(settings)) },
          signal,
          settings.secret,
        ),
      );
      return created.speech_engine_id;
    },
    async updateEngine(id, settings, signal) {
      await call(
        `/v1/speech-engine/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: JSON.stringify(body(settings)) },
        signal,
        settings.secret,
      );
    },
    async conversationToken(engineId, signal) {
      const issued = tokenIssued.parse(
        await call(
          `/v1/convai/conversation/token?agent_id=${encodeURIComponent(engineId)}`,
          { method: 'GET' },
          signal,
        ),
      );
      return issued.token;
    },
  };
}
