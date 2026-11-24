import { Blocks, Ellipsis, Plus, Search, Users, X } from '../ui/icons';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { searchApps } from '../../../../src/web/lib/app-search';
import {
  accountIssue,
  addAccountTarget,
  mcpAccounts,
  refreshSummary,
  toolCountLabel,
  type Refreshed,
} from '../../../../src/web/lib/app-tools';
import { connectionGroups } from '../../../../src/web/lib/secondary-pages';
import { AccountsSheet, OptionsSheet, RenameSheet } from './app-sheets';
import { errorText } from '../connection/api';
import { AppLogo } from './app-logo';
import type { AppConnection } from '../connection/contracts';
import { useNodBase } from '../connection/nod-context';
import { radius, useTheme } from '../ui/theme';
import { Button, Empty, Group, Loaded, Notice, Page, Pill, SectionTitle, text } from '../ui/ui';
import { useRequest, useResource } from './use-resource';

const page = 40;

type AppGroup = ReturnType<typeof connectionGroups>[number];

function search(groups: AppGroup[], query: string) {
  return searchApps(
    groups.map((group) => ({
      ...group,
      name: group.service.name,
      slug: group.service.slug,
      description: group.service.description ?? '',
      category: (group.service.categories ?? []).join(' '),
    })),
    query,
  );
}

function Chip({
  label,
  onPress,
  disabled,
  filled,
  children,
}: {
  label: string;
  onPress(): void;
  disabled?: boolean;
  filled?: boolean;
  children: ReactNode | ((pressed: boolean) => ReactNode);
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: pressed ? theme.controlActive : filled ? theme.control : 'transparent',
        },
      ]}
    >
      {({ pressed }) => (typeof children === 'function' ? children(pressed) : children)}
    </Pressable>
  );
}

function AppRow({
  group,
  first,
  busy,
  tools,
  issue,
  onManage,
  onMore,
  onConnect,
}: {
  group: AppGroup;
  first: boolean;
  busy: boolean;
  tools?: string;
  issue: boolean;
  onManage(): void;
  onMore(): void;
  onConnect(): void;
}) {
  const theme = useTheme();
  const { connection } = useNodBase();
  const { service, accounts } = group;
  const count = accounts.length;
  return (
    <Pressable
      onPress={count ? onManage : onConnect}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={[service.name, tools, !count ? 'Connect' : issue ? 'Sign in again' : null]
        .filter(Boolean)
        .join(', ')}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? theme.controlActive : 'transparent',
          borderTopColor: theme.border,
          borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
          opacity: busy ? 0.5 : 1,
        },
      ]}
    >
      <View style={[styles.logo, { backgroundColor: theme.muted }]}>
        <AppLogo
          slug={service.slug}
          logoUrl={service.logoUrl}
          origin={connection.origin}
          theme={theme}
        />
      </View>
      <View style={styles.fill}>
        <View style={styles.heading}>
          <Text style={[text.label, styles.shrink, { color: theme.foreground }]} numberOfLines={1}>
            {service.name}
          </Text>
          {tools ? <Pill label={tools} /> : null}
        </View>
        {service.description ? (
          <Text style={[text.small, { color: theme.mutedForeground }]} numberOfLines={1}>
            {service.description}
          </Text>
        ) : null}
      </View>
      {count ? (
        <View style={styles.actions}>
          <Chip
            label={`Manage ${service.name} accounts (${count})${issue ? ', sign-in required' : ''}`}
            disabled={busy}
            onPress={onManage}
          >
            {(pressed) => (
              <>
                <Users size={16} color={theme.foreground} />
                <View style={styles.count}>
                  <Text style={[text.label, { color: theme.foreground, opacity: pressed ? 0 : 1 }]}>
                    {count > 99 ? '99+' : count}
                  </Text>
                  {pressed ? (
                    <View style={styles.plus}>
                      <Plus size={16} color={theme.foreground} />
                    </View>
                  ) : null}
                </View>
                {issue ? <View style={[styles.dot, { backgroundColor: theme.accent }]} /> : null}
              </>
            )}
          </Chip>
          <Chip label={`${service.name} options`} disabled={busy} onPress={onMore}>
            {busy ? (
              <ActivityIndicator size="small" color={theme.foreground} />
            ) : (
              <Ellipsis size={16} color={theme.foreground} />
            )}
          </Chip>
        </View>
      ) : (
        <Chip label={`Connect ${service.name}`} disabled={busy} filled onPress={onConnect}>
          <Text style={[text.label, { color: theme.foreground }]}>Connect</Text>
        </Chip>
      )}
    </Pressable>
  );
}

export function AppsScreen() {
  const theme = useTheme();
  const { ask, connection } = useNodBase();
  const send = useRequest();
  const apps = useResource<AppConnection[]>('/api/apps');
  const catalog = useResource<AppConnection[]>('/api/apps/catalog', { optional: true });
  const counted = useResource<{ counts: Array<{ connectionId: string; tools: number }> }>(
    '/api/fork/apps/mcp/tools',
    { optional: true },
  );
  const [refreshed, setRefreshed] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(page);
  const [sheet, setSheet] = useState<{ kind: 'accounts' | 'options' | 'rename'; key: string }>();
  const reload = apps.reload;
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') void reload();
    });
    return () => subscription.remove();
  }, [reload]);
  const counts = {
    ...Object.fromEntries(
      (counted.data?.counts ?? []).map((count) => [count.connectionId, count.tools]),
    ),
    ...refreshed,
  };
  const searching = query.trim().length > 0;
  const groups = apps.data ? connectionGroups(apps.data, catalog.data ?? []) : [];
  const find = (items: AppGroup[]) => (searching ? search(items, query) : items);
  const list = groups.filter((group) => group.accounts.length);
  const attention = find(list.filter((group) => accountIssue(group.service, group.accounts)));
  const connected = find(list.filter((group) => !accountIssue(group.service, group.accounts)));
  const pool = groups.filter(
    (group) => !group.accounts.length && group.service.status !== 'not_configured',
  );
  const matches = find(pool);
  const available = matches.slice(0, shown);
  const open = sheet && groups.find((group) => group.key === sheet.key);
  const connect = () =>
    Alert.alert('Connect an app?', 'Nod asks you which app and opens the sign-in in the chat.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Connect', onPress: () => ask('Help me connect a new app. Ask me which one.') },
    ]);

  async function signIn(key: string, app: AppConnection, addAccount = false) {
    setBusy(key);
    setError(undefined);
    try {
      const { url } = await send<{ url: string }>(
        `/api/apps/${encodeURIComponent(app.slug)}/connect`,
        'POST',
        {
          returnTo: 'window',
          ...(addAccount && app.accessPaths?.length ? { newAccount: true } : {}),
          ...((!addAccount || app.accessPaths?.length) && app.connectionId
            ? { connectionId: app.connectionId }
            : {}),
        },
      );
      await WebBrowser.openBrowserAsync(new URL(url, connection.origin).href, {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      });
    } catch (problem) {
      setError(`Connecting ${app.name} failed: ${errorText(problem)}`);
    } finally {
      setBusy(undefined);
      void apps.reload();
    }
  }

  async function disconnect(key: string, account: AppConnection) {
    if (!account.connectionId) return;
    setBusy(key);
    setError(undefined);
    try {
      await send(
        `/api/apps/${encodeURIComponent(account.slug)}/accounts/${encodeURIComponent(account.connectionId)}/disconnect`,
        'POST',
        {},
      );
    } catch (problem) {
      setError(`Disconnecting ${account.name} failed: ${errorText(problem)}`);
    } finally {
      setBusy(undefined);
      void apps.reload();
    }
  }

  async function refreshTools(group: AppGroup) {
    setBusy(group.key);
    setError(undefined);
    try {
      const result = await send<Refreshed>(
        `/api/fork/apps/mcp/${encodeURIComponent(group.service.slug)}/refresh`,
        'POST',
        {},
      );
      setRefreshed((current) => ({
        ...current,
        ...Object.fromEntries(result.results.map((entry) => [entry.connectionId, entry.tools])),
      }));
      Alert.alert('Tools refreshed', refreshSummary(group.service.name, result));
    } catch (problem) {
      setError(`Refreshing ${group.service.name} failed: ${errorText(problem)}`);
    } finally {
      setBusy(undefined);
    }
  }

  async function rename(group: AppGroup, name: string) {
    await send(`/api/apps/mcp/${encodeURIComponent(group.service.slug)}`, 'PATCH', { name });
    void apps.reload();
  }

  const group = (items: AppGroup[]) => (
    <Group>
      {items.map((item, index) => {
        const target = addAccountTarget(item.service, item.accounts);
        return (
          <AppRow
            key={item.key}
            group={item}
            first={index === 0}
            busy={busy === item.key}
            tools={item.accounts.length ? toolCountLabel(item.accounts, counts) : undefined}
            issue={accountIssue(item.service, item.accounts)}
            onManage={() => setSheet({ kind: 'accounts', key: item.key })}
            onMore={() => setSheet({ kind: 'options', key: item.key })}
            onConnect={() => void signIn(item.key, target ?? item.service)}
          />
        );
      })}
    </Group>
  );

  const openTarget = open ? addAccountTarget(open.service, open.accounts) : undefined;
  const add = open && openTarget ? () => void signIn(open.key, openTarget, true) : undefined;
  const close = () => setSheet(undefined);

  return (
    <Page
      title="Apps"
      back
      refreshing={apps.loading}
      onRefresh={apps.reload}
      onEndReached={() => {
        if (matches.length > shown) setShown(shown + page);
      }}
      action={
        list.length ? (
          <Button label="Connect" icon={Plus} variant="primary" onPress={connect} />
        ) : null
      }
    >
      {open && sheet?.kind === 'accounts' ? (
        <AccountsSheet
          name={open.service.name}
          accounts={open.accounts}
          theme={theme}
          onClose={close}
          onSignIn={(account) => void signIn(open.key, account)}
          onDisconnect={(account) => void disconnect(open.key, account)}
          onAdd={add}
        />
      ) : null}
      {open && sheet?.kind === 'options' ? (
        <OptionsSheet
          name={open.service.name}
          theme={theme}
          onClose={close}
          onRefresh={mcpAccounts(open.accounts).length ? () => void refreshTools(open) : undefined}
          onRename={
            open.service.canRename ? () => setSheet({ kind: 'rename', key: open.key }) : undefined
          }
          onManage={() => setSheet({ kind: 'accounts', key: open.key })}
          onAdd={add}
        />
      ) : null}
      {open && sheet?.kind === 'rename' ? (
        <RenameSheet
          name={open.service.name}
          theme={theme}
          onClose={close}
          onSave={(name) => rename(open, name)}
        />
      ) : null}
      {apps.data && (list.length || pool.length) ? (
        <View
          style={[styles.search, { backgroundColor: theme.surface, borderColor: theme.border }]}
        >
          <Search size={18} color={theme.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={(value) => {
              setQuery(value);
              setShown(page);
            }}
            placeholder={
              pool.length > 12 ? `Search ${pool.length + list.length} apps` : 'Search apps'
            }
            placeholderTextColor={theme.placeholder}
            cursorColor={theme.accent}
            selectionColor={theme.primary}
            selectionHandleColor={theme.accent}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search apps"
            style={[text.body, styles.searchInput, { color: theme.foreground }]}
          />
          {searching ? (
            <Pressable
              onPress={() => {
                setQuery('');
                setShown(page);
              }}
              hitSlop={13}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <X size={18} color={theme.mutedForeground} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {error ? <Notice text={error} /> : null}
      <Loaded resource={apps} label="Apps">
        {() =>
          !list.length && !searching ? (
            <Empty
              fill
              icon={Blocks}
              title="Connect your first app"
              body="Gmail, Calendar, Notion and more. Nod reads and acts in them only when your words allow it."
            >
              <Button label="Connect an app" icon={Plus} variant="primary" onPress={connect} />
            </Empty>
          ) : (
            <>
              {attention.length ? (
                <>
                  <SectionTitle count={attention.length}>Needs you</SectionTitle>
                  {group(attention)}
                </>
              ) : null}
              {connected.length ? (
                <>
                  <SectionTitle count={connected.length}>Connected</SectionTitle>
                  {group(connected)}
                </>
              ) : null}
              {available.length ? (
                <>
                  <SectionTitle count={matches.length}>
                    {searching ? 'Results' : 'All apps'}
                  </SectionTitle>
                  {group(available)}
                </>
              ) : null}
              {searching && !attention.length && !connected.length && !available.length ? (
                <Text style={[text.body, styles.more, { color: theme.mutedForeground }]}>
                  No apps match “{query.trim()}”.
                </Text>
              ) : null}
              {catalog.error && !searching ? (
                <Notice
                  text={`The full app list did not load: ${catalog.error}`}
                  onRetry={catalog.reload}
                />
              ) : null}
            </>
          )
        }
      </Loaded>
    </Page>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  shrink: { flexShrink: 1 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  actions: { flexDirection: 'row', alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minWidth: 36,
    height: 36,
    paddingHorizontal: 10,
    borderRadius: radius.full,
  },
  dot: { position: 'absolute', top: 5, right: 5, width: 6, height: 6, borderRadius: 3 },
  count: { minWidth: 16, alignItems: 'center', justifyContent: 'center' },
  plus: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: radius.full,
  },
  searchInput: { flex: 1, paddingVertical: 8 },
  more: { textAlign: 'center', paddingHorizontal: 16 },
  logo: {
    width: 40,
    height: 40,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
