import { RefreshCw } from '../ui/icons';
import {
  KeyboardAvoidingView,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChatMenu, menuSpace } from './chat-menu';
import { noticeMotion } from './composer-notice';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { timeline, type Outgoing } from './chat-state';
import { type Activity, type Message } from '../connection/contracts';
import { NodGlyph, NodMark } from '../ui/nod-mark';
import { Loading, Notice } from '../ui/ui';
import { useLiveLine } from './live-line';
import { font, radius, useTheme, type Theme } from '../ui/theme';
import { useNod } from '../connection/nod-context';
import { BrowserSheet, useHandoffs } from '../browser/browser-sheet';
import { ChatComposer, Fade } from './chat-composer';
import { ChatRow } from './chat-messages';

type Row = { key: string; message?: Message; outgoing?: Outgoing; stream?: string };
const offlineDelay = 3000;
const awayOffset = 400;
const initialComposerHeight = 76;

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

export function ChatScreen() {
  const theme = useTheme();
  const { connection, chat, capabilities } = useNod();
  const insets = useSafeAreaInsets();
  const list = useRef<FlatList<Row>>(null);
  const noticeShift = useRef(new Animated.Value(0)).current;
  const shiftForNotice = useCallback(
    (height: number) =>
      Animated.timing(noticeShift, {
        toValue: -height,
        duration: noticeMotion.duration,
        easing: noticeMotion.easing,
        useNativeDriver: true,
      }).start(),
    [noticeShift],
  );
  const [away, setAway] = useState(false);
  const [composerHeight, setComposerHeight] = useState(initialComposerHeight);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (chat.live) return setOffline(false);
    const timer = setTimeout(() => setOffline(true), offlineDelay);
    return () => clearTimeout(timer);
  }, [chat.live]);
  const host = new URL(connection.origin).host;
  const keyboard = useReanimatedKeyboardAnimation();
  const centred = useAnimatedStyle(() => ({
    transform: [{ translateY: keyboard.height.value / 2 }],
  }));

  const toLatest = useCallback(() => {
    list.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  const rows: Row[] = [
    ...timeline(chat.messages, chat.outgoing),
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
        codeRequest={row.message ? chat.codeRequests.get(row.message.id) : undefined}
        onAnswer={answer}
        onRetry={retry}
        onDiscard={discard}
        onOpenBrowser={showBrowser}
      />
    ),
    [
      answer,
      chat.codeRequests,
      connection,
      discard,
      handoffStatus,
      pendingQuestions,
      retry,
      showBrowser,
      theme,
    ],
  );

  return (
    <View style={[styles.fill, { backgroundColor: theme.background }]}>
      {chat.ready && rows.length === 0 ? (
        <Reanimated.View
          pointerEvents="none"
          style={[styles.empty, { paddingBottom: composerHeight }, centred]}
        >
          <NodMark size={56} />
          <Text style={[styles.emptyTitle, { color: theme.foreground }]}>
            What can I do for you?
          </Text>
        </Reanimated.View>
      ) : null}
      <KeyboardAvoidingView
        style={styles.fill}
        behavior="translate-with-padding"
        keyboardVerticalOffset={-insets.bottom}
        enabled={!handoffs.open}
      >
        {!chat.ready && chat.error ? (
          <View style={[styles.firstLoad, { paddingTop: insets.top + 64 }]}>
            <Notice text={chat.error} onRetry={chat.reconnect} />
          </View>
        ) : !chat.ready ? (
          <Loading />
        ) : rows.length === 0 ? null : (
          <Animated.View style={[styles.fill, { transform: [{ translateY: noticeShift }] }]}>
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
          </Animated.View>
        )}

        <ChatComposer
          theme={theme}
          height={composerHeight}
          away={away}
          onHeight={setComposerHeight}
          onNotice={shiftForNotice}
          onLatest={toLatest}
        />
      </KeyboardAvoidingView>
      <Fade theme={theme} edge="top" style={[styles.topFade, { height: insets.top + 64 }]} />
      {(chat.error && chat.ready) || (offline && !chat.error) ? (
        <View
          style={[
            styles.status,
            { top: insets.top + 8, right: menuSpace(Boolean(capabilities.voice)) },
          ]}
          pointerEvents="box-none"
        >
          <Pressable
            onPress={() => {
              if (!chat.error) return chat.reconnect();
              Alert.alert('Nod can’t load the chat', chat.error, [
                { text: 'Close', style: 'cancel' },
                { text: 'Try again', onPress: chat.reconnect },
              ]);
            }}
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
              numberOfLines={1}
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
      {handoffs.open ? (
        <BrowserSheet
          key={handoffs.open.turnId}
          turnId={handoffs.open.turnId}
          connection={connection}
          onClose={handoffs.close}
          onReturned={() => handoffs.markReturned(handoffs.open!.messageId)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  caption: { fontFamily: font.regular, fontSize: 13, lineHeight: 18 },
  list: { paddingHorizontal: 16, paddingVertical: 16, gap: 24 },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  workingDetails: { flex: 1, gap: 2 },
  olderSpinner: { paddingVertical: 16 },
  empty: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
  },
  emptyTitle: { fontFamily: font.semibold, fontSize: 24, letterSpacing: -0.5 },
  firstLoad: { flex: 1, paddingHorizontal: 16 },
  topFade: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1 },
  status: {
    position: 'absolute',
    left: 16,
    height: 44,
    zIndex: 2,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
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
});
