import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import type { Connection } from '../../shared/contracts';
import { api, errorMessage } from '../lib/api';
import { ActionMenu, ActionMenuItem } from './action-menu';
import { Ellipsis, LoaderCircle, Pencil, Plus, RefreshCw, Users } from './icons';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Field,
  Input,
  Notice,
} from './ui';
import './app-card-menu.css';

type Refreshed = {
  results: Array<{ connectionId: string; tools: number; added?: string[]; removed?: string[] }>;
};

export function mcpAccounts(accounts: Connection[]) {
  return accounts.filter((account) => account.accessPaths?.some((path) => path.kind === 'mcp'));
}

export function useMcpToolCounts(apps: Connection[] | null | undefined) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const key = mcpAccounts(apps ?? [])
    .map((account) => account.connectionId)
    .join(',');
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    void api<{ counts: Array<{ connectionId: string; tools: number }> }>(
      '/api/fork/apps/mcp/tools',
      {
        signal: controller.signal,
      },
    )
      .then(({ counts }) =>
        setCounts((current) => ({
          ...current,
          ...Object.fromEntries(counts.map((count) => [count.connectionId, count.tools])),
        })),
      )
      .catch(() => undefined);
    return () => controller.abort();
  }, [key]);
  return [counts, setCounts] as const;
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

function summary(name: string, { results }: Refreshed) {
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

export function AppCardMenu({
  service,
  tools,
  accounts,
  serviceKey,
  issue,
  locked,
  pointerRestored,
  onPointerReset,
  onManage,
  onAddAccount,
  onRename,
  onCounts,
  onResult,
}: {
  service: Connection;
  tools?: string;
  accounts: Connection[];
  serviceKey: string;
  issue: boolean;
  locked: boolean;
  pointerRestored: boolean;
  onPointerReset(): void;
  onManage(event: MouseEvent<HTMLButtonElement>): void;
  onAddAccount?(): void;
  onRename?(name: string): Promise<void>;
  onCounts(counts: Record<string, number>): void;
  onResult(result: { kind: 'success' | 'error'; text: string }): void;
}) {
  const mcp = mcpAccounts(accounts).length > 0;
  const [refreshing, setRefreshing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [renameError, setRenameError] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function refreshTools() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setRefreshing(true);
    try {
      const result = await api<Refreshed>(
        `/api/fork/apps/mcp/${encodeURIComponent(service.slug)}/refresh`,
        { method: 'POST', signal: controller.signal },
      );
      onCounts(
        Object.fromEntries(result.results.map((entry) => [entry.connectionId, entry.tools])),
      );
      onResult({ kind: 'success', text: summary(service.name, result) });
    } catch (cause) {
      if (!controller.signal.aborted)
        onResult({ kind: 'error', text: `${service.name}: ${errorMessage(cause)}` });
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setRefreshing(false);
    }
  }

  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim();
    if (name === service.name) {
      setRenaming(false);
      return;
    }
    if (!onRename) return;
    setSaving(true);
    setRenameError('');
    try {
      await onRename(name);
      setRenaming(false);
    } catch (cause) {
      setRenameError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  const label = `${service.name} options${issue ? ', sign-in required' : ''}`;
  return (
    <>
      {accounts.length > 1 && (
        <span
          className="app-tool-count app-account-pill"
          title={`${accounts.length} accounts`}
          aria-label={`${accounts.length} accounts`}
        >
          <Users size={12} aria-hidden="true" />
          {accounts.length > 99 ? '99+' : accounts.length}
        </span>
      )}
      {tools && <span className="app-tool-count">{tools}</span>}
      <ActionMenu
        label={label}
        disabled={locked}
        contentClassName="app-card-menu"
        trigger={
          <Button
            ref={trigger}
            variant="ghost"
            size="icon"
            className="app-card-menu-trigger"
            data-manage-service={serviceKey}
            data-pointer-restored={pointerRestored || undefined}
            onKeyDown={onPointerReset}
            onBlur={onPointerReset}
            title={`${accounts.length} ${accounts.length === 1 ? 'account' : 'accounts'}${issue ? ' · Sign-in required' : ''}`}
            aria-busy={refreshing}
          >
            {refreshing ? (
              <LoaderCircle size={16} className="spin" aria-hidden="true" />
            ) : (
              <Ellipsis size={18} aria-hidden="true" />
            )}
            {issue && <span className="app-account-attention" aria-hidden="true" />}
          </Button>
        }
      >
        {(close) => (
          <>
            {mcp && (
              <ActionMenuItem
                disabled={refreshing}
                onClick={() => {
                  close();
                  void refreshTools();
                }}
              >
                <RefreshCw size={16} aria-hidden="true" />
                Refresh tools
              </ActionMenuItem>
            )}
            {onRename && (
              <ActionMenuItem
                onClick={() => {
                  close();
                  setRenameError('');
                  setRenaming(true);
                }}
              >
                <Pencil size={16} aria-hidden="true" />
                Rename
              </ActionMenuItem>
            )}
            <ActionMenuItem
              onClick={(event) => {
                close();
                onManage(event);
              }}
            >
              <Users size={16} aria-hidden="true" />
              Manage accounts
            </ActionMenuItem>
            {onAddAccount && (
              <ActionMenuItem
                onClick={() => {
                  close();
                  onAddAccount();
                }}
              >
                <Plus size={16} aria-hidden="true" />
                Add account
              </ActionMenuItem>
            )}
          </>
        )}
      </ActionMenu>
      <Dialog open={renaming} onOpenChange={(open) => !open && !saving && setRenaming(false)}>
        <DialogContent
          className="app-rename-dialog"
          aria-busy={saving}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus({ preventScroll: true });
          }}
        >
          <DialogTitle>Rename {service.name}</DialogTitle>
          <DialogDescription>Nod and your confirmations use this name.</DialogDescription>
          <form onSubmit={(event) => void rename(event)} autoComplete="off">
            <Field label="Name">
              <Input
                name="name"
                defaultValue={service.name}
                required
                maxLength={80}
                disabled={saving}
                autoFocus
              />
            </Field>
            {renameError && <Notice>{renameError}</Notice>}
            <div className="dialog-actions">
              <Button
                type="button"
                variant="ghost"
                disabled={saving}
                onClick={() => setRenaming(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
