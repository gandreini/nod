import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { Check, Link2, LoaderCircle, X } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { integrationServiceIds } from '../../../src/shared/integrations';
import { parse, SvgAst, type JsxAST } from 'react-native-svg';
import { appSetupStatus } from './api';
import type { Connection } from './connection';
import {
  choiceAnswerText,
  type AnswerChoice,
  type AppSetupStatus,
  type Message,
  type QuestionAnswer,
} from './contracts';
import { font, radius, type Theme } from './theme';

export type AnswerOutcome = 'sent' | 'unavailable';
export type Answer = (reply: {
  replyToMessageId: string;
  text: string;
  questionAnswer?: QuestionAnswer;
  approvalAnswer?: { approvalId: string; approved: boolean };
}) => Promise<AnswerOutcome>;

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function useAnswer(onAnswer: Answer) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState(false);
  async function run(reply: Parameters<Answer>[0]) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const outcome = await onAnswer(reply);
      if (outcome === 'unavailable') setError('This can no longer be answered here.');
      else setSent(true);
    } catch (problem) {
      setError(describe(problem));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, sent, run };
}

function Card({ theme, children }: { theme: Theme; children: ReactNode }) {
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.border, shadowColor: theme.shadow },
      ]}
    >
      {children}
    </View>
  );
}

function Badge({ theme, label, on }: { theme: Theme; label: string; on?: boolean }) {
  return (
    <View
      style={[styles.badge, { backgroundColor: on ? theme.primary : theme.muted }]}
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={[styles.badgeText, { color: on ? theme.primaryForeground : theme.secondary }]}>
        {label}
      </Text>
    </View>
  );
}

function Row({
  theme,
  first,
  disabled,
  onPress,
  label,
  children,
}: {
  theme: Theme;
  first?: boolean;
  disabled?: boolean;
  onPress: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.row,
        {
          borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
          borderTopColor: theme.border,
          backgroundColor: pressed ? theme.control : 'transparent',
          opacity: disabled ? 0.6 : 1,
        },
      ]}
    >
      {children}
    </Pressable>
  );
}

function Problem({ theme, text }: { theme: Theme; text?: string }) {
  if (!text) return null;
  return (
    <Text style={[styles.problem, { color: theme.error }]} accessibilityLiveRegion="polite">
      {text}
    </Text>
  );
}

export function ChoiceCard({
  message,
  question,
  theme,
  onAnswer,
}: {
  message: Message;
  question: string;
  theme: Theme;
  onAnswer: Answer;
}) {
  const choices = message.answerChoices!;
  const [picked, setPicked] = useState<string[]>([]);
  const { busy, error, sent, run } = useAnswer(onAnswer);
  const locked = busy || sent;

  function submit(options: AnswerChoice[]) {
    void run({
      replyToMessageId: message.id,
      text: choiceAnswerText(options),
      questionAnswer: { choiceIds: options.map((option) => option.id) },
    });
  }

  return (
    <Card theme={theme}>
      <View style={styles.heading}>
        <Text style={[styles.title, { color: theme.foreground }]}>{question}</Text>
        {choices.multiple ? (
          <Text style={[styles.caption, { color: theme.secondary }]}>Choose one or more</Text>
        ) : null}
      </View>
      {choices.options.map((option, index) => {
        const on = picked.includes(option.id);
        const label = choiceAnswerText([option]);
        return (
          <Row
            key={option.id}
            theme={theme}
            first={index === 0}
            disabled={locked}
            label={label}
            onPress={() =>
              choices.multiple
                ? setPicked((current) =>
                    on ? current.filter((id) => id !== option.id) : [...current, option.id],
                  )
                : submit([option])
            }
          >
            <Badge theme={theme} label={String.fromCharCode(65 + index)} on={on} />
            <Text style={[styles.rowText, { color: theme.foreground }]}>{label}</Text>
          </Row>
        );
      })}
      {choices.multiple ? (
        <Row
          theme={theme}
          disabled={locked || picked.length === 0}
          label="Send answer"
          onPress={() => submit(choices.options.filter((option) => picked.includes(option.id)))}
        >
          <Text style={[styles.rowText, styles.action, { color: theme.accent }]}>Send answer</Text>
        </Row>
      ) : null}
      {busy ? <ActivityIndicator style={styles.spinner} color={theme.accent} /> : null}
      <Problem theme={theme} text={error} />
    </Card>
  );
}

const approvalLabels: Record<string, string> = {
  working: 'Working…',
  done: 'Done',
  declined: 'Cancelled',
  expired: 'Expired',
  uncertain: 'May have run',
};

export function ApprovalCard({
  message,
  question,
  theme,
  onAnswer,
}: {
  message: Message;
  question: string;
  theme: Theme;
  onAnswer: Answer;
}) {
  const approval = message.approval!;
  const { busy, error, sent, run } = useAnswer(onAnswer);
  const [choice, setChoice] = useState<boolean | null>(null);
  const state =
    approval.state === 'pending' && sent ? (choice ? 'working' : 'declined') : approval.state;

  function answer(approved: boolean, label: string) {
    setChoice(approved);
    void run({
      replyToMessageId: message.id,
      text: label,
      approvalAnswer: { approvalId: approval.id, approved },
    });
  }

  return (
    <Card theme={theme}>
      <View style={styles.heading}>
        <Text style={[styles.title, { color: theme.foreground }]}>{question}</Text>
      </View>
      {approval.fields?.length ? (
        <View style={[styles.fields, { borderTopColor: theme.border }]}>
          {approval.fields.map((field) => (
            <View key={field.label} style={styles.field}>
              <Text style={[styles.caption, { color: theme.mutedForeground }]}>{field.label}</Text>
              <Text selectable style={[styles.rowText, { color: theme.foreground }]}>
                {field.value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {approval.body ? (
        <View style={[styles.fields, { borderTopColor: theme.border }]}>
          <Text selectable style={[styles.rowText, { color: theme.foreground }]}>
            {approval.body}
          </Text>
          {approval.bodyCut ? (
            <Text style={[styles.caption, { color: theme.mutedForeground }]}>
              Only the start is shown. The rest is included too.
            </Text>
          ) : null}
        </View>
      ) : null}
      {state === 'pending' ? (
        <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }}>
          {[approval.title, 'Cancel'].map((label, index) => (
            <Row
              key={label}
              theme={theme}
              first={index === 0}
              disabled={busy}
              label={label}
              onPress={() => answer(index === 0, label)}
            >
              <Badge theme={theme} label={String.fromCharCode(65 + index)} />
              <Text style={[styles.rowText, { color: theme.foreground }]}>{label}</Text>
            </Row>
          ))}
        </View>
      ) : (
        <View
          style={[styles.status, { borderTopColor: theme.border }]}
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
        >
          {state === 'working' ? (
            <LoaderCircle size={16} color={theme.mutedForeground} />
          ) : state === 'done' ? (
            <Check size={16} color={theme.mutedForeground} />
          ) : (
            <X size={16} color={theme.mutedForeground} />
          )}
          <Text style={[styles.caption, { color: theme.mutedForeground }]}>
            {approvalLabels[state] ?? state}
          </Text>
        </View>
      )}
      {state === 'uncertain' ? (
        <Text style={[styles.problem, { color: theme.secondary }]}>
          {approval.app || 'The app'} didn’t confirm it, and Nod won’t retry it. Check{' '}
          {approval.app || 'the app'} before trying again.
        </Text>
      ) : null}
      <Problem theme={theme} text={error} />
    </Card>
  );
}

export const connectLink =
  /\[([^\]]+)\]\(<?(\/apps\?connect=([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}))>?\)/gi;

type Logo = { kind: 'svg'; ast: JsxAST } | { kind: 'raster'; uri: string } | null;

const logos = new Map<string, Promise<Logo>>();
const rasterExtension = /\.(png|webp|jpe?g|ico|gif)(\?|$)/i;

function loadLogo(uri: string): Promise<Logo> {
  let pending = logos.get(uri);
  if (!pending) {
    pending = rasterExtension.test(uri)
      ? Promise.resolve({ kind: 'raster', uri })
      : fetch(uri)
          .then(async (response): Promise<Logo> => {
            if (!response.ok) return null;
            const type = response.headers.get('content-type') ?? '';
            if (type.startsWith('image/') && !type.includes('svg')) return { kind: 'raster', uri };
            const ast = parse(await response.text());
            return ast ? { kind: 'svg', ast } : null;
          })
          .catch(() => null);
    logos.set(uri, pending);
  }
  return pending;
}

const bundled = new Set<string>(integrationServiceIds);

export function AppLogo({
  slug,
  logoUrl,
  origin,
  theme,
  size = 24,
}: {
  slug?: string;
  logoUrl?: string;
  origin: string;
  theme: Theme;
  size?: number;
}) {
  const base = slug?.replace(/_mcp$/, '');
  const uri = base && bundled.has(base) ? `${origin}/logos/${base}.svg` : logoUrl;
  const [logo, setLogo] = useState<Logo | undefined>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setLogo(undefined);
    setFailed(false);
    if (uri)
      void loadLogo(uri).then((value) => {
        if (active) setLogo(value);
      });
    return () => {
      active = false;
    };
  }, [uri]);
  if (uri && logo === undefined) return <View style={{ width: size, height: size }} />;
  if (logo?.kind === 'svg')
    return <SvgAst ast={logo.ast} override={{ width: size, height: size }} />;
  if (logo?.kind === 'raster' && !failed)
    return (
      <Image
        source={{ uri: logo.uri }}
        style={{ width: size, height: size }}
        resizeMode="contain"
        onError={() => setFailed(true)}
      />
    );
  return <Link2 size={size} color={theme.mutedForeground} />;
}

export function ConnectAppCard({
  title,
  path,
  connectionId,
  connection,
  theme,
}: {
  title: string;
  path: string;
  connectionId: string;
  connection: Connection;
  theme: Theme;
}) {
  const [app, setApp] = useState<AppSetupStatus['apps'][number]>();
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    let active = true;
    const id = connectionId.toLowerCase();
    digestStringAsync(CryptoDigestAlgorithm.SHA256, `/apps?connect=${id}`)
      .then((hash) => appSetupStatus(connection, [hash], [id]).then((status) => ({ hash, status })))
      .then(({ hash, status }) => {
        if (!active) return;
        setCompleted(status.completed.includes(hash));
        setApp(status.apps.find((item) => item.hash === hash));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [connection, connectionId]);

  const name = app?.name ?? 'App';
  const expired = !completed && app?.available === false;
  const label = completed ? 'Connected' : expired ? 'Expired' : 'Connect';

  return (
    <View style={[styles.connectWrap, { backgroundColor: theme.muted }]}>
      <Text style={[styles.title, { color: theme.foreground }]}>{title}</Text>
      <View style={[styles.appRow, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <AppLogo slug={app?.slug} logoUrl={app?.logoUrl} origin={connection.origin} theme={theme} />
        <Text style={[styles.rowText, styles.fill, { color: theme.foreground }]} numberOfLines={1}>
          {name}
        </Text>
        <Pressable
          onPress={() => void Linking.openURL(`${connection.origin}${path}`)}
          disabled={completed || expired}
          accessibilityRole="button"
          accessibilityLabel={`${label} ${name}`}
          accessibilityState={{ disabled: completed || expired }}
          style={({ pressed }) => [
            styles.pill,
            {
              backgroundColor:
                completed || expired ? theme.muted : pressed ? theme.primaryPressed : theme.primary,
            },
          ]}
        >
          <Text
            style={[
              styles.pillText,
              {
                color: completed || expired ? theme.mutedForeground : theme.primaryForeground,
              },
            ]}
          >
            {label}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  card: {
    borderWidth: 1,
    borderRadius: radius.bubble,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  heading: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, gap: 4 },
  title: { fontFamily: font.medium, fontSize: 16, lineHeight: 24 },
  caption: { fontFamily: font.regular, fontSize: 13, lineHeight: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  rowText: { fontFamily: font.regular, fontSize: 15, lineHeight: 22, flexShrink: 1 },
  action: { fontFamily: font.semibold },
  badge: {
    width: 24,
    height: 24,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: font.medium, fontSize: 12 },
  fields: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  field: { gap: 2 },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  spinner: { paddingVertical: 8 },
  problem: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  connectWrap: { borderRadius: radius.composer, padding: 16, gap: 12 },
  appRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: radius.card,
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 8,
    minHeight: 56,
  },
  pill: {
    borderRadius: radius.full,
    paddingHorizontal: 16,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: { fontFamily: font.medium, fontSize: 14 },
});
