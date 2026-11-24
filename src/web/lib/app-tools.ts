import type { Connection } from '../../shared/contracts';
import { connectionIssue } from './secondary-pages';

export type Refreshed = {
  results: Array<{ connectionId: string; tools: number; added?: string[]; removed?: string[] }>;
};

export function mcpAccounts(accounts: Connection[]) {
  return accounts.filter((account) => account.accessPaths?.some((path) => path.kind === 'mcp'));
}

export function toolCountLabel(accounts: Connection[], counts: Record<string, number>) {
  const count = mcpAccounts(accounts)
    .map((account) => counts[account.connectionId ?? ''])
    .find((value) => value !== undefined);
  return count === undefined ? undefined : `${count} ${count === 1 ? 'tool' : 'tools'}`;
}

function names(list: string[]) {
  return list.length > 5
    ? `${list.slice(0, 5).join(', ')} and ${list.length - 5} more`
    : list.join(', ');
}

export function refreshSummary(name: string, { results }: Refreshed) {
  const [first] = results;
  if (!first) return `${name}: no tools found.`;
  const added = results.flatMap((result) => result.added ?? []);
  const removed = results.flatMap((result) => result.removed ?? []);
  const known = results.some((result) => result.added);
  const changes = [
    added.length ? `New: ${names(added)}.` : '',
    removed.length ? `Removed: ${names(removed)}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `${name}: ${first.tools} ${first.tools === 1 ? 'tool' : 'tools'}. ${
    changes || (known ? 'No changes.' : 'Nod will use this list from your next message.')
  }`;
}

export function accountIssue(service: Connection, accounts: Connection[]) {
  const usableNotion =
    service.slug === 'notion' &&
    accounts.some((account) => account.slug === 'notion' && !connectionIssue(account));
  return accounts.some(
    (account) => !(usableNotion && account.slug === 'notion_mcp') && connectionIssue(account),
  );
}

export function addAccountTarget(service: Connection, accounts: Connection[]) {
  const target =
    accounts.find(
      (account) => account.slug === service.slug && account.status !== 'not_configured',
    ) ??
    (service.direct ? service : undefined) ??
    accounts.find((account) => account.status !== 'not_configured') ??
    service;
  return !target.browserUrl && !target.savedLogin && target.status !== 'not_configured'
    ? target
    : undefined;
}
