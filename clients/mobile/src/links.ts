export type SafeLink =
  | { kind: 'external'; url: string }
  | { kind: 'server'; url: string }
  | { kind: 'artifact'; path: string; id: string };

const artifact =
  /^\/api\/artifacts\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function safeLink(href: string, origin: string): SafeLink | null {
  if (!href || /[\u0000-\u0020\u007f<>"'\\]/.test(href)) return null;
  let url: URL;
  let base: URL;
  try {
    base = new URL(origin);
    url = new URL(href, base);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  if (url.origin !== base.origin) return { kind: 'external', url: url.href };
  const match = artifact.exec(url.pathname);
  if (match && !url.search && !url.hash)
    return { kind: 'artifact', path: url.pathname, id: match[1] };
  return { kind: 'server', url: url.href };
}

export function imageArtifact(src: string, origin: string) {
  const link = safeLink(src, origin);
  return link?.kind === 'artifact' ? link : null;
}
