import { Check } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import {
  lightestEffort,
  modelSource,
  type ModelConnection,
  type ModelEffort,
  type ModelsResponse,
} from '../../../../src/shared/models';
import { formatClockTime, useDateFormat } from '../../../../src/web/lib/date-format';
import { request } from '../api';
import type { Preferences } from '../contracts';
import { useNod } from '../nod-context';
import { radius, useTheme } from '../theme';
import { Button, Card, Loading, Notice, Page, SectionTitle, text } from '../ui';
import { describe, useResource } from '../use-resource';

const effortNames: Record<ModelEffort, string> = {
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
};

function Models() {
  const theme = useTheme();
  const { connection } = useNod();
  const models = useResource<ModelsResponse>('/api/models');
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [picking, setPicking] = useState(false);
  const selection = models.data?.selection;
  const usable = (models.data?.connections ?? []).filter((row) => row.status === 'connected');
  const current = usable
    .find((row) => row.id === selection?.connectionId)
    ?.models.find((model) => model.id === selection?.modelId);

  async function choose(row: ModelConnection, modelId: string, effort?: ModelEffort) {
    const model = row.models.find((item) => item.id === modelId)!;
    const next =
      effort ??
      (selection && model.efforts.includes(selection.effort)
        ? selection.effort
        : lightestEffort(model.efforts));
    setBusy(`${row.id}:${modelId}:${effort ?? ''}`);
    setError(undefined);
    try {
      const view = await request<ModelsResponse>(connection, '/api/models/selection', 'PUT', {
        connectionId: row.id,
        modelId,
        effort: next,
      });
      models.setData(view);
      setPicking(false);
    } catch (problem) {
      setError(`Changing the model failed: ${describe(problem)}`);
    } finally {
      setBusy(undefined);
    }
  }

  if (models.error)
    return <Notice text={`Models did not load: ${models.error}`} onRetry={models.reload} />;
  if (!models.data) return <Loading />;
  if (!usable.length)
    return (
      <Card>
        <Text style={[text.body, { color: theme.secondary }]}>
          No model connection works right now. Add or reconnect one in Nod on your computer.
        </Text>
      </Card>
    );

  return (
    <>
      {error ? <Notice text={error} /> : null}
      {!picking && current ? (
        <Card style={styles.currentModel}>
          <View style={styles.fill}>
            <Text style={[text.title, { color: theme.foreground }]}>{current.name}</Text>
            <Text style={[text.small, { color: theme.mutedForeground }]}>
              {(() => {
                const row = usable.find((item) => item.id === selection?.connectionId)!;
                return row.label || modelSource(row);
              })()}
            </Text>
          </View>
          <Button label="Change" onPress={() => setPicking(true)} />
        </Card>
      ) : null}
      {(picking || !current) &&
        usable.map((row) => (
          <View key={row.id} style={styles.gap}>
            <Text style={[text.small, styles.source, { color: theme.mutedForeground }]}>
              {row.label || modelSource(row)}
            </Text>
            <View
              style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.border }]}
            >
              {row.models.map((model, index) => {
                const selected =
                  selection?.connectionId === row.id && selection.modelId === model.id;
                return (
                  <Pressable
                    key={model.id}
                    onPress={() => void choose(row, model.id)}
                    disabled={busy !== undefined || selected}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    style={({ pressed }) => [
                      styles.option,
                      {
                        backgroundColor: pressed ? theme.controlActive : 'transparent',
                        borderTopColor: theme.border,
                        borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                      },
                    ]}
                  >
                    <Text style={[text.label, styles.fill, { color: theme.foreground }]}>
                      {model.name}
                    </Text>
                    {selected ? <Check size={18} color={theme.accent} /> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      {current && current.efforts.length > 1 && selection ? (
        <>
          <Text style={[text.small, styles.source, { color: theme.mutedForeground }]}>
            Thinking effort
          </Text>
          <View style={styles.chips}>
            {current.efforts.map((effort) => {
              const on = selection.effort === effort;
              const row = usable.find((item) => item.id === selection.connectionId)!;
              return (
                <Pressable
                  key={effort}
                  onPress={() => void choose(row, current.id, effort)}
                  disabled={busy !== undefined || on}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  style={[styles.chip, { backgroundColor: on ? theme.primary : theme.control }]}
                >
                  <Text
                    style={[text.label, { color: on ? theme.primaryForeground : theme.foreground }]}
                  >
                    {effortNames[effort]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}
    </>
  );
}

function Behaviour() {
  const theme = useTheme();
  const format = useDateFormat();
  const { connection } = useNod();
  const preferences = useResource<Preferences>('/api/preferences');
  const [rules, setRules] = useState('');
  const [busy, setBusy] = useState<keyof Preferences>();
  const [error, setError] = useState<string>();
  const saved = preferences.data;
  useEffect(() => {
    if (saved) setRules(saved.rules);
  }, [saved?.rules]);

  async function save(patch: Partial<Preferences>, key: keyof Preferences) {
    setBusy(key);
    setError(undefined);
    try {
      const next = await request<Preferences>(connection, '/api/preferences', 'PATCH', patch);
      preferences.setData(next);
    } catch (problem) {
      setError(`Saving failed: ${describe(problem)}`);
      void preferences.reload();
    } finally {
      setBusy(undefined);
    }
  }

  if (preferences.error)
    return (
      <Notice text={`Settings did not load: ${preferences.error}`} onRetry={preferences.reload} />
    );
  if (!saved) return <Loading />;

  const toggle = (
    key: 'proactivePaused' | 'quietHoursEnabled',
    title: string,
    detail: string,
    value: boolean,
  ) => (
    <View style={styles.toggle}>
      <View style={styles.fill}>
        <Text style={[text.label, { color: theme.foreground }]}>{title}</Text>
        <Text style={[text.small, { color: theme.mutedForeground }]}>{detail}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={(next) =>
          void save({ [key]: key === 'proactivePaused' ? !next : next }, key)
        }
        disabled={busy !== undefined}
        accessibilityLabel={title}
        trackColor={{ false: theme.inset, true: theme.primary }}
        thumbColor={theme.surface}
      />
    </View>
  );

  return (
    <>
      {error ? <Notice text={error} /> : null}
      <Card style={styles.toggles}>
        {toggle(
          'proactivePaused',
          'Check my apps on its own',
          'Nod reads your connected accounts and tells you when something needs you.',
          !saved.proactivePaused,
        )}
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        {toggle(
          'quietHoursEnabled',
          'Quiet hours',
          `${formatClockTime(saved.quietStart, format)}–${formatClockTime(saved.quietEnd, format)}. Only urgent things reach you.`,
          saved.quietHoursEnabled,
        )}
      </Card>
      <SectionTitle>Your rules</SectionTitle>
      <Card>
        <Text style={[text.small, { color: theme.mutedForeground }]}>
          What Nod may do without asking, and what it must always ask about first.
        </Text>
        <TextInput
          value={rules}
          onChangeText={setRules}
          multiline
          maxLength={4000}
          placeholder="For example: always ask before sending an email to someone new."
          placeholderTextColor={theme.placeholder}
          cursorColor={theme.accent}
          selectionColor={theme.primary}
          selectionHandleColor={theme.accent}
          accessibilityLabel="Your rules"
          style={[
            text.body,
            styles.rules,
            {
              color: theme.foreground,
              borderColor: theme.input,
              backgroundColor: theme.background,
            },
          ]}
        />
        {rules !== saved.rules ? (
          <View style={styles.chips}>
            <Button
              label="Save rules"
              variant="primary"
              busy={busy === 'rules'}
              onPress={() => void save({ rules }, 'rules')}
            />
            <Button
              label="Discard"
              disabled={busy !== undefined}
              onPress={() => setRules(saved.rules)}
            />
          </View>
        ) : null}
      </Card>
    </>
  );
}

export function SettingsScreen() {
  return (
    <Page title="Settings" back>
      <SectionTitle>Model</SectionTitle>
      <Models />
      <SectionTitle>Behaviour</SectionTitle>
      <Behaviour />
    </Page>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  gap: { gap: 8 },
  source: { paddingHorizontal: 4, paddingTop: 4 },
  group: { borderWidth: 1, borderRadius: radius.card, overflow: 'hidden' },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  currentModel: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.full },
  toggles: { gap: 16 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  divider: { height: StyleSheet.hairlineWidth },
  rules: {
    minHeight: 120,
    borderWidth: 1,
    borderRadius: radius.input,
    padding: 12,
    textAlignVertical: 'top',
  },
});
