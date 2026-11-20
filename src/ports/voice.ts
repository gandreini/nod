import type { ProviderUsageEvent } from './provider-usage.ts';

export interface VoiceTurn {
  role: 'user' | 'assistant';
  content: string;
}

export type VoiceUsage = Partial<ProviderUsageEvent> & {
  id: string;
  model: string;
  costUsd: number | null;
};

export interface VoiceTalker {
  talk(
    input: { instructions: string; turns: VoiceTurn[] },
    options: {
      signal?: AbortSignal;
      onText(text: string): void;
      report?(usage: VoiceUsage): void;
    },
  ): Promise<string>;
}

export interface VoiceEngineSettings {
  name: string;
  wsUrl: string;
  secretHeader: string;
  secret: string;
  voiceId: string;
  language: string;
  ttsModel: string;
}

export interface VoiceAgents {
  createEngine(settings: VoiceEngineSettings, signal?: AbortSignal): Promise<string>;
  updateEngine(id: string, settings: VoiceEngineSettings, signal?: AbortSignal): Promise<void>;
  conversationToken(engineId: string, signal?: AbortSignal): Promise<string>;
}
