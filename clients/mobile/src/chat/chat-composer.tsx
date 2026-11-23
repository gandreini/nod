import { ChevronDown } from '../ui/icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ComposerNotice } from './composer-notice';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { GradientFill } from '../ui/gradient-fill';
import { radius, type Theme } from '../ui/theme';
import { useFocusEffect } from 'expo-router';
import { useNod } from '../connection/nod-context';
import { AttachMenu } from '../files/attachment-views';
import { sendable } from '../files/attachments';
import { Composer } from './composer';
import { useAttachments } from '../files/use-attachments';
import { useVoiceRecorder } from '../voice/voice';
import { prepareTranscription } from '../files/uploads';

const maxRecordingSeconds = 300;
const menuGap = 12;

export function Fade({
  theme,
  edge,
  style,
}: {
  theme: Theme;
  edge: 'top' | 'bottom';
  style: StyleProp<ViewStyle>;
}) {
  return (
    <View pointerEvents="none" style={style}>
      <GradientFill color={theme.background} opaque={edge} mid={{ offset: 0.5, opacity: 0.88 }} />
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
        hitSlop={4}
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

export function ChatComposer({
  theme,
  height,
  away,
  onHeight,
  onNotice,
  onLatest,
}: {
  theme: Theme;
  height: number;
  away: boolean;
  onHeight(height: number): void;
  onNotice(height: number): void;
  onLatest(): void;
}) {
  const { connection, chat } = useNod();
  const [draft, setDraft] = useState('');
  const voice = useVoiceRecorder();
  const voiceNow = useRef(voice);
  voiceNow.current = voice;
  const files = useAttachments(connection);
  const [attaching, setAttaching] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [stopping, setStopping] = useState(false);
  const insets = useSafeAreaInsets();
  const voiceBusy = chat.outgoing.some(
    (item) => item.audio && item.status !== 'failed' && item.status !== 'sent',
  );

  const noticeText = voice.error ?? files.error ?? chat.notice ?? notice;

  useEffect(() => {
    if (voice.active && voice.seconds >= maxRecordingSeconds) void finishVoice();
  }, [voice.active, voice.seconds]);

  useFocusEffect(
    useCallback(
      () => () => {
        if (voiceNow.current.active) voiceNow.current.cancel();
      },
      [],
    ),
  );

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
      style={[styles.composerWrap, { paddingBottom: 12 + insets.bottom }]}
      onLayout={(event) => onHeight(event.nativeEvent.layout.height)}
    >
      <Fade theme={theme} edge="bottom" style={styles.bottomFade} />
      <ScrollToLatest visible={away && !noticeText} theme={theme} onPress={onLatest} />
      <View>
        <ComposerNotice
          text={noticeText}
          theme={theme}
          onDismiss={() => {
            voice.clearError();
            files.clearError();
            chat.clearNotice();
            setNotice(undefined);
          }}
          onHeight={onNotice}
        />
        <Composer
          theme={theme}
          draft={draft}
          onDraft={setDraft}
          ready={chat.ready}
          working={chat.working}
          recording={voice.active ? { seconds: voice.seconds, levels: voice.levels } : undefined}
          onSubmit={submit}
          stopping={stopping}
          onStop={() => {
            setStopping(true);
            void chat.stop().finally(() => setStopping(false));
          }}
          micBlocked={voiceBusy}
          onRecord={() => {
            if (voiceBusy)
              return setNotice('Wait for your voice message to finish sending, or delete it.');
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
      </View>
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

const styles = StyleSheet.create({
  bottomFade: { position: 'absolute', top: -32, left: 0, right: 0, bottom: 0 },
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
