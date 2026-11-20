import type { AssistantMessage, Context } from '@earendil-works/pi-ai';
import type { ModelAccess } from '../../ports/models.ts';
import type { VoiceTalker } from '../../ports/voice.ts';

const askNod = {
  name: 'ask_nod',
  description:
    'Hand the owner’s request to Nod’s full agent, which can use their apps, memory, files, the web and take actions. The server sends the owner’s own words from this call; you write nothing for it.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
};
import { createPiModelRuntime } from './models.ts';
import { piUsageMetrics } from './usage.ts';

export function createPiVoiceTalker(options: { resolve(): Promise<ModelAccess> }): VoiceTalker {
  return {
    async talk({ instructions, turns, canAskNod }, { signal, onText, report }) {
      const access = await options.resolve();
      const modelId = access.textModel?.definition.choice.id ?? access.definition.choice.id;
      await access.prepareRequest?.(modelId, false);
      const { runtime, model } = await createPiModelRuntime(access);
      const subscription = access.method === 'subscription';
      const transcript = turns
        .map((turn) => `${turn.role === 'user' ? 'Owner' : 'Nod'}: ${turn.content}`)
        .join('\n');
      const context: Context = {
        systemPrompt: instructions,
        messages: [
          {
            role: 'user',
            content: `The call so far:\n${transcript}\n\nReply as Nod to the owner's last words.`,
            timestamp: Date.now(),
          },
        ],
        ...(canAskNod ? { tools: [askNod] } : {}),
      };
      const started = performance.now();
      let reply: AssistantMessage | undefined;
      let spoken = '';
      let asked = false;
      try {
        const stream = runtime.streamSimple(model, context, {
          signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]),
          maxTokens: 600,
          reasoning: access.effort === 'off' ? undefined : access.effort,
        });
        for await (const event of stream) {
          if (event.type === 'text_delta' && event.delta) {
            spoken += event.delta;
            onText(event.delta);
          }
          if (event.type === 'toolcall_end' && event.toolCall.name === askNod.name) asked = true;
          if (event.type === 'done') reply = event.message;
          if (event.type === 'error') reply = event.error;
        }
        if (reply?.stopReason === 'error')
          throw new Error(
            `The voice model failed: ${reply.errorMessage || 'no reason given'} (${reply.provider}/${reply.model}).`,
          );
        return { spoken, askNod: asked };
      } finally {
        const metrics = piUsageMetrics(reply?.usage);
        report?.({
          id: crypto.randomUUID(),
          provider: reply?.provider ?? model.provider,
          model: reply?.model ?? model.id,
          category: 'agent',
          operation: 'voice',
          durationMs: performance.now() - started,
          ...metrics,
          status:
            reply?.stopReason === 'aborted' || (!reply && signal?.aborted)
              ? 'cancelled'
              : !reply || reply.stopReason === 'error'
                ? 'failed'
                : 'succeeded',
          costUsd: subscription ? null : (metrics.costUsd ?? null),
          ...(subscription ? { estimateUsd: metrics.costUsd ?? null } : {}),
          pricing: subscription ? 'unavailable' : (metrics.pricing ?? 'unavailable'),
        });
      }
    },
  };
}
