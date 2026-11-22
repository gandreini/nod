import { Check } from '../ui/icons';
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
import { errorText } from '../connection/api';
import { useNodBase } from '../connection/nod-context';
import type { Preferences } from '../connection/contracts';
import { radius, useTheme } from '../ui/theme';
import { Button, Card, Group, Loaded, Notice, Page, SectionTitle, text } from '../ui/ui';
import { useRequest, useResource } from './use-resource';

const effortNames: Record<ModelEffort, string> = {
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
};

type ModelChoice = { connectionId: string; modelId: string; effort: ModelEffort };

function ModelChooser({
  connections,
  selection: saved,
  save,
  automatic,
}: {
  connections: ModelConnection[];
  selection: ModelChoice | null | undefined;
  save(choice: ModelChoice | null): Promise<void>;
  automatic?: { title: string; detail: string };
}) {
  const theme = useTheme();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [picking, setPicking] = useState(false);
  const [optimistic, setOptimistic] = useState<{ choice: ModelChoice | null }>();
  const selection = optimistic ? optimistic.choice : saved;
  const usable = connections.filter((row) => row.status === 'connected');
  const currentRow = usable.find((row) => row.id === selection?.connectionId);
  const current = currentRow?.models.find((model) => model.id === selection?.modelId);

  async function choose(key: string, choice: ModelChoice | null) {
    setBusy(key);
    setError(undefined);
    setOptimistic({ choice });
    setPicking(false);
    try {
      await save(choice);
    } catch (problem) {
      setError(`Changing the model failed: ${errorText(problem)}`);
    } finally {
      setOptimistic(undefined);
      setBusy(undefined);
    }
  }

  function pick(row: ModelConnection, modelId: string, effort?: ModelEffort) {
    const model = row.models.find((item) => item.id === modelId)!;
    const next =
      effort ??
      (selection && model.efforts.includes(selection.effort)
        ? selection.effort
        : lightestEffort(model.efforts));
    void choose(`${row.id}:${modelId}:${effort ?? ''}`, {
      connectionId: row.id,
      modelId,
      effort: next,
    });
  }

  if (!usable.length)
    return (
      <Card>
        <Text style={[text.body, { color: theme.secondary }]}>
          No model connection works right now. Add or reconnect one in Nod on your computer.
        </Text>
      </Card>
    );

  const chosen = currentRow && current;
  return (
    <>
      {error ? <Notice text={error} /> : null}
      {!picking && (chosen || (automatic && !selection)) ? (
        <Card style={styles.currentModel}>
          <View style={styles.fill}>
            <Text style={[text.title, { color: theme.foreground }]}>
              {chosen ? current.name : automatic!.title}
            </Text>
            <Text style={[text.small, { color: theme.mutedForeground }]}>
              {chosen ? currentRow.label || modelSource(currentRow) : automatic!.detail}
            </Text>
          </View>
          <Button label="Change" onPress={() => setPicking(true)} />
        </Card>
      ) : null}
      {(picking || (!chosen && !(automatic && !selection))) && (
        <>
          {automatic ? (
            <Group>
              <Pressable
                onPress={() => void choose('automatic', null)}
                disabled={busy !== undefined || !selection}
                accessibilityRole="radio"
                accessibilityState={{ checked: !selection }}
                style={({ pressed }) => [
                  styles.option,
                  { backgroundColor: pressed ? theme.controlActive : 'transparent' },
                ]}
              >
                <View style={styles.fill}>
                  <Text style={[text.label, { color: theme.foreground }]}>{automatic.title}</Text>
                  <Text style={[text.small, { color: theme.mutedForeground }]}>
                    {automatic.detail}
                  </Text>
                </View>
                {!selection ? <Check size={18} color={theme.accent} /> : null}
              </Pressable>
            </Group>
          ) : null}
          {usable.map((row) => (
            <View key={row.id} style={styles.gap}>
              <Text style={[text.small, styles.source, { color: theme.mutedForeground }]}>
                {row.label || modelSource(row)}
              </Text>
              <Group>
                {row.models.map((model, index) => {
                  const selected =
                    selection?.connectionId === row.id && selection.modelId === model.id;
                  return (
                    <Pressable
                      key={model.id}
                      onPress={() => pick(row, model.id)}
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
              </Group>
            </View>
          ))}
          {picking ? <Button label="Cancel" onPress={() => setPicking(false)} /> : null}
        </>
      )}
      {chosen && current.efforts.length > 1 && selection ? (
        <>
          <Text style={[text.small, styles.source, { color: theme.mutedForeground }]}>
            Thinking effort
          </Text>
          <View style={styles.chips}>
            {current.efforts.map((effort) => {
              const on = selection.effort === effort;
              return (
                <Pressable
                  key={effort}
                  onPress={() => pick(currentRow, current.id, effort)}
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

type ModelsResource = ReturnType<typeof useResource<ModelsResponse>>;

function Models({ models }: { models: ModelsResource }) {
  const send = useRequest();
  return (
    <Loaded resource={models} label="Models">
      {(view) => (
        <ModelChooser
          connections={view.connections}
          selection={view.selection}
          save={async (choice) => {
            models.setData(await send<ModelsResponse>('/api/models/selection', 'PUT', choice));
          }}
        />
      )}
    </Loaded>
  );
}

function VoiceCallModel({ models }: { models: ModelsResource }) {
  const send = useRequest();
  const voice = useResource<{ model: ModelChoice | null }>('/api/fork/voice/settings');
  return (
    <Loaded resource={models} label="Models">
      {(view) => (
        <Loaded resource={voice} label="Voice call">
          {(saved) => (
            <ModelChooser
              connections={view.connections}
              selection={saved.model}
              automatic={{
                title: 'Automatic',
                detail: 'Nod’s fastest model on your main connection.',
              }}
              save={async (model) => {
                voice.setData(
                  await send<{ model: ModelChoice | null }>('/api/fork/voice/settings', 'PUT', {
                    model,
                  }),
                );
              }}
            />
          )}
        </Loaded>
      )}
    </Loaded>
  );
}

function Behaviour() {
  const theme = useTheme();
  const format = useDateFormat();
  const send = useRequest();
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
      const next = await send<Preferences>('/api/preferences', 'PATCH', patch);
      preferences.setData(next);
    } catch (problem) {
      setError(`Saving failed: ${errorText(problem)}`);
      void preferences.reload();
    } finally {
      setBusy(undefined);
    }
  }

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
    <Loaded resource={preferences} label="Settings">
      {(saved) => (
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
      )}
    </Loaded>
  );
}

function NotificationSettings() {
  const theme = useTheme();
  const { push } = useNodBase();
  if (!push.available) return null;
  return (
    <>
      <SectionTitle>Notifications</SectionTitle>
      {push.error ? <Notice text={push.error} /> : null}
      <Card>
        <View style={styles.toggle}>
          <View style={styles.fill}>
            <Text style={[text.label, { color: theme.foreground }]}>Messages from Nod</Text>
            <Text style={[text.small, { color: theme.mutedForeground }]}>
              Tells you when Nod writes to you, even when the app is closed. Not during quiet hours.
            </Text>
          </View>
          <Switch
            value={push.enabled}
            onValueChange={(next) => void push.setEnabled(next)}
            disabled={push.busy}
            accessibilityLabel="Messages from Nod"
            trackColor={{ false: theme.inset, true: theme.primary }}
            thumbColor={theme.surface}
          />
        </View>
      </Card>
    </>
  );
}

function ModelRole({ title, detail }: { title: string; detail: string }) {
  const theme = useTheme();
  return (
    <View style={styles.role}>
      <Text style={[text.label, { color: theme.foreground }]}>{title}</Text>
      <Text style={[text.small, { color: theme.mutedForeground }]}>{detail}</Text>
    </View>
  );
}

export function SettingsScreen() {
  const { capabilities } = useNodBase();
  const models = useResource<ModelsResponse>('/api/models');
  return (
    <Page title="Settings" back>
      <SectionTitle>Models</SectionTitle>
      <ModelRole title="Main" detail="Nod's chat, tasks and everything it does for you." />
      <Models models={models} />
      {capabilities.voice ? (
        <>
          <ModelRole
            title="Voice calls"
            detail="Answers you live during a call. Faster models reply sooner."
          />
          <VoiceCallModel models={models} />
        </>
      ) : null}
      <SectionTitle>Behaviour</SectionTitle>
      <Behaviour />
      <NotificationSettings />
    </Page>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  gap: { gap: 8 },
  source: { paddingHorizontal: 4, paddingTop: 4 },
  role: { paddingHorizontal: 4, paddingTop: 8, gap: 2 },
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
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: radius.full,
  },
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
