import { attachmentKind } from '../../../src/shared/attachment-kind';
import type { Artifact, Message } from './contracts';
import { ownedArtifact } from './links';

const textLimit = 4_000_000;

export type FileView = 'markdown' | 'text' | 'image' | 'outside';

const sourceOnly =
  /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/xml)(;|$)|\.(html?|xhtml|svg|xml|xsl|xslt)$/i;

export function conversationFiles(messages: Pick<Message, 'attachments'>[]): Artifact[] {
  const files = messages.flatMap((message) =>
    (message.attachments ?? []).filter(
      (item) => ownedArtifact(item.url) && !item.mimeType.startsWith('audio/'),
    ),
  );
  return [...new Map(files.map((file) => [file.id, file])).values()];
}

export function fileView(file: Pick<Artifact, 'name' | 'mimeType' | 'size'>): FileView {
  const kind = attachmentKind(file.mimeType, file.name);
  const readable = file.size <= textLimit;
  if (sourceOnly.test(file.mimeType) || sourceOnly.test(file.name))
    return readable ? 'text' : 'outside';
  if (kind === 'image') return 'image';
  if (kind === 'markdown') return readable ? 'markdown' : 'outside';
  if (kind === 'text' || kind === 'csv' || kind === 'n8n-workflow')
    return readable ? 'text' : 'outside';
  return 'outside';
}

export function fileType(name: string) {
  if (/\.n8n\.json$/i.test(name)) return 'n8n workflow';
  return /\.([a-z0-9]{1,10})$/i.exec(name)?.[1].toUpperCase() ?? 'File';
}
