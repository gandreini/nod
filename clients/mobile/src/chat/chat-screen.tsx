import { ChevronDown, RefreshCw } from '../ui/icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { ChatMenu } from './chat-menu';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Keyboard,
  Platform,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { artifactSource } from '../connection/api';
import { ApprovalCard, ChoiceCard, ConnectAppCard, connectLink, type Answer } from './cards';
import type { LocalFile, Outgoing, Recording } from './chat-state';
import type { Connection } from '../connection/connection';
import { splitQuestion, type Activity, type Artifact, type Message } from '../connection/contracts';
import { Markdown } from './markdown';
import { NodGlyph, NodMark } from '../ui/nod-mark';
import { Loading } from '../ui/ui';
import { ownedArtifact } from '../connection/links';
import { useLiveLine } from './live-line';
import { font, radius, useTheme, type Theme } from '../ui/theme';
import { useNod } from '../connection/nod-context';
import { AttachMenu, MessageAttachments } from '../files/attachment-views';
import { sendable } from '../files/attachments';
import { Composer } from './composer';
import { useAttachments } from '../files/use-attachments';
import { AudioClip, useVoiceRecorder } from '../voice/voice';
import { prepareTranscription } from '../files/uploads';
import {
  BrowserCard,
  BrowserSheet,
  useHandoffs,
  type HandoffState,
} from '../browser/browser-sheet';

type Row = { key: string; message?: Message; outgoing?: Outgoing; stream?: string };

const maxRecordingSeconds = 300;
const offlineDelay = 3000;
const awayOffset = 400;
const initialComposerHeight = 76;
const menuGap = 12;

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
  const [rested, setRested] = useState(false);
  useEffect(() => {
    setRested(false);
    Animated.spring(shown, {
      toValue: visible ? 1 : 0,
      useNativeDriver: true,
      speed: 16,
      bounciness: visible ? 8 : 0,
    }).start(({ finished }) => {
      if (!finished || !visible) return;
      shown.setValue(1);
      setRested(true);
    });
  }, [shown, visible]);
  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[
        styles.toBottom,
        {
          opacity: rested ? 1 : shown,
          transform: rested
            ? []
            : [
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
            borderColor: theme.hairline,
            boxShadow: theme.shadow.floating,
          },
        ]}
      >
        <ChevronDown size={22} color={theme.foreground} />
      </Pressable>
    </Animated.View>
  );
}

function WorkingRow({ activity, theme }: { activity: Activity[]; theme: Theme }) {
  const line = useLiveLine(activity);
  return (
    <View style={styles.thinking} accessibilityLiveRegion="polite" accessibilityLabel={line.spoken}>
      <NodGlyph size={28} />
      <View style={styles.workingDetails}>
        <Text style={[styles.caption, { color: theme.mutedForeground }]} numberOfLines={1}>
          {line.text}
        </Text>
        {line.task && (
          <Text style={[styles.caption, { color: theme.mutedForeground }]} numberOfLines={1}>
            {line.task}
          </Text>
        )}
        {line.receipt && (
          <Text style={[styles.caption, { color: theme.mutedForeground }]}>{line.receipt}</Text>
        )}
      </View>
    </View>
  );
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
            { backgroundColor: theme.chatSent },
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

function splitAudio(attachments: Artifact[] = []) {
  return {
    audio: attachments.find(
      (item) => item.mimeType.startsWith('audio/') && ownedArtifact(item.url),
    ),
    files: attachments.filter((item) => !item.mimeType.startsWith('audio/')),
  };
}

function UserMessage({
  text,
  transcript,
  attachments,
  local,
  recording,
  faded,
  connection,
  theme,
  children,
}: {
  text: string;
  transcript?: string;
  attachments?: Artifact[];
  local?: LocalFile[];
  recording?: Recording;
  faded?: boolean;
  connection: Connection;
  theme: Theme;
  children?: React.ReactNode;
}) {
  const { audio, files } = splitAudio(attachments);
  return (
    <UserBubble
      text={audio ? (transcript ?? text) : text}
      theme={theme}
      faded={faded}
      files={
        files.length || local?.length ? (
          <MessageAttachments
            attachments={files}
            local={local}
            connection={connection}
            theme={theme}
            alignEnd
          />
        ) : undefined
      }
      audio={
        audio ? (
          <AudioClip
            source={artifactSource(connection, audio.url)}
            mimeType={audio.mimeType}
            size={audio.size}
            theme={theme}
            onBubble
          />
        ) : recording ? (
          <AudioClip
            source={recording.uri}
            durationMillis={recording.durationMillis}
            mimeType={recording.mimeType}
            theme={theme}
            onBubble
          />
        ) : undefined
      }
    >
      {children}
    </UserBubble>
  );
}

export function AssistantMessage({
  message,
  connection,
  theme,
  pending,
  onAnswer,
  handoff,
  onOpenBrowser,
}: {
  message: Message;
  connection: Connection;
  theme: Theme;
  pending: boolean;
  onAnswer: Answer;
  handoff?: HandoffState;
  onOpenBrowser?(messageId: string): void;
}) {
  const { audio, files } = splitAudio(message.attachments);
  const asking = Boolean(message.approval || (message.answerChoices && pending));
  const { lead, question } = asking
    ? splitQuestion(message.text)
    : { lead: message.text, question: '' };
  const links = [...lead.matchAll(connectLink)];
  const text = links.length ? lead.replace(connectLink, '').trim() : lead;
  return (
    <View style={styles.stack}>
      {audio || text ? (
        <View
          style={[
            styles.assistantBubble,
            audio ? styles.audioBubble : null,
            { backgroundColor: theme.chatReceived },
          ]}
        >
          {audio ? (
            <AudioClip
              source={artifactSource(connection, audio.url)}
              mimeType={audio.mimeType}
              size={audio.size}
              theme={theme}
              onBubble
            />
          ) : null}
          {text ? <Markdown text={text} theme={theme} /> : null}
        </View>
      ) : null}
      {message.approval ? (
        <ApprovalCard message={message} question={question} theme={theme} onAnswer={onAnswer} />
      ) : asking ? (
        <ChoiceCard message={message} question={question} theme={theme} onAnswer={onAnswer} />
      ) : null}
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
      {files.length ? (
        <MessageAttachments attachments={files} connection={connection} theme={theme} />
      ) : null}
      {handoff ? (
        <BrowserCard state={handoff} theme={theme} onOpen={() => onOpenBrowser?.(message.id)} />
      ) : null}
    </View>
  );
}

const ChatRow = memo(function ChatRow({
  message,
  outgoing,
  stream,
  pending,
  connection,
  theme,
  handoff,
  onAnswer,
  onRetry,
  onDiscard,
  onOpenBrowser,
}: {
  message?: Message;
  outgoing?: Outgoing;
  stream?: string;
  pending: boolean;
  connection: Connection;
  theme: Theme;
  handoff?: HandoffState;
  onAnswer: Answer;
  onRetry(id: string): void;
  onDiscard(id: string): void;
  onOpenBrowser(messageId: string): void;
}) {
  if (stream !== undefined)
    return (
      <View style={[styles.assistantBubble, { backgroundColor: theme.chatReceived }]}>
        <Markdown text={stream} theme={theme} />
      </View>
    );
  if (outgoing)
    return (
      <UserMessage
        text={outgoing.text}
        local={outgoing.files}
        recording={outgoing.audio}
        faded={outgoing.status === 'sending'}
        connection={connection}
        theme={theme}
      >
        {outgoing.status === 'failed' ? (
          <Pressable
            onPress={() => onRetry(outgoing.id)}
            onLongPress={() => onDiscard(outgoing.id)}
            accessibilityRole="button"
            accessibilityLabel={`Not sent yet. ${outgoing.error ?? ''}`}
            accessibilityHint="Tap to try again, long-press to discard it"
            style={styles.failed}
          >
            <View style={styles.statusLine}>
              <RefreshCw size={12} color={theme.secondary} />
              <Text style={[styles.caption, { color: theme.secondary }]}>
                Not sent yet · Tap to try again
              </Text>
            </View>
            {outgoing.error ? (
              <Text numberOfLines={2} style={[styles.reason, { color: theme.mutedForeground }]}>
                {outgoing.error}
              </Text>
            ) : null}
          </Pressable>
        ) : outgoing.status === 'sending' && outgoing.attempts ? (
          <View style={[styles.failed, styles.statusLine]} accessibilityLiveRegion="polite">
            <ActivityIndicator size="small" color={theme.mutedForeground} />
            <Text style={[styles.caption, { color: theme.mutedForeground }]}>
              Sending… waiting for the connection
            </Text>
          </View>
        ) : null}
      </UserMessage>
    );
  if (!message) return null;
  if (message.role === 'user')
    return (
      <UserMessage
        text={message.displayText ?? message.text}
        transcript={message.text}
        attachments={message.attachments}
        connection={connection}
        theme={theme}
      />
    );
  return (
    <AssistantMessage
      message={message}
      connection={connection}
      theme={theme}
      pending={pending}
      onAnswer={onAnswer}
      handoff={handoff}
      onOpenBrowser={onOpenBrowser}
    />
  );
});

function ChatComposer({
  theme,
  height,
  away,
  onHeight,
  onLatest,
}: {
  theme: Theme;
  height: number;
  away: boolean;
  onHeight(height: number): void;
  onLatest(): void;
}) {
  const { connection, chat } = useNod();
  const [draft, setDraft] = useState('');
  const voice = useVoiceRecorder();
  const files = useAttachments(connection);
  const [attaching, setAttaching] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const shown = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', () =>
      setKeyboard(true),
    );
    const hidden = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () =>
      setKeyboard(false),
    );
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  useEffect(() => {
    if (voice.active && voice.seconds >= maxRecordingSeconds) void finishVoice();
  }, [voice.active, voice.seconds]);

  async function finishVoice() {
    const recording = await voice.finish();
    if (!recording) return;
    chat.sendVoice(recording);
    onLatest();
  }

  function submit() {
    const text = draft.trim();
    if (!sendable(text, files.drafts)) return;
    chat.send(text, files.drafts);
    setDraft('');
    files.clear();
    onLatest();
  }

  return (
    <View
      style={[styles.composerWrap, { paddingBottom: 12 + (keyboard ? 0 : insets.bottom) }]}
      onLayout={(event) => onHeight(event.nativeEvent.layout.height)}
    >
      <Fade theme={theme} edge="bottom" style={styles.bottomFade} />
      <ScrollToLatest visible={away} theme={theme} onPress={onLatest} />
      {voice.error || files.error ? (
        <Pressable
          onPress={() => {
            voice.clearError();
            files.clearError();
          }}
          accessibilityRole="button"
          style={styles.voiceError}
        >
          <Text style={[styles.caption, { color: theme.error }]}>{voice.error ?? files.error}</Text>
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
        above={height + menuGap}
        onClose={() => setAttaching(false)}
        onPick={(source) => void files.pick(source)}
      />
    </View>
  );
}

export function ChatScreen() {
  const theme = useTheme();
  const { connection, chat } = useNod();
  const insets = useSafeAreaInsets();
  const list = useRef<FlatList<Row>>(null);
  const [away, setAway] = useState(false);
  const [composerHeight, setComposerHeight] = useState(initialComposerHeight);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (chat.live) return setOffline(false);
    const timer = setTimeout(() => setOffline(true), offlineDelay);
    return () => clearTimeout(timer);
  }, [chat.live]);
  const host = new URL(connection.origin).host;

  const toLatest = useCallback(() => {
    list.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  const rows: Row[] = [
    ...chat.messages.map((message) => ({ key: message.id, message })),
    ...chat.outgoing.map((outgoing) => ({ key: outgoing.id, outgoing })),
    ...chat.streams
      .filter((stream) => stream.text)
      .map((stream) => ({ key: stream.id, stream: stream.text })),
  ].reverse();

  const { pendingQuestions, answer, retry, discard } = chat;
  const handoffs = useHandoffs(chat.turns);
  const { status: handoffStatus, show: showBrowser } = handoffs;
  const renderItem = useCallback(
    ({ item: row }: { item: Row }) => (
      <ChatRow
        message={row.message}
        outgoing={row.outgoing}
        stream={row.stream}
        pending={row.message ? pendingQuestions.has(row.message.id) : false}
        connection={connection}
        theme={theme}
        handoff={row.message?.role === 'assistant' ? handoffStatus(row.message.id) : undefined}
        onAnswer={answer}
        onRetry={retry}
        onDiscard={discard}
        onOpenBrowser={showBrowser}
      />
    ),
    [answer, connection, discard, handoffStatus, pendingQuestions, retry, showBrowser, theme],
  );

  return (
    <KeyboardAvoidingView
      style={[styles.fill, { backgroundColor: theme.background }]}
      behavior="padding"
    >
      <View style={styles.fill}>
        {!chat.ready ? (
          <Loading />
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
            onScroll={(event) => setAway(event.nativeEvent.contentOffset.y > awayOffset)}
            scrollEventThrottle={64}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            onEndReached={chat.loadOlder}
            onEndReachedThreshold={0.4}
            ListHeaderComponent={
              chat.thinking ? <WorkingRow activity={chat.activity} theme={theme} /> : undefined
            }
            ListFooterComponent={
              chat.loadingOlder ? (
                <ActivityIndicator style={styles.olderSpinner} color={theme.mutedForeground} />
              ) : undefined
            }
            renderItem={renderItem}
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
                {
                  backgroundColor: chat.error ? theme.errorSoft : theme.surface,
                  borderColor: theme.border,
                  boxShadow: theme.shadow.floating,
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
        <ChatMenu theme={theme} />
        <ChatComposer
          theme={theme}
          height={composerHeight}
          away={away}
          onHeight={setComposerHeight}
          onLatest={toLatest}
        />
      </View>
      {handoffs.open ? (
        <BrowserSheet
          key={handoffs.open.turnId}
          turnId={handoffs.open.turnId}
          connection={connection}
          theme={theme}
          onClose={handoffs.close}
          onReturned={() => handoffs.markReturned(handoffs.open!.messageId)}
        />
      ) : null}
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
  assistantBubble: {
    alignSelf: 'flex-start',
    maxWidth: '92%',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopLeftRadius: radius.bubble,
    borderTopRightRadius: radius.bubble,
    borderBottomRightRadius: radius.bubble,
    borderBottomLeftRadius: 4,
  },
  messageText: { fontFamily: font.regular, fontSize: 17, lineHeight: 25 },
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
  workingDetails: { flex: 1, gap: 2 },
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
