import {
  CalendarClock,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleSlash,
  Clock,
  Hourglass,
  LoaderCircle,
  MessageCircle,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react-native';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { money } from '../money';
import { scheduleDate, scheduleLabel } from '../../../../src/web/lib/schedules';
import { formatDateTime, useDateFormat } from '../../../../src/web/lib/date-format';
import { request } from '../api';
import {
  taskHeadline,
  taskLabels,
  type Schedule,
  type ScheduleHistory,
  type Task,
  type TaskStatus,
} from '../contracts';
import { useNod } from '../nod-context';
import { useTheme } from '../theme';
import {
  Button,
  Card,
  Empty,
  Loading,
  Meta,
  Notice,
  Page,
  Pill,
  SectionTitle,
  text,
  type Icon,
} from '../ui';
import { describe, useResource } from '../use-resource';

const statusIcons: Record<TaskStatus, Icon> = {
  queued: Clock,
  failed: CircleAlert,
  working: LoaderCircle,
  needs_you: MessageCircle,
  waiting: Hourglass,
  scheduled: CalendarClock,
  done: CircleCheck,
  cancelled: CircleSlash,
};

const runLabels = {
  queued: 'Queued',
  running: 'Working',
  waiting: 'Needs your input',
  succeeded: 'Done',
  failed: 'Could not finish',
  cancelled: 'Stopped',
};

const closed = (task: Task) => task.status === 'done' || task.status === 'cancelled';

function TaskCard({ task, onChanged }: { task: Task; onChanged(): void }) {
  const theme = useTheme();
  const format = useDateFormat();
  const { connection } = useNod();
  const [open, setOpen] = useState(task.status === 'failed' || task.status === 'needs_you');
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string>();
  const steps = task.steps ?? [];
  const completed =
    task.status === 'done' ? steps.length : Math.min(task.stepIndex ?? 0, steps.length);

  function stop() {
    Alert.alert('Stop this task?', task.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Stop',
        style: 'destructive',
        onPress: async () => {
          setStopping(true);
          setError(undefined);
          try {
            await request(connection, `/api/tasks/${task.id}/stop`, 'POST', {});
            onChanged();
          } catch (problem) {
            setError(`Stop failed: ${describe(problem)}`);
          } finally {
            setStopping(false);
          }
        },
      },
    ]);
  }

  return (
    <Card>
      <Pressable
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.gap}
      >
        <View style={styles.titleRow}>
          <Text style={[text.title, styles.fill, { color: theme.foreground }]}>{task.title}</Text>
          <Pill
            label={taskLabels[task.status]}
            icon={statusIcons[task.status]}
            kind={
              task.status === 'needs_you'
                ? 'attention'
                : task.status === 'failed'
                  ? 'error'
                  : 'quiet'
            }
          />
        </View>
        <Text style={[text.body, { color: theme.secondary }]} numberOfLines={open ? undefined : 2}>
          {taskHeadline(task)}
        </Text>
      </Pressable>
      {open ? (
        <View style={styles.gap}>
          {steps.length ? (
            <View style={styles.steps}>
              {steps.map((step, index) => {
                const done = task.status === 'done' || index < completed;
                const current = !closed(task) && index === (task.stepIndex ?? 0);
                const StepIcon = done ? CircleCheck : current ? statusIcons[task.status] : Circle;
                return (
                  <View key={index} style={styles.step}>
                    <StepIcon size={16} color={current ? theme.accent : theme.mutedForeground} />
                    <Text
                      style={[
                        text.small,
                        styles.fill,
                        { color: done || current ? theme.foreground : theme.mutedForeground },
                      ]}
                    >
                      {step}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}
          <Meta icon={Clock}>
            {task.closedAt
              ? `${task.status === 'cancelled' ? 'Stopped' : 'Finished'} ${formatDateTime(task.closedAt, format)}`
              : `Started ${formatDateTime(task.createdAt, format)}`}
          </Meta>
          {!closed(task) &&
            task.waitingFor.map((wait) => (
              <Meta key={`${wait.who}:${wait.via}`} icon={Hourglass}>
                Waiting on {wait.who} · {wait.via}
              </Meta>
            ))}
          {!closed(task) && task.nextCheck ? (
            <Meta icon={CalendarClock}>
              Next check {formatDateTime(task.nextCheck, format, { weekday: true })}
            </Meta>
          ) : null}
          {!closed(task) && task.doneWhen ? (
            <Meta icon={CircleCheck}>Done when {task.doneWhen}</Meta>
          ) : null}
          {error ? <Notice text={error} /> : null}
          <View style={styles.actions}>
            {task.status === 'needs_you' || task.status === 'failed' ? (
              <Button
                label="Reply in chat"
                icon={MessageCircle}
                variant="primary"
                onPress={() => router.navigate('/')}
              />
            ) : null}
            {!closed(task) ? (
              <Button label="Stop this task" variant="danger" busy={stopping} onPress={stop} />
            ) : null}
          </View>
        </View>
      ) : null}
    </Card>
  );
}

function Runs({ schedule }: { schedule: Schedule }) {
  const theme = useTheme();
  const format = useDateFormat();
  const runs = useResource<ScheduleHistory>(
    `/api/schedule-runs?scheduleId=${encodeURIComponent(schedule.id)}&limit=5`,
  );
  if (runs.error) return <Notice text={`Runs did not load: ${runs.error}`} onRetry={runs.reload} />;
  if (!runs.data) return <Loading />;
  if (!runs.data.runs.length)
    return <Text style={[text.small, { color: theme.mutedForeground }]}>No runs yet.</Text>;
  return (
    <View style={styles.runs}>
      {runs.data.runs.map((run) => (
        <View key={run.id} style={[styles.run, { borderTopColor: theme.border }]}>
          <View style={styles.titleRow}>
            <Text style={[text.small, styles.fill, { color: theme.foreground }]}>
              {scheduleDate(run.scheduledFor, run.timeZone, format)}
            </Text>
            <Pill
              label={runLabels[run.status]}
              kind={
                run.status === 'failed' ? 'error' : run.status === 'waiting' ? 'attention' : 'quiet'
              }
            />
          </View>
          {typeof run.costUsd === 'number' ? (
            <Text style={[text.small, { color: theme.mutedForeground }]}>{money(run.costUsd)}</Text>
          ) : null}
          {run.error ? <Text style={[text.small, { color: theme.error }]}>{run.error}</Text> : null}
          {run.messagePreview ? (
            <Text style={[text.small, { color: theme.secondary }]} numberOfLines={3}>
              {run.messagePreview}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function ScheduleCard({
  schedule,
  onChanged,
}: {
  schedule: Schedule;
  onChanged(next?: Schedule | null): void;
}) {
  const theme = useTheme();
  const format = useDateFormat();
  const { connection, ask } = useNod();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'pause' | 'delete'>();
  const [error, setError] = useState<string>();
  const date = (value: string) => scheduleDate(value, schedule.timeZone, format);
  const timing =
    schedule.kind === 'once'
      ? schedule.runAt
        ? date(schedule.runAt)
        : 'Time unavailable'
      : scheduleLabel(schedule.cron ?? '', format);
  const ranOnce = schedule.kind === 'once' && schedule.lastRun?.scheduledFor === schedule.runAt;
  const canPause =
    schedule.enabled ||
    schedule.kind !== 'once' ||
    Boolean(schedule.runAt && Date.parse(schedule.runAt) > Date.now());
  const status = ranOnce
    ? runLabels[schedule.lastRun!.status]
    : !schedule.enabled
      ? 'Paused'
      : schedule.kind === 'once'
        ? 'One time'
        : 'Recurring';

  async function toggle() {
    setBusy('pause');
    setError(undefined);
    try {
      const saved = await request<Schedule>(connection, `/api/schedules/${schedule.id}`, 'PATCH', {
        enabled: !schedule.enabled,
        expectedRevision: schedule.revision,
      });
      onChanged(saved);
    } catch (problem) {
      setError(`${schedule.enabled ? 'Pause' : 'Resume'} failed: ${describe(problem)}`);
      onChanged();
    } finally {
      setBusy(undefined);
    }
  }

  function remove() {
    Alert.alert('Delete this schedule?', `${schedule.title} stops running. This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setBusy('delete');
          setError(undefined);
          try {
            await request(connection, `/api/schedules/${schedule.id}`, 'DELETE');
            onChanged(null);
          } catch (problem) {
            setError(`Delete failed: ${describe(problem)}`);
            onChanged();
          } finally {
            setBusy(undefined);
          }
        },
      },
    ]);
  }

  return (
    <Card>
      <View style={styles.titleRow}>
        <Pressable
          onPress={() => setOpen(!open)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          style={[styles.fill, styles.gap]}
        >
          <Text style={[text.title, { color: theme.foreground }]}>{schedule.title}</Text>
          <Meta icon={CalendarClock}>{timing}</Meta>
          {schedule.kind === 'recurring' && schedule.nextRun ? (
            <Meta>Next {date(schedule.nextRun)}</Meta>
          ) : null}
          <View style={styles.pills}>
            <Pill label={status} kind={schedule.enabled ? 'good' : 'quiet'} />
            {schedule.monthlyUsd !== null ? (
              <Pill label={`≈${money(schedule.monthlyUsd)} a month`} />
            ) : null}
            {schedule.timeZone !== format.timeZone ? <Pill label={schedule.timeZone} /> : null}
          </View>
        </Pressable>
        {canPause ? (
          <Switch
            value={schedule.enabled}
            onValueChange={toggle}
            disabled={busy !== undefined}
            accessibilityLabel={`${schedule.title} active`}
            trackColor={{ false: theme.inset, true: theme.primary }}
            thumbColor={theme.surface}
          />
        ) : null}
      </View>
      {error ? <Notice text={error} /> : null}
      {open ? (
        <View style={styles.gap}>
          <Text style={[text.body, { color: theme.secondary }]}>{schedule.prompt}</Text>
          <Runs schedule={schedule} />
          <View style={styles.actions}>
            <Button
              label="Ask Nod"
              icon={Sparkles}
              onPress={() =>
                ask(
                  `Help me adjust the schedule ${JSON.stringify(schedule.title)}, ${timing} (${schedule.timeZone}). Ask me what I want to change.`,
                )
              }
            />
            <Button
              label="Delete"
              icon={Trash2}
              variant="danger"
              busy={busy === 'delete'}
              onPress={remove}
            />
          </View>
        </View>
      ) : null}
    </Card>
  );
}

export function ScheduledScreen() {
  const { ask } = useNod();
  const schedules = useResource<Schedule[]>('/api/schedules');
  const tasks = useResource<Task[]>('/api/tasks');
  const open = (tasks.data ?? []).filter((task) => !closed(task));
  const all = schedules.data ?? [];
  const upcoming = all
    .filter((schedule) => schedule.enabled && schedule.nextRun)
    .sort((a, b) => a.nextRun!.localeCompare(b.nextRun!) || a.id.localeCompare(b.id));
  const inactive = all.filter((schedule) => !upcoming.includes(schedule));
  const newSchedule = () =>
    ask(
      'Help me create a schedule. Ask me one question at a time to work out what to do and when.',
    );

  function changed(id: string, next?: Schedule | null) {
    if (next === null) schedules.setData((items) => items?.filter((item) => item.id !== id));
    else if (next)
      schedules.setData((items) => items?.map((item) => (item.id === id ? next : item)));
    void schedules.reload();
  }

  const card = (schedule: Schedule) => (
    <ScheduleCard
      key={schedule.id}
      schedule={schedule}
      onChanged={(next) => changed(schedule.id, next)}
    />
  );

  return (
    <Page
      title="Scheduled"
      back
      refreshing={schedules.loading || tasks.loading}
      onRefresh={() => {
        void schedules.reload();
        void tasks.reload();
      }}
      action={
        all.length ? (
          <Button label="New" icon={Plus} variant="primary" onPress={newSchedule} />
        ) : null
      }
    >
      {schedules.error ? (
        <Notice text={`Schedules did not load: ${schedules.error}`} onRetry={schedules.reload} />
      ) : null}
      {tasks.error ? (
        <Notice text={`Tasks did not load: ${tasks.error}`} onRetry={tasks.reload} />
      ) : null}
      {open.length ? (
        <>
          <SectionTitle count={open.length}>Tasks</SectionTitle>
          {open.map((task) => (
            <TaskCard key={task.id} task={task} onChanged={tasks.reload} />
          ))}
        </>
      ) : null}
      {!schedules.data ? (
        schedules.error ? null : (
          <Loading />
        )
      ) : !all.length ? (
        <Empty
          fill
          icon={CalendarClock}
          title="Your first schedule"
          body="Set up a reminder, a regular summary or a check-in. Nod will help you work out what to do and when."
        >
          <Button label="New schedule" icon={Plus} variant="primary" onPress={newSchedule} />
        </Empty>
      ) : (
        <>
          <SectionTitle count={upcoming.length}>Upcoming</SectionTitle>
          {upcoming.length ? upcoming.map(card) : <Meta>No upcoming schedules.</Meta>}
          {inactive.length ? (
            <>
              <SectionTitle count={inactive.length}>Inactive</SectionTitle>
              {inactive.map(card)}
            </>
          ) : null}
        </>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  gap: { gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 4 },
  steps: { gap: 8, paddingVertical: 4 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 4 },
  runs: { gap: 0 },
  run: { gap: 4, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
});
