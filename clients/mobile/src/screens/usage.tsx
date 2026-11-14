import { CalendarClock, MessageCircle, ScanSearch, Undo2, Zap } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import type { TrustEntry, TrustPage, TrustSource, TrustView } from '../../../../src/shared/trust';
import {
  dayKey,
  formatDayLabel,
  formatTime,
  useDateFormat,
} from '../../../../src/web/lib/date-format';
import { money } from '../money';
import { becauseText } from '../../../../src/web/lib/trust-because';
import { request } from '../api';
import { useNod } from '../nod-context';
import { font, radius, useTheme } from '../theme';
import { Button, Card, Loading, Notice, Page, SectionTitle, text, type Icon } from '../ui';
import { describe, useResource } from '../use-resource';

const day = 86_400_000;

function dayLabel(at: string, format: ReturnType<typeof useDateFormat>) {
  try {
    return formatDayLabel(at, format);
  } catch {
    return new Date(at).toLocaleDateString(format.locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: format.timeZone,
    });
  }
}
const sources: Record<TrustSource, { icon: Icon; label: string }> = {
  chat: { icon: MessageCircle, label: '' },
  task: { icon: MessageCircle, label: 'Task' },
  started: { icon: ScanSearch, label: 'Task Nod started' },
  schedule: { icon: CalendarClock, label: 'Schedule' },
  event: { icon: Zap, label: '' },
  check: { icon: ScanSearch, label: 'Activity check' },
  resume: { icon: Undo2, label: '' },
};

function Summary({ view, onSaved }: { view: TrustView; onSaved(): void }) {
  const theme = useTheme();
  const format = useDateFormat();
  const { connection } = useNod();
  const { month, limit } = view;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(limit?.monthlyUsd ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const name = new Date(month.start).toLocaleDateString(format.locale, {
    month: 'long',
    timeZone: format.timeZone,
  });
  const resets = new Date(Date.parse(month.start) + month.days * day + day / 2).toLocaleDateString(
    format.locale,
    { day: 'numeric', month: 'long', timeZone: format.timeZone },
  );
  const share = limit ? Math.min(month.spentUsd / limit.monthlyUsd, 1) : 0;
  const forecastShare = limit ? Math.min(month.forecastUsd / limit.monthlyUsd, 1) : 0;
  const over = limit ? month.forecastUsd > limit.monthlyUsd : false;
  const notes = [
    month.planUsd > 0 &&
      `Your ChatGPT plan covered about ${money(month.planUsd)}${month.spentUsd > 0 ? ' more' : ''} at API prices.`,
    month.unpriced && 'Some usage has no price in Nod, such as a local or free model.',
    month.backgroundUsd > 0 &&
      `${money(month.backgroundUsd)} was background work: source checks, schedules and tasks Nod started.`,
  ].filter((note): note is string => Boolean(note));

  async function save(monthlyUsd: number | null) {
    if (monthlyUsd !== null && !(Number.isFinite(monthlyUsd) && monthlyUsd >= 1))
      return setError('Enter a limit of at least $1.');
    if (monthlyUsd !== null && Math.round(monthlyUsd * 100) !== monthlyUsd * 100)
      return setError('Use at most two decimals, for example 25.50.');
    setBusy(true);
    setError(undefined);
    try {
      await request(connection, '/api/trust/limit', 'PUT', { monthlyUsd });
      setEditing(false);
      onSaved();
    } catch (problem) {
      setError(`Saving the limit failed: ${describe(problem)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={styles.summary}>
      <Text style={[text.small, { color: theme.mutedForeground }]}>Spent in {name}</Text>
      <View style={styles.amountRow}>
        <Text style={[styles.amount, { color: theme.foreground }]}>{money(month.spentUsd)}</Text>
        <Text style={[text.body, { color: theme.mutedForeground }]}>
          {limit ? `of ${money(limit.monthlyUsd)}` : 'no monthly limit'}
        </Text>
      </View>
      {limit ? (
        <View style={[styles.track, { backgroundColor: theme.inset }]}>
          <View
            style={[
              styles.bar,
              {
                width: `${forecastShare * 100}%`,
                backgroundColor: over ? theme.errorSoft : theme.accentSoft,
              },
            ]}
          />
          <View
            style={[
              styles.bar,
              {
                width: `${share * 100}%`,
                backgroundColor: limit.reached ? theme.error : theme.primary,
              },
            ]}
          />
        </View>
      ) : null}
      {month.spentUsd > 0 ? (
        <Text style={[text.small, { color: over ? theme.error : theme.secondary }]}>
          On track for {money(month.forecastUsd)} this month
          {over ? ', above your limit' : ''}.
        </Text>
      ) : null}
      {limit?.reached ? (
        <Notice
          text={`Limit reached. New chat and background requests pause until ${resets}. Raise your limit to resume.`}
        />
      ) : null}
      {notes.map((note) => (
        <Text key={note} style={[text.small, { color: theme.mutedForeground }]}>
          {note}
        </Text>
      ))}
      {editing ? (
        <View style={styles.gap}>
          <View
            style={[
              styles.limitInput,
              { borderColor: theme.primary, backgroundColor: theme.background },
            ]}
          >
            <Text style={[text.body, { color: theme.mutedForeground }]}>$</Text>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              keyboardType="decimal-pad"
              autoFocus
              cursorColor={theme.accent}
              selectionColor={theme.primary}
              selectionHandleColor={theme.accent}
              accessibilityLabel="Monthly limit in US dollars"
              style={[text.body, styles.fill, { color: theme.foreground }]}
              onSubmitEditing={() => void save(Number(draft.replace(',', '.')))}
            />
          </View>
          <Text style={[text.small, { color: theme.mutedForeground }]}>
            At the limit, new requests pause until {resets}.
          </Text>
          {error ? <Notice text={error} /> : null}
          <View style={styles.actions}>
            <Button
              label="Save"
              variant="primary"
              busy={busy}
              disabled={!draft}
              onPress={() => void save(Number(draft.replace(',', '.')))}
            />
            {limit ? (
              <Button
                label="Remove limit"
                disabled={busy}
                onPress={() =>
                  Alert.alert(
                    'Remove the monthly limit?',
                    'Nod will keep working however much it spends this month.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Remove', style: 'destructive', onPress: () => void save(null) },
                    ],
                  )
                }
              />
            ) : null}
            <Button label="Cancel" disabled={busy} onPress={() => setEditing(false)} />
          </View>
        </View>
      ) : (
        <View style={styles.actions}>
          <Button label={limit ? 'Change limit' : 'Set a limit'} onPress={() => setEditing(true)} />
        </View>
      )}
    </Card>
  );
}

function EntryRow({ entry, first }: { entry: TrustEntry; first: boolean }) {
  const theme = useTheme();
  const format = useDateFormat();
  const { icon: SourceIcon, label } = sources[entry.source];
  const did = [...new Set(entry.actions.map((action) => action.label))].join(', ');
  const reasons = [
    ...new Set(
      entry.actions.flatMap((action) => (action.because ? [becauseText(action.because)] : [])),
    ),
  ];
  const models = [
    ...new Set((entry.models ?? []).map((model) => model.model ?? 'Model not recorded')),
  ];
  return (
    <View
      style={[
        styles.entry,
        { borderTopColor: theme.border, borderTopWidth: first ? 0 : StyleSheet.hairlineWidth },
      ]}
    >
      <View style={[styles.glyph, { backgroundColor: theme.muted }]}>
        <SourceIcon size={14} color={theme.secondary} />
      </View>
      <View style={[styles.fill, styles.tight]}>
        <Text style={[text.label, { color: theme.foreground }]}>{entry.title}</Text>
        <Text style={[text.small, { color: entry.error ? theme.error : theme.mutedForeground }]}>
          {[formatTime(entry.at, format), label].filter(Boolean).join(' · ')}
          {entry.error ? ` · ${entry.error}` : did ? ` · ${did}` : ''}
        </Text>
        {models.length ? (
          <Text style={[text.small, { color: theme.mutedForeground }]} numberOfLines={1}>
            {models.join(', ')}
          </Text>
        ) : null}
        {reasons.map((reason) => (
          <Text
            key={reason}
            style={[text.small, styles.because, { color: theme.secondary }]}
            numberOfLines={2}
          >
            {reason}
          </Text>
        ))}
      </View>
      {entry.costUsd !== null ? (
        <Text style={[text.small, styles.cost, { color: theme.foreground }]}>
          {money(entry.costUsd)}
        </Text>
      ) : entry.pricing ? (
        <Text style={[text.small, { color: theme.mutedForeground }]}>
          {entry.pricing === 'plan' ? 'Plan' : 'No price'}
        </Text>
      ) : null}
    </View>
  );
}

export function UsageScreen() {
  const theme = useTheme();
  const format = useDateFormat();
  const { connection } = useNod();
  const trust = useResource<TrustView>('/api/trust');
  const [older, setOlder] = useState<TrustPage>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string>();
  const ids = new Set(trust.data?.entries.map((entry) => entry.id));
  const entries = [
    ...(trust.data?.entries ?? []),
    ...(older?.entries ?? []).filter((entry) => !ids.has(entry.id)),
  ];
  const next = older ? older.next : trust.data?.next;
  const days = new Map<string, TrustEntry[]>();
  for (const entry of entries) {
    const key = dayKey(entry.at, format);
    days.set(key, [...(days.get(key) ?? []), entry]);
  }

  async function loadMore() {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    setMoreError(undefined);
    try {
      const page = await request<TrustPage>(
        connection,
        `/api/trust/entries?at=${encodeURIComponent(next.at)}&id=${next.id}`,
      );
      setOlder((current) => ({
        entries: [...(current?.entries ?? []), ...page.entries],
        next: page.next,
      }));
    } catch (problem) {
      setMoreError(`Older activity did not load: ${describe(problem)}`);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <Page
      title="Usage"
      back
      refreshing={trust.loading}
      onRefresh={() => {
        setOlder(undefined);
        void trust.reload();
      }}
    >
      {trust.error ? (
        <Notice text={`Usage did not load: ${trust.error}`} onRetry={trust.reload} />
      ) : null}
      {!trust.data ? (
        trust.error ? null : (
          <Loading />
        )
      ) : (
        <>
          <Summary view={trust.data} onSaved={trust.reload} />
          <View style={styles.weekRow}>
            {[
              [String(trust.data.week.things), 'things this week'],
              [String(trust.data.week.actions), 'app actions'],
              [money(trust.data.week.spentUsd), 'spent this week'],
            ].map(([value, label]) => (
              <Card key={label} style={styles.stat}>
                <Text style={[styles.statValue, { color: theme.foreground }]}>{value}</Text>
                <Text style={[text.small, { color: theme.mutedForeground }]}>{label}</Text>
              </Card>
            ))}
          </View>
          {[...days].map(([key, items]) => (
            <View key={key} style={styles.gap}>
              <SectionTitle>{dayLabel(items[0].at, format)}</SectionTitle>
              <View
                style={[
                  styles.group,
                  { backgroundColor: theme.surface, borderColor: theme.border },
                ]}
              >
                {items.map((entry, index) => (
                  <EntryRow key={entry.id} entry={entry} first={index === 0} />
                ))}
              </View>
            </View>
          ))}
          {moreError ? <Notice text={moreError} onRetry={loadMore} /> : null}
          {next ? (
            <Button label="Show earlier" busy={loadingMore} onPress={() => void loadMore()} />
          ) : null}
        </>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  gap: { gap: 8 },
  tight: { gap: 2 },
  summary: { gap: 12 },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  amount: { fontFamily: font.semibold, fontSize: 36, lineHeight: 42, letterSpacing: -1 },
  track: { height: 8, borderRadius: radius.full, overflow: 'hidden' },
  bar: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: radius.full },
  limitInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: radius.input,
    paddingHorizontal: 16,
    minHeight: 48,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  weekRow: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, gap: 4, padding: 12 },
  statValue: { fontFamily: font.semibold, fontSize: 20, letterSpacing: -0.4 },
  group: { borderWidth: 1, borderRadius: radius.card, overflow: 'hidden' },
  entry: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16 },
  glyph: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  because: { fontStyle: 'italic' },
  cost: { fontFamily: font.medium },
});
