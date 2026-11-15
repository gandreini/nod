import {
  CalendarClock,
  CircleAlert,
  Clock,
  KeyRound,
  LogOut,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from '../ui/icons';
import { useState, type ReactNode } from 'react';
import { Appearance, Pressable, StyleSheet, Text, View } from 'react-native';
import { AppLogo } from './app-logo';
import { ApprovalCard, ChoiceCard, ConnectAppCard, type Answer } from '../chat/cards';
import { MessageAttachments } from '../files/attachment-views';
import type { Draft } from '../files/attachments';
import { AssistantMessage, ScrollToLatest, UserBubble } from '../chat/chat-screen';
import { Composer } from '../chat/composer';
import type { ApprovalState, Message } from '../connection/contracts';
import { useNod } from '../connection/nod-context';
import { NodGlyph, NodMark } from '../ui/nod-mark';
import { font, radius, useTheme } from '../ui/theme';
import {
  Button,
  Card,
  Empty,
  Group,
  Loading,
  Meta,
  Notice,
  Page,
  Pill,
  Row,
  SectionTitle,
  text,
} from '../ui/ui';
import { AudioClip, Levels } from '../voice/voice';

const drafts: Draft[] = [
  {
    id: 'd1',
    uri: 'file:///synthetic/quote.pdf',
    name: 'Kitchen quote.pdf',
    mimeType: 'application/pdf',
    size: 482000,
    state: 'ready',
  },
  {
    id: 'd2',
    uri: 'file:///synthetic/plan.pdf',
    name: 'Floor plan.pdf',
    mimeType: 'application/pdf',
    size: 2400000,
    state: 'uploading',
  },
  {
    id: 'd3',
    uri: 'file:///synthetic/photo.heic',
    name: 'Wall.heic',
    mimeType: 'application/octet-stream',
    size: 3100000,
    state: 'failed',
    error: 'Could not reach the server',
  },
];

const answer: Answer = () => new Promise((resolve) => setTimeout(() => resolve('sent'), 800));
const levels = [0.2, 0.5, 0.8, 0.4, 0.9, 0.6, 0.3, 0.7, 1, 0.5, 0.35, 0.6, 0.8, 0.45, 0.25, 0.55];

let next = 0;
function message(fields: Partial<Message>): Message {
  next += 1;
  return {
    id: `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`,
    role: 'assistant',
    text: '',
    turnId: null,
    createdAt: '2026-11-13T09:00:00.000Z',
    attachments: [],
    ...fields,
  };
}

const markdown = `## Weekly summary

You have **three meetings** tomorrow and one email that *needs an answer*.

- Design review at 10:00
- 1:1 with the team lead
- Planning, moved to 15:30

Text right after a list keeps the paragraph gap.

> The supplier asked to confirm the order by Friday.

| Shop | Price |
| --- | --- |
| Example Store | €195.27 |
| Sample Shop | €196.63 |

Text right after a table needs room to breathe.

Run \`pnpm test\` before the release, or see [the docs](https://docs.n8n.io).

\`\`\`
const total = items.reduce((sum, item) => sum + item.price, 0);
\`\`\``;

const choice = (multiple: boolean) =>
  message({
    answerChoicesPending: true,
    answerChoices: {
      multiple,
      options: [
        {
          id: '10000000-0000-4000-8000-000000000001',
          label: 'Every morning',
          description: 'At 8:00, before work',
        },
        { id: '10000000-0000-4000-8000-000000000002', label: 'Every evening' },
        { id: '10000000-0000-4000-8000-000000000003', label: 'Only on Mondays' },
      ],
    },
  });

const approval = (state: ApprovalState) =>
  message({
    approval: {
      id: `20000000-0000-4000-8000-00000000000${state.length}`,
      state,
      title: 'Send email',
      app: 'Gmail',
      slug: 'gmail',
      fields: [
        { label: 'To', value: 'sam@example.com' },
        { label: 'Subject', value: 'Order confirmation' },
      ],
      body: 'Hi Sam, I confirm the order for Friday. Thanks!',
    },
  });

function Section({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.foreground }]}>{title}</Text>
      {children}
    </View>
  );
}

function Label({ children }: { children: string }) {
  const theme = useTheme();
  return <Text style={[text.small, { color: theme.mutedForeground }]}>{children}</Text>;
}

function Swatches() {
  const theme = useTheme();
  const colors = Object.entries(theme).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  return (
    <View style={styles.swatches}>
      {colors.map(([name, value]) => (
        <View key={name} style={styles.swatch}>
          <View style={[styles.chip, { backgroundColor: value, borderColor: theme.border }]} />
          <Text style={[text.small, { color: theme.foreground }]}>{name}</Text>
          <Text style={[styles.mono, { color: theme.mutedForeground }]}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

function SchemeSwitch() {
  const theme = useTheme();
  const [scheme, setScheme] = useState<'system' | 'light' | 'dark'>('system');
  return (
    <View style={styles.row}>
      {(['system', 'light', 'dark'] as const).map((value) => (
        <Pressable
          key={value}
          onPress={() => {
            setScheme(value);
            Appearance.setColorScheme(value === 'system' ? 'unspecified' : value);
          }}
          accessibilityRole="radio"
          accessibilityState={{ checked: scheme === value }}
          style={[
            styles.segment,
            { backgroundColor: scheme === value ? theme.primary : theme.control },
          ]}
        >
          <Text
            style={[
              text.label,
              { color: scheme === value ? theme.primaryForeground : theme.foreground },
            ]}
          >
            {value[0].toUpperCase() + value.slice(1)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function GalleryScreen() {
  const theme = useTheme();
  const { connection } = useNod();
  const [draft, setDraft] = useState('Can you check my calendar for tomorrow?');
  const noop = () => {};
  return (
    <Page title="UI gallery" back>
      <Text style={[text.small, { color: theme.mutedForeground }]}>
        Development only. Every component with synthetic data. Buttons answer with fake results.
      </Text>
      <SchemeSwitch />

      <Section title="Colours">
        <Swatches />
      </Section>

      <Section title="Typography">
        <Text style={[styles.pageTitle, { color: theme.foreground }]}>Page title 28</Text>
        <Text style={[styles.emptyTitle, { color: theme.foreground }]}>Empty state title 20</Text>
        <Text style={[text.title, { color: theme.foreground }]}>Card title 16 semibold</Text>
        <Text style={[text.body, { color: theme.foreground }]}>
          Body 15. Nod reads your connected accounts and tells you when something needs you.
        </Text>
        <Text style={[text.label, { color: theme.foreground }]}>Label 14 medium</Text>
        <Text style={[text.small, { color: theme.mutedForeground }]}>Small 13, muted</Text>
        <SectionTitle count={3}>Section title</SectionTitle>
        <Text style={[styles.mono, { color: theme.foreground }]}>Geist Mono 13</Text>
      </Section>

      <Section title="Brand">
        <View style={styles.row}>
          <NodMark size={28} />
          <NodMark size={48} />
          <NodMark size={64} />
        </View>
      </Section>

      <Section title="Buttons">
        <View style={styles.wrap}>
          <Button label="Primary" variant="primary" onPress={noop} />
          <Button label="With icon" icon={Plus} variant="primary" onPress={noop} />
          <Button label="Ghost" onPress={noop} />
          <Button label="Ask Nod" icon={Sparkles} onPress={noop} />
          <Button label="Danger" icon={Trash2} variant="danger" onPress={noop} />
          <Button label="Busy" variant="primary" busy onPress={noop} />
          <Button label="Disabled" disabled onPress={noop} />
        </View>
      </Section>

      <Section title="Pills">
        <View style={styles.wrap}>
          <Pill label="Needs you" kind="attention" icon={CircleAlert} />
          <Pill label="Failed" kind="error" />
          <Pill label="Waiting" icon={Clock} />
          <Pill label="Recurring" kind="good" />
          <Pill label="≈$1.20 a month" />
        </View>
      </Section>

      <Section title="Notices and meta">
        <Notice
          text="Schedules did not load: Could not reach the server (HTTP 502)."
          onRetry={noop}
        />
        <Notice text="Saving the limit failed: Enter a limit of at least $1." />
        <Meta icon={CalendarClock}>Every weekday at 08:00</Meta>
        <Meta>Next Fri 14 Nov, 08:00</Meta>
      </Section>

      <Section title="Card">
        <Card>
          <View style={styles.row}>
            <Text style={[text.title, styles.fill, { color: theme.foreground }]}>
              Morning summary
            </Text>
            <Pill label="Recurring" kind="good" />
          </View>
          <Meta icon={CalendarClock}>Every day at 08:00</Meta>
          <Text style={[text.body, { color: theme.secondary }]}>
            Summarise my unread email and today's meetings.
          </Text>
        </Card>
      </Section>

      <Section title="List rows">
        <Group>
          <Row
            first
            icon={KeyRound}
            title="example.com"
            detail="sam@example.com · example.com"
            onPress={noop}
          />
          <Row icon={RefreshCw} title="Static row" detail="No action" />
          <Row icon={LogOut} title="Disconnect" danger onPress={noop} />
        </Group>
        <View style={styles.row}>
          {['gmail', 'googlecalendar', 'notion', 'slack', 'unknown-app'].map((slug) => (
            <View key={slug} style={[styles.logo, { backgroundColor: theme.muted }]}>
              <AppLogo slug={slug} origin={connection.origin} theme={theme} />
            </View>
          ))}
        </View>
      </Section>

      <Section title="Empty and loading">
        <Card>
          <Empty
            icon={CalendarClock}
            title="Your first schedule"
            body="Set up a reminder, a regular summary or a check-in."
          >
            <Button label="New schedule" icon={Plus} variant="primary" onPress={noop} />
          </Empty>
        </Card>
        <Loading />
      </Section>

      <Section title="Chat messages">
        <UserBubble text="What's on my calendar tomorrow?" theme={theme} />
        <UserBubble text="Sending…" theme={theme} faded />
        <UserBubble text="This one is waiting for the connection" theme={theme} faded>
          <Text style={[text.small, { color: theme.mutedForeground, marginTop: 4 }]}>
            Sending… waiting for the connection
          </Text>
        </UserBubble>
        <UserBubble text="This one could not be sent" theme={theme}>
          <Text style={[text.small, { color: theme.secondary, marginTop: 4 }]}>
            Not sent yet · Tap to try again
          </Text>
          <Text style={[text.small, { color: theme.mutedForeground }]}>
            Could not reach the server: Network request failed
          </Text>
        </UserBubble>
        <UserBubble
          text="Hi Nod, can you check my calendar for tomorrow and move the planning meeting?"
          theme={theme}
          audio={<AudioClip source={null} durationMillis={6300} theme={theme} onBubble />}
        />
        <AssistantMessage
          message={message({ text: markdown })}
          connection={connection}
          theme={theme}
          pending={false}
          onAnswer={answer}
        />
        <View style={styles.row}>
          <NodGlyph size={28} />
          <Text style={[text.small, { color: theme.mutedForeground }]}>Reading your calendar…</Text>
        </View>
      </Section>

      <Section title="Attachments in messages">
        <AssistantMessage
          message={message({
            text: 'Two offers are worth a look:\n\n- Fastweb Casa Start\n- Vodafone Casa Start',
            attachments: [
              {
                id: '00000000-0000-4000-8000-0000000000aa',
                name: 'Internet offers benchmark.md',
                mimeType: 'text/markdown',
                size: 9200,
                url: '/api/artifacts/00000000-0000-4000-8000-0000000000aa',
              },
            ],
          })}
          connection={connection}
          theme={theme}
          pending={false}
          onAnswer={answer}
        />
        <MessageAttachments
          local={[
            {
              uri: 'file:///synthetic/quote.pdf',
              name: 'Kitchen quote.pdf',
              mimeType: 'application/pdf',
              size: 482000,
            },
            {
              uri: 'file:///synthetic/budget.xlsx',
              name: 'Budget 2026.xlsx',
              mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              size: 28400,
            },
          ]}
          connection={connection}
          theme={theme}
          alignEnd
        />
      </Section>

      <Section title="Voice">
        <AudioClip source={null} durationMillis={14000} theme={theme} />
        <Levels levels={levels} theme={theme} />
      </Section>

      <Section title="Question cards">
        <Label>Single choice</Label>
        <ChoiceCard
          message={choice(false)}
          question="When should I send the summary?"
          theme={theme}
          onAnswer={answer}
        />
        <Label>Multiple choice</Label>
        <ChoiceCard
          message={choice(true)}
          question="Which days work for you?"
          theme={theme}
          onAnswer={answer}
        />
      </Section>

      <Section title="Approval cards">
        {(['pending', 'working', 'done', 'declined', 'expired', 'uncertain'] as const).map(
          (state) => (
            <View key={state} style={styles.stack}>
              <Label>{state}</Label>
              <ApprovalCard
                message={approval(state)}
                question="Send this email to Sam?"
                theme={theme}
                onAnswer={answer}
              />
            </View>
          ),
        )}
      </Section>

      <Section title="Connect app card">
        <ConnectAppCard
          title="Connect Gmail so I can read your inbox"
          path="/apps?connect=30000000-0000-4000-8000-000000000001"
          connectionId="30000000-0000-4000-8000-000000000001"
          connection={connection}
          theme={theme}
        />
      </Section>

      <Section title="Composer">
        <Label>Empty</Label>
        <Composer
          theme={theme}
          draft=""
          onDraft={noop}
          ready
          working={false}
          onSubmit={noop}
          onStop={noop}
          onRecord={noop}
          onCancelRecording={noop}
          onSendRecording={noop}
          onAttach={noop}
          onRemoveDraft={noop}
          onRetryDraft={noop}
        />
        <Label>Typing (editable)</Label>
        <Composer
          theme={theme}
          draft={draft}
          onDraft={setDraft}
          ready
          working={false}
          onSubmit={noop}
          onStop={noop}
          onRecord={noop}
          onCancelRecording={noop}
          onSendRecording={noop}
          onAttach={noop}
          onRemoveDraft={noop}
          onRetryDraft={noop}
        />
        <Label>Nod is working</Label>
        <Composer
          theme={theme}
          draft=""
          onDraft={noop}
          ready
          working
          onSubmit={noop}
          onStop={noop}
          onRecord={noop}
          onCancelRecording={noop}
          onSendRecording={noop}
          onAttach={noop}
          onRemoveDraft={noop}
          onRetryDraft={noop}
        />
        <Label>With attachments: ready, uploading, failed</Label>
        <Composer
          theme={theme}
          draft="Here is the quote for the kitchen"
          onDraft={noop}
          ready
          working={false}
          drafts={drafts}
          onSubmit={noop}
          onStop={noop}
          onRecord={noop}
          onCancelRecording={noop}
          onSendRecording={noop}
          onAttach={noop}
          onRemoveDraft={noop}
          onRetryDraft={noop}
        />
        <Label>Recording</Label>
        <Composer
          theme={theme}
          draft=""
          onDraft={noop}
          ready
          working={false}
          recording={{ seconds: 7.4, levels }}
          onSubmit={noop}
          onStop={noop}
          onRecord={noop}
          onCancelRecording={noop}
          onSendRecording={noop}
          onAttach={noop}
          onRemoveDraft={noop}
          onRetryDraft={noop}
        />
      </Section>

      <Section title="Floating buttons">
        <View style={styles.floating}>
          <ScrollToLatest visible theme={theme} onPress={noop} />
        </View>
      </Section>
    </Page>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  stack: { gap: 8 },
  section: { gap: 12, paddingTop: 24 },
  sectionTitle: { fontFamily: font.semibold, fontSize: 20, letterSpacing: -0.4 },
  pageTitle: { fontFamily: font.semibold, fontSize: 28, lineHeight: 34, letterSpacing: -0.6 },
  emptyTitle: { fontFamily: font.semibold, fontSize: 20, letterSpacing: -0.4 },
  mono: { fontFamily: font.mono, fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  swatch: { width: '30%', gap: 4 },
  chip: { height: 40, borderRadius: radius.control, borderWidth: StyleSheet.hairlineWidth },
  segment: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.full },
  logo: {
    width: 40,
    height: 40,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floating: { marginTop: 52, height: 4 },
});
