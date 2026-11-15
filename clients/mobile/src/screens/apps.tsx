import { Blocks, CircleAlert, Plus, Search, X } from '../icons';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { searchApps } from '../../../../src/web/lib/app-search';
import { errorText } from '../api';
import { AppLogo } from '../app-logo';
import type { AppConnection } from '../contracts';
import { useNod } from '../nod-context';
import { radius, useTheme } from '../theme';
import { Button, Empty, Group, Loaded, Notice, Page, Pill, SectionTitle, text } from '../ui';
import { useRequest, useResource } from '../use-resource';

function search(items: AppConnection[], query: string) {
  return searchApps(
    items.map((app) => ({
      ...app,
      description: app.description ?? '',
      category: (app.categories ?? []).join(' '),
    })),
    query,
  );
}

function account(app: AppConnection) {
  return app.accountName || app.accountEmail || null;
}

function needsYou(app: AppConnection) {
  return Boolean(
    app.connectionId &&
    (app.reconnectRequired || app.status !== 'connected' || app.browserState === 'needs_sign_in'),
  );
}

function AppRow({
  app,
  first,
  busy,
  onPress,
}: {
  app: AppConnection;
  first: boolean;
  busy: boolean;
  onPress(): void;
}) {
  const theme = useTheme();
  const { connection } = useNod();
  const who = account(app);
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={[
        app.name,
        who,
        !app.connectionId
          ? 'Connect'
          : needsYou(app)
            ? 'Sign in again'
            : app.disconnectPending
              ? 'Disconnecting'
              : null,
      ]
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
        <AppLogo slug={app.slug} logoUrl={app.logoUrl} origin={connection.origin} theme={theme} />
      </View>
      <View style={styles.fill}>
        <Text style={[text.label, { color: theme.foreground }]} numberOfLines={1}>
          {app.name}
        </Text>
        {who ? (
          <Text style={[text.small, { color: theme.mutedForeground }]} numberOfLines={1}>
            {who}
          </Text>
        ) : null}
      </View>
      {!app.connectionId ? (
        <Text style={[text.label, { color: theme.accent }]}>Connect</Text>
      ) : needsYou(app) ? (
        <Pill label="Sign in again" icon={CircleAlert} kind="attention" />
      ) : app.disconnectPending ? (
        <Pill label="Disconnecting" />
      ) : null}
    </Pressable>
  );
}

export function AppsScreen() {
  const theme = useTheme();
  const { ask } = useNod();
  const send = useRequest();
  const apps = useResource<AppConnection[]>('/api/apps');
  const catalog = useResource<AppConnection[]>('/api/apps/catalog', { optional: true });
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState('');
  const searching = query.trim().length > 0;
  const find = (items: AppConnection[]) => (searching ? search(items, query) : items);
  const list = (apps.data ?? []).filter((app) => app.connectionId);
  const attention = find(list.filter(needsYou));
  const connected = find(list.filter((app) => !needsYou(app)));
  const taken = new Set(list.map((app) => app.slug));
  const pool = (catalog.data?.length ? catalog.data : (apps.data ?? [])).filter(
    (app) => !app.connectionId && app.status !== 'not_configured' && !taken.has(app.slug),
  );
  const matches = find(pool);
  const available = searching ? matches.slice(0, 60) : matches.slice(0, 40);
  const connect = () =>
    Alert.alert('Connect an app?', 'Nod asks you which app and opens the sign-in in the chat.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Connect', onPress: () => ask('Help me connect a new app. Ask me which one.') },
    ]);

  function manage(app: AppConnection) {
    if (!app.connectionId)
      return Alert.alert(`Connect ${app.name}?`, 'Nod opens the sign-in for you in the chat.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Connect', onPress: () => ask(`Help me connect ${app.name}.`) },
      ]);
    const who = account(app);
    const label = who ? `${app.name} (${who})` : app.name;
    const reconnect = needsYou(app)
      ? [{ text: 'Sign in again', onPress: () => ask(`Help me reconnect ${label}.`) }]
      : [];
    Alert.alert(label, 'Nod uses this account when you ask it to.', [
      ...reconnect,
      ...(app.connectionId && !app.disconnectPending
        ? [{ text: 'Disconnect', style: 'destructive' as const, onPress: () => disconnect(app) }]
        : []),
      { text: 'Close', style: 'cancel' },
    ]);
  }

  async function disconnect(app: AppConnection) {
    if (!app.connectionId) return;
    setBusy(app.connectionId);
    setError(undefined);
    try {
      await send(
        `/api/apps/${encodeURIComponent(app.slug)}/accounts/${encodeURIComponent(app.connectionId)}/disconnect`,
        'POST',
        {},
      );
    } catch (problem) {
      setError(`Disconnecting ${app.name} failed: ${errorText(problem)}`);
    } finally {
      setBusy(undefined);
      void apps.reload();
    }
  }

  const group = (items: AppConnection[]) => (
    <Group>
      {items.map((app, index) => (
        <AppRow
          key={app.connectionId ?? `${app.slug}:${index}`}
          app={app}
          first={index === 0}
          busy={busy !== undefined && busy === app.connectionId}
          onPress={() => manage(app)}
        />
      ))}
    </Group>
  );

  return (
    <Page
      title="Apps"
      back
      refreshing={apps.loading}
      onRefresh={apps.reload}
      action={
        list.length ? (
          <Button label="Connect" icon={Plus} variant="primary" onPress={connect} />
        ) : null
      }
    >
      {apps.data && (list.length || pool.length) ? (
        <View
          style={[styles.search, { backgroundColor: theme.surface, borderColor: theme.border }]}
        >
          <Search size={18} color={theme.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
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
              onPress={() => setQuery('')}
              hitSlop={8}
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
                  {matches.length > available.length ? (
                    <Text style={[text.small, styles.more, { color: theme.mutedForeground }]}>
                      {searching
                        ? `Showing ${available.length} of ${matches.length}. Type more to narrow it down.`
                        : `Showing the first ${available.length}. Search to find the other ${matches.length - available.length}.`}
                    </Text>
                  ) : null}
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
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
