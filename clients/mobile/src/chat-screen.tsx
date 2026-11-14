import { ChevronDown, RefreshCw, RotateCw } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { ChatMenu, floatingShadow } from './chat-menu';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { artifactSource } from './api';
import { ApprovalCard, ChoiceCard, ConnectAppCard, connectLink, type Answer } from './cards';
import type { Outgoing } from './chat-state';
import type { Connection } from './connection';
import { splitQuestion, type Activity, type Message } from './contracts';
import { Markdown } from './markdown';
import { NodMark } from './nod-mark';
import { font, radius, useTheme, type Theme } from './theme';
import { useNod } from './nod-context';
import { AttachMenu, MessageAttachments } from './attachment-views';
import { sendable } from './attachments';
import { Composer } from './composer';
import { useAttachments } from './use-attachments';
import { AudioClip, useVoiceRecorder } from './voice';
import { prepareTranscription } from './uploads';

type Row =
  | { kind: 'message'; key: string; message: Message }
  | { kind: 'outgoing'; key: string; item: Outgoing }
  | { kind: 'stream'; key: string; text: string };

export function ThinkingDots({ theme }: { theme: Theme }) {
  const values = useRef([0, 1, 2].map(() => new Animated.Value(0.35))).current;
  useEffect(() => {
    const loops = values.map((value, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 150),
          Animated.timing(value, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(value, { toValue: 0.35, duration: 650, useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [values]);
  return (
    <View style={styles.dots}>
      {values.map((value, index) => (
        <Animated.View
          key={index}
          style={[styles.dot, { backgroundColor: theme.accent, opacity: value }]}
        />
      ))}
    </View>
  );
}

function Fade({
  theme,
  edge,
  style,
}: {
  theme: Theme;
  edge: 'top' | 'bottom';
  style: StyleProp<ViewStyle>;
}) {
  const id = `${edge}-fade`;
  return (
    <View pointerEvents="none" style={style}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient
            id={id}
            x1="0"
            y1={edge === 'top' ? 0 : 1}
            x2="0"
            y2={edge === 'top' ? 1 : 0}
          >
            <Stop offset="0" stopColor={theme.background} stopOpacity={1} />
            <Stop offset="0.5" stopColor={theme.background} stopOpacity={0.88} />
            <Stop offset="1" stopColor={theme.background} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

export function ScrollToLatest({
  visible,
  theme,
  onPress,
}: {
  visible: boolean;
  theme: Theme;
  onPress(): void;
}) {
  const shown = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(shown, {
      toValue: visible ? 1 : 0,
      useNativeDriver: true,
      speed: 16,
      bounciness: visible ? 8 : 0,
    }).start();
  }, [shown, visible]);
  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[
        styles.toBottom,
        {
          opacity: shown,
          transform: [
            { translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [52, 0] }) },
            { scale: shown.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) },
          ],
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Scroll to the latest message"
        accessibilityElementsHidden={!visible}
        importantForAccessibility={visible ? 'yes' : 'no-hide-descendants'}
        style={({ pressed }) => [
          styles.toBottomButton,
          {
            backgroundColor: pressed ? theme.controlActive : theme.surface,
            borderColor: theme.dark ? 'rgba(250,250,250,0.08)' : 'rgba(25,25,25,0.06)',
            boxShadow: theme.dark
              ? '0 4px 16px rgba(0,0,0,0.45)'
              : '0 4px 16px rgba(25,25,25,0.08), 0 1px 2px rgba(25,25,25,0.04)',
          },
        ]}
      >
        <ChevronDown size={22} color={theme.foreground} />
      </Pressable>
    </Animated.View>
  );
}

const maxRecordingSeconds = 300;

function activityLabel(activity: Activity[]) {
  const current =
    activity.find((item) => !item.background && !item.taskId) ??
    activity.find((item) => !item.background);
  return current?.step ?? current?.title ?? 'Working…';
}

function audioOf(message: Message) {
  return (message.attachments ?? []).find((item) => item.mimeType.startsWith('audio/'));
}

function Transcript({ text, theme }: { text: string; theme: Theme }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <Pressable
      onPress={() => setOpen(!open)}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
    >
      <Text
        selectable={open}
        numberOfLines={open ? undefined : 1}
        style={[styles.caption, { color: theme.mutedForeground }]}
      >
        {open ? text : `Transcript · ${text}`}
      </Text>
    </Pressable>
  );
}

export function UserBubble({
  text,
  theme,
  faded,
  audio,
  files,
  children,
}: {
  text: string;
  theme: Theme;
  faded?: boolean;
  audio?: React.ReactNode;
  files?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <View style={[styles.userRow, styles.userStack, { opacity: faded ? 0.6 : 1 }]}>
      {files}
      {text || audio ? (
        <View
          style={[
            styles.userBubble,
            audio ? styles.audioBubble : null,
            { backgroundColor: theme.muted },
          ]}
        >
          {audio}
          {audio ? (
            <Transcript text={text} theme={theme} />
          ) : (
            <Text selectable style={[styles.messageText, { color: theme.foreground }]}>
              {text}
            </Text>
          )}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function AssistantMessage({
  message,
  connection,
  theme,
  pending,
  onAnswer,
}: {
  message: Message;
  connection: Connection;
  theme: Theme;
  pending: boolean;
  onAnswer: Answer;
}) {
  const text = message.text;
  const audio = audioOf(message);
  const others = (message.attachments ?? []).filter((item) => !item.mimeType.startsWith('audio/'));
  const files = others.length ? (
    <MessageAttachments attachments={others} connection={connection} theme={theme} />
  ) : null;
  if (audio)
    return (
      <View style={styles.stack}>
        <AudioClip
          source={artifactSource(connection, audio.url)}
          mimeType={audio.mimeType}
          size={audio.size}
          theme={theme}
        />
        {text ? <Markdown text={text} theme={theme} origin={connection.origin} /> : null}
        {files}
      </View>
    );
  if (message.approval || (message.answerChoices && pending)) {
    const { lead, question } = splitQuestion(text);
    return (
      <View style={styles.stack}>
        {lead ? <Markdown text={lead} theme={theme} origin={connection.origin} /> : null}
        {message.approval ? (
          <ApprovalCard message={message} question={question} theme={theme} onAnswer={onAnswer} />
        ) : (
          <ChoiceCard message={message} question={question} theme={theme} onAnswer={onAnswer} />
        )}
      </View>
    );
  }
  const links = [...text.matchAll(connectLink)];
  if (!links.length)
    return files ? (
      <View style={styles.stack}>
        {text ? <Markdown text={text} theme={theme} origin={connection.origin} /> : null}
        {files}
      </View>
    ) : (
      <Markdown text={text} theme={theme} origin={connection.origin} />
    );
  const rest = text.replace(connectLink, '').trim();
  return (
    <View style={styles.stack}>
      {rest ? <Markdown text={rest} theme={theme} origin={connection.origin} /> : null}
      {links.map((link) => (
        <ConnectAppCard
          key={link[3]}
          title={link[1]}
          path={link[2]}
          connectionId={link[3]}
          connection={connection}
          theme={theme}
        />
      ))}
    </View>
  );
}

export function ChatScreen() {
  const theme = useTheme();
  const { connection, chat } = useNod();
  const [draft, setDraft] = useState('');
  const voice = useVoiceRecorder();
  const files = useAttachments(connection);
  const [attaching, setAttaching] = useState(false);
  const insets = useSafeAreaInsets();
  const list = useRef<FlatList<Row>>(null);
  const [away, setAway] = useState(false);
  const [composerHeight, setComposerHeight] = useState(76);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (chat.live) return setOffline(false);
    const timer = setTimeout(() => setOffline(true), 3000);
    return () => clearTimeout(timer);
  }, [chat.live]);
  const [keyboard, setKeyboard] = useState(false);

  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboard(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  const host = new URL(connection.origin).host;

  useEffect(() => {
    if (voice.active && voice.seconds >= maxRecordingSeconds) void finishVoice();
  }, [voice.active, voice.seconds]);

  async function finishVoice() {
    const recording = await voice.finish();
    if (recording) chat.sendVoice(recording);
  }

  const rows: Row[] = [
    ...chat.messages.map((message) => ({ kind: 'message' as const, key: message.id, message })),
    ...chat.outgoing.map((item) => ({ kind: 'outgoing' as const, key: item.id, item })),
    ...chat.streams
      .filter((stream) => stream.text)
      .map((stream) => ({ kind: 'stream' as const, key: stream.id, text: stream.text })),
  ].reverse();

  function submit() {
    const text = draft.trim();
    if (!sendable(text, files.drafts)) return;
    chat.send(text, files.drafts);
    setDraft('');
    files.clear();
  }

  return (
    <KeyboardAvoidingView
      style={[styles.fill, { backgroundColor: theme.background }]}
      behavior="padding"
    >
      <View style={styles.fill}>
        {!chat.ready ? (
          <ActivityIndicator style={styles.fill} color={theme.accent} />
        ) : rows.length === 0 ? (
          <View style={[styles.empty, { paddingBottom: composerHeight }]}>
            <NodMark size={56} />
            <Text style={[styles.emptyTitle, { color: theme.foreground }]}>
              What can I do for you?
            </Text>
          </View>
        ) : (
          <FlatList
            inverted
            data={rows}
            keyExtractor={(row) => row.key}
            ref={list}
            contentContainerStyle={[
              styles.list,
              { paddingTop: composerHeight + 8, paddingBottom: insets.top + 72 },
            ]}
            onScroll={(event) => setAway(event.nativeEvent.contentOffset.y > 400)}
            scrollEventThrottle={64}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            onEndReached={chat.loadOlder}
            onEndReachedThreshold={0.4}
            ListHeaderComponent={
              chat.thinking ? (
                <View style={styles.thinking} accessibilityLiveRegion="polite">
                  <ThinkingDots theme={theme} />
                  <Text
                    style={[styles.caption, { color: theme.mutedForeground }]}
                    numberOfLines={1}
                  >
                    {activityLabel(chat.activity)}
                  </Text>
                </View>
              ) : undefined
            }
            ListFooterComponent={
              chat.loadingOlder ? (
                <ActivityIndicator style={styles.olderSpinner} color={theme.mutedForeground} />
              ) : undefined
            }
            renderItem={({ item: row }) => {
              if (row.kind === 'stream')
                return <Markdown text={row.text} theme={theme} origin={connection.origin} />;
              if (row.kind === 'outgoing')
                return (
                  <UserBubble
                    text={row.item.text}
                    theme={theme}
                    faded={row.item.status === 'sending'}
                    files={
                      row.item.files?.length ? (
                        <MessageAttachments
                          local={row.item.files}
                          connection={connection}
                          theme={theme}
                          alignEnd
                        />
                      ) : undefined
                    }
                    audio={
                      row.item.audio ? (
                        <AudioClip
                          source={row.item.audio.uri}
                          durationMillis={row.item.audio.durationMillis}
                          mimeType={row.item.audio.mimeType}
                          theme={theme}
                          onBubble
                        />
                      ) : undefined
                    }
                  >
                    {row.item.status === 'failed' ? (
                      <Pressable
                        onPress={() => chat.retry(row.item.id)}
                        onLongPress={() => chat.discard(row.item.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`Not sent yet. ${row.item.error ?? ''}`}
                        accessibilityHint="Tap to try again, long-press to discard it"
                        style={styles.failed}
                      >
                        <View style={styles.statusLine}>
                          <RotateCw size={12} color={theme.secondary} />
                          <Text style={[styles.caption, { color: theme.secondary }]}>
                            Not sent yet · Tap to try again
                          </Text>
                        </View>
                        {row.item.error ? (
                          <Text
                            numberOfLines={2}
                            style={[styles.reason, { color: theme.mutedForeground }]}
                          >
                            {row.item.error}
                          </Text>
                        ) : null}
                      </Pressable>
                    ) : row.item.status === 'sending' && row.item.attempts ? (
                      <View
                        style={[styles.failed, styles.statusLine]}
                        accessibilityLiveRegion="polite"
                      >
                        <ActivityIndicator size="small" color={theme.mutedForeground} />
                        <Text style={[styles.caption, { color: theme.mutedForeground }]}>
                          Sending… waiting for the connection
                        </Text>
                      </View>
                    ) : null}
                  </UserBubble>
                );
              const text = row.message.displayText ?? row.message.text;
              const clip = row.message.role === 'user' ? audioOf(row.message) : undefined;
              const attached = row.message.attachments?.filter(
                (item) => !item.mimeType.startsWith('audio/'),
              );
              return row.message.role === 'user' ? (
                <UserBubble
                  text={clip ? row.message.text : text}
                  theme={theme}
                  files={
                    attached?.length ? (
                      <MessageAttachments
                        attachments={attached}
                        connection={connection}
                        theme={theme}
                        alignEnd
                      />
                    ) : undefined
                  }
                  audio={
                    clip ? (
                      <AudioClip
                        source={artifactSource(connection, clip.url)}
                        mimeType={clip.mimeType}
                        size={clip.size}
                        theme={theme}
                        onBubble
                      />
                    ) : undefined
                  }
                />
              ) : (
                <AssistantMessage
                  message={row.message}
                  connection={connection}
                  theme={theme}
                  pending={chat.pendingQuestions.has(row.message.id)}
                  onAnswer={chat.answer}
                />
              );
            }}
          />
        )}

        <Fade theme={theme} edge="top" style={[styles.topFade, { height: insets.top + 64 }]} />
        {chat.error || offline ? (
          <View style={[styles.status, { top: insets.top + 14 }]} pointerEvents="box-none">
            <Pressable
              onPress={chat.reconnect}
              accessibilityRole="button"
              accessibilityLabel={chat.error ? `${chat.error}. Retry` : `Reconnecting to ${host}`}
              style={[
                styles.statusPill,
                floatingShadow(theme),
                {
                  backgroundColor: chat.error ? theme.errorSoft : theme.surface,
                  borderColor: theme.border,
                },
              ]}
            >
              {chat.error ? (
                <RefreshCw size={14} color={theme.error} />
              ) : (
                <ActivityIndicator size="small" color={theme.mutedForeground} />
              )}
              <Text
                numberOfLines={2}
                style={[
                  styles.caption,
                  styles.statusText,
                  { color: chat.error ? theme.error : theme.mutedForeground },
                ]}
              >
                {chat.error ?? `Reconnecting to ${host}…`}
              </Text>
            </Pressable>
          </View>
        ) : null}
        <ChatMenu theme={theme} attention={chat.pendingQuestions.size > 0} />

        <View
          style={[styles.composerWrap, { paddingBottom: 12 + (keyboard ? 0 : insets.bottom) }]}
          onLayout={(event) => setComposerHeight(event.nativeEvent.layout.height)}
        >
          <Fade theme={theme} edge="bottom" style={styles.bottomFade} />
          <ScrollToLatest
            visible={away}
            theme={theme}
            onPress={() => list.current?.scrollToOffset({ offset: 0, animated: true })}
          />
          {voice.error || files.error ? (
            <Pressable
              onPress={() => {
                voice.clearError();
                files.clearError();
              }}
              accessibilityRole="button"
              style={styles.voiceError}
            >
              <Text style={[styles.caption, { color: theme.error }]}>
                {voice.error ?? files.error}
              </Text>
            </Pressable>
          ) : null}
          <Composer
            theme={theme}
            draft={draft}
            onDraft={setDraft}
            ready={chat.ready}
            working={chat.working}
            recording={voice.active ? { seconds: voice.seconds, levels: voice.levels } : undefined}
            onSubmit={submit}
            onStop={chat.stop}
            onRecord={() => {
              void voice.start();
              void prepareTranscription(connection).catch(() => {});
            }}
            onCancelRecording={voice.cancel}
            onSendRecording={() => void finishVoice()}
            drafts={files.drafts}
            onAttach={() => setAttaching(true)}
            onRemoveDraft={files.remove}
            onRetryDraft={files.retry}
          />
          <AttachMenu
            visible={attaching}
            theme={theme}
            onClose={() => setAttaching(false)}
            onPick={(source) => void files.pick(source)}
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  stack: { gap: 12 },
  caption: { fontFamily: font.regular, fontSize: 13, lineHeight: 18 },
  list: { paddingHorizontal: 16, paddingVertical: 16, gap: 24 },
  userRow: { alignItems: 'flex-end' },
  userStack: { gap: 8 },
  userBubble: {
    maxWidth: '85%',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopLeftRadius: radius.bubble,
    borderTopRightRadius: radius.bubble,
    borderBottomLeftRadius: radius.bubble,
    borderBottomRightRadius: 4,
  },
  messageText: { fontFamily: font.regular, fontSize: 16, lineHeight: 24 },
  failed: { marginTop: 4, alignItems: 'flex-end', gap: 2 },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reason: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'right',
    maxWidth: 280,
  },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  dots: { flexDirection: 'row', gap: 4 },
  dot: { width: 4, height: 4, borderRadius: 2 },
  olderSpinner: { paddingVertical: 16 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  emptyTitle: { fontFamily: font.semibold, fontSize: 24, letterSpacing: -0.5 },
  audioBubble: { gap: 8, minWidth: 260 },
  voiceError: { paddingHorizontal: 8, paddingBottom: 8 },
  topFade: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1 },
  bottomFade: { position: 'absolute', top: -32, left: 0, right: 0, bottom: 0 },
  status: { position: 'absolute', left: 16, right: 76, zIndex: 2, alignItems: 'flex-start' },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  statusText: { flexShrink: 1 },
  toBottom: { position: 'absolute', alignSelf: 'center', top: -44 },
  toBottomButton: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
});
