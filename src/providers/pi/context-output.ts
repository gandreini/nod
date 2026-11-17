import { createHash } from 'node:crypto';
import { estimateTokens } from '@earendil-works/pi-coding-agent';
import {
  getCurrentSystemMessage,
  type ImageContent,
  type TextContent,
  type TranscriptContext,
} from '@earendil-works/pi-ai';
import type { WorkspaceSession } from '../../ports/computer.ts';
import { untrustedBlock, untrustedParts } from '../../shared/untrusted.ts';
import { writeWorkspaceFile } from './sandbox.ts';

const imageExtensions: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
};

export function contextTokens(context: Pick<TranscriptContext, 'messages'>) {
  return context.messages.reduce((total, message) => total + estimateTokens(message), 0);
}

export function toolOutputReference(
  name: string,
  content: Array<TextContent | ImageContent>,
  pointer: string,
) {
  return untrustedBlock(
    name === 'skills' &&
      content.some(
        (part) =>
          part.type === 'text' && part.text.startsWith(untrustedParts('learned skill').open),
      )
      ? 'learned skill'
      : name,
    pointer,
  );
}

export function createContextOutput(
  workspace: WorkspaceSession,
  shouldStop: () => boolean,
  ownerHeader?: string,
) {
  const files = new Map<string, string>();
  const save = async (
    content: Array<TextContent | ImageContent>,
    previewCharacters: number,
    signal?: AbortSignal,
  ) => {
    signal?.throwIfAborted();
    if (shouldStop()) throw new Error('The turn was stopped.');
    const text = content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n');
    const key = createHash('sha256').update(JSON.stringify(content)).digest('hex');
    let file = files.get(key);
    if (!file) {
      const directory = `${workspace.path}/.nod/outputs`;
      const { exitCode } = await workspace.exec(
        `mkdir -p -- '${directory.replaceAll("'", "'\\''")}'`,
        { signal },
      );
      if (exitCode)
        throw new Error(`Could not create the context output folder (exit ${exitCode}).`);
      const stem = `.nod/outputs/${key}`;
      file = `${stem}.txt`;
      if (content.some((part) => part.type === 'image')) {
        const saved = [];
        for (const [index, part] of content.entries()) {
          const mime =
            part.type === 'image' ? part.mimeType.toLowerCase().split(';')[0]!.trim() : '';
          const path = `${stem}-${index}.${part.type === 'image' ? (imageExtensions[mime] ?? 'bin') : 'txt'}`;
          await writeWorkspaceFile(
            workspace,
            `${workspace.path}/${path}`,
            part.type === 'image' ? Buffer.from(part.data, 'base64') : Buffer.from(part.text),
            signal,
          );
          saved.push(
            part.type === 'image'
              ? { type: 'image', path, mimeType: part.mimeType }
              : { type: 'text', path },
          );
        }
        file = `${stem}.json`;
        await writeWorkspaceFile(
          workspace,
          `${workspace.path}/${file}`,
          Buffer.from(JSON.stringify({ content: saved })),
          signal,
        );
      } else
        await writeWorkspaceFile(workspace, `${workspace.path}/${file}`, Buffer.from(text), signal);
      files.set(key, file);
    }
    const tail = Math.floor(previewCharacters / 2);
    return JSON.stringify({
      workspaceFile: file,
      characters: text.length,
      preview: text.length > previewCharacters ? text.slice(0, previewCharacters - tail) : text,
      ...(tail && text.length > previewCharacters ? { tail: text.slice(-tail) } : {}),
    });
  };
  return {
    save,
    async fit(context: TranscriptContext, limit: number, signal?: AbortSignal) {
      if (contextTokens(context) <= limit) return context;
      const system = getCurrentSystemMessage(context.messages);
      const messages = [
        ...(system ? [system] : []),
        ...context.messages.filter((message) => message.role !== 'system'),
      ];
      let tokens = contextTokens({ messages });
      const candidates = messages.flatMap((message, index) => {
        if (message.role === 'system') return [];
        const content =
          typeof message.content === 'string'
            ? [{ type: 'text' as const, text: message.content }]
            : message.content.filter((part) => part.type === 'text' || part.type === 'image');
        return content.length ? [{ index, message, content, tokens: estimateTokens(message) }] : [];
      });
      const fixed = tokens - candidates.reduce((total, item) => total + item.tokens, 0);
      const allowance = Math.max(128, Math.floor((limit - fixed) / Math.max(1, candidates.length)));
      for (const item of candidates.sort((a, b) => b.tokens - a.tokens)) {
        if (tokens <= limit) break;
        if (item.tokens <= allowance) continue;
        const pointer = await save(
          item.content,
          Math.max(0, Math.min(1000, (allowance - 128) * 3)),
          signal,
        );
        const text =
          item.message.role === 'toolResult' && !item.message.isError
            ? toolOutputReference(item.message.toolName, item.content, pointer)
            : item.message.role === 'user' &&
                ownerHeader &&
                item.content.some(
                  (part) => part.type === 'text' && part.text.startsWith(ownerHeader),
                )
              ? `${ownerHeader}\n${pointer}`
              : pointer;
        const content = [{ type: 'text' as const, text }];
        const next =
          item.message.role === 'assistant'
            ? {
                ...item.message,
                content: [
                  ...item.message.content.filter((part) => part.type !== 'text'),
                  ...content,
                ],
              }
            : { ...item.message, content };
        const size = estimateTokens(next);
        if (size >= item.tokens) continue;
        messages[item.index] = next;
        tokens += size - item.tokens;
      }
      return { ...context, messages };
    },
  };
}
