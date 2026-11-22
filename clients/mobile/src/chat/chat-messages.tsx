import { Clock, RefreshCw, Trash2 } from '../ui/icons';
import { memo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { artifactSource } from '../connection/api';
import {
  ApprovalCard,
  ChoiceCard,
  CodeRequestCard,
  ConnectAppCard,
  connectLink,
  type Answer,
} from './cards';
import { type LocalFile, type Outgoing, type Recording } from './chat-state';
import { Connection } from '../connection/connection';
import { splitQuestion, type Artifact, type Message } from '../connection/contracts';
import { Markdown } from './markdown';
import { ownedArtifact } from '../connection/links';
import { font, radius, type Theme } from '../ui/theme';
import { MessageAttachments } from '../files/attachment-views';
import { AudioClip } from '../voice/voice';
import { BrowserCard, type HandoffState } from '../browser/browser-sheet';

const unsentSlop = { top: 12, bottom: 12, left: 8, right: 8 };

export function Unsent({
  outgoing,
  theme,
  onRetry,
  onDiscard,
}: {
  outgoing: Outgoing;
  theme: Theme;
  onRetry(id: string): void;
  onDiscard(id: string): void;
}) {
  const failed = outgoing.status === 'failed';
  const reason = outgoing.error;
  return (
    <View style={styles.unsent} accessibilityLiveRegion="polite">
      <Pressable
        onPress={() =>
          reason &&
          Alert.alert(failed ? 'Message not sent' : 'Waiting for connection', reason, undefined, {
            cancelable: true,
          })
        }
        disabled={!reason}
        hitSlop={unsentSlop}
        accessibilityLabel={`${failed ? 'Not sent' : 'Waiting for connection'}. ${reason ?? ''}`}
        style={styles.unsentStatus}
      >
        {failed ? null : <Clock size={14} color={theme.mutedForeground} />}
        <Text style={[styles.caption, { color: theme.mutedForeground }]}>
          {failed ? 'Not sent' : 'Waiting for connection'}
        </Text>
      </Pressable>
      {failed ? (
        <Pressable
          onPress={() => onRetry(outgoing.id)}
          hitSlop={unsentSlop}
          accessibilityRole="button"
          accessibilityLabel="Try sending this message again"
          style={styles.unsentAction}
        >
          <RefreshCw size={14} color={theme.link} />
          <Text style={[styles.caption, styles.unsentLabel, { color: theme.link }]}>Try again</Text>
        </Pressable>
      ) : null}
      <Pressable
        onPress={() => onDiscard(outgoing.id)}
        hitSlop={unsentSlop}
        accessibilityRole="button"
        accessibilityLabel="Delete this unsent message"
        style={styles.unsentAction}
      >
        <Trash2 size={14} color={theme.link} />
        <Text style={[styles.caption, styles.unsentLabel, { color: theme.link }]}>Delete</Text>
      </Pressable>
    </View>
  );
}

function OutgoingMessage({
  outgoing,
  connection,
  theme,
  onRetry,
  onDiscard,
}: {
  outgoing: Outgoing;
  connection: Connection;
  theme: Theme;
  onRetry(id: string): void;
  onDiscard(id: string): void;
}) {
  const { width } = useWindowDimensions();
  const away = useRef(new Animated.Value(0)).current;
  const [leaving, setLeaving] = useState(false);
  const discard = (id: string) => {
    if (leaving) return;
    setLeaving(true);
    Animated.timing(away, {
      toValue: 1,
      duration: 240,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => onDiscard(id));
  };
  return (
    <Animated.View
      pointerEvents={leaving ? 'none' : 'auto'}
      style={
        leaving
          ? {
              opacity: away.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
              transform: [
                { translateX: away.interpolate({ inputRange: [0, 1], outputRange: [0, width] }) },
              ],
            }
          : null
      }
    >
      <UserMessage
        text={outgoing.privateText ?? outgoing.text}
        local={outgoing.files}
        recording={outgoing.audio}
        dim={outgoing.status === 'sent' ? 1 : 0.5}
        connection={connection}
        theme={theme}
      >
        {outgoing.status === 'failed' || outgoing.status === 'waiting' ? (
          <Unsent outgoing={outgoing} theme={theme} onRetry={onRetry} onDiscard={discard} />
        ) : null}
      </UserMessage>
    </Animated.View>
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
  dim = 1,
  audio,
  files,
  children,
}: {
  text: string;
  theme: Theme;
  dim?: number;
  audio?: React.ReactNode;
  files?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <View style={[styles.userRow, styles.userStack]}>
      {files ? <View style={{ opacity: dim }}>{files}</View> : null}
      {text || audio ? (
        <View
          style={[
            styles.userBubble,
            audio ? styles.audioBubble : null,
            { backgroundColor: theme.chatSent, opacity: dim },
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
  dim,
  connection,
  theme,
  children,
}: {
  text: string;
  transcript?: string;
  attachments?: Artifact[];
  local?: LocalFile[];
  recording?: Recording;
  dim?: number;
  connection: Connection;
  theme: Theme;
  children?: React.ReactNode;
}) {
  const { audio, files } = splitAudio(attachments);
  return (
    <UserBubble
      text={audio ? (transcript ?? text) : text}
      theme={theme}
      dim={dim}
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
  codeRequest,
  onOpenBrowser,
}: {
  message: Message;
  connection: Connection;
  theme: Theme;
  pending: boolean;
  onAnswer: Answer;
  handoff?: HandoffState;
  codeRequest?: 'otp' | 'payment';
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
      {codeRequest ? <CodeRequestCard kind={codeRequest} theme={theme} /> : null}
    </View>
  );
}

export const ChatRow = memo(function ChatRow({
  message,
  outgoing,
  stream,
  pending,
  connection,
  theme,
  handoff,
  codeRequest,
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
  codeRequest?: 'otp' | 'payment';
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
      <OutgoingMessage
        outgoing={outgoing}
        connection={connection}
        theme={theme}
        onRetry={onRetry}
        onDiscard={onDiscard}
      />
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
      codeRequest={codeRequest}
      onOpenBrowser={onOpenBrowser}
    />
  );
});

const styles = StyleSheet.create({
  stack: { gap: 12 },
  caption: { fontFamily: font.regular, fontSize: 13, lineHeight: 18 },
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
  unsent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 16 },
  unsentStatus: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  unsentAction: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  unsentLabel: { fontFamily: font.medium },
  audioBubble: { gap: 8, minWidth: 260 },
});
