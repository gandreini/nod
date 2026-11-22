import {
  ConversationProvider,
  useConversationControls,
  useConversationInput,
  useConversationMode,
  useConversationStatus,
} from '@elevenlabs/react-native';
import { requestRecordingPermissionsAsync, useAudioPlayer } from 'expo-audio';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApprovalCard } from '../chat/cards';
import { useKeepAwake } from 'expo-keep-awake';
import { openCall } from './active';
import { errorText, request, tokenRefused, refusedToken } from '../connection/api';
import { splitQuestion } from '../connection/contracts';
import { useNod } from '../connection/nod-context';
import { allowIn } from '../connection/permissions';
import { Mic, MicOff, PhoneOff } from '../ui/icons';
import { NodGlyph } from '../ui/nod-mark';
import { darkTheme, font } from '../ui/theme';
import { voiceRelayCue } from '../../../../src/shared/voice';

const colors = {
  background: '#111111',
  foreground: '#fafafa',
  muted: '#a3a3a3',
  control: '#2a2a2a',
  hangUp: '#d93a4f',
  error: '#ffacb9',
};

function Call() {
  const insets = useSafeAreaInsets();
  const { connection, refused, chat } = useNod();
  const { startSession, endSession, sendUserMessage } = useConversationControls();
  const { status, message } = useConversationStatus();
  const { isSpeaking } = useConversationMode();
  const { isMuted, setMuted } = useConversationInput();
  const [problem, setProblem] = useState<string>();
  const [micDenied, setMicDenied] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const connected = useRef(false);
  const seen = useRef<Set<string> | null>(null);
  const [waiting, setWaiting] = useState(false);
  const waitingSound = useAudioPlayer(require('../../assets/sounds/waiting.wav'));
  const fade = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const confirmation = [...chat.messages]
    .reverse()
    .find(
      (message) =>
        message.role === 'assistant' &&
        (message.approval?.state === 'pending' || message.approval?.state === 'working'),
    );

  useEffect(() => openCall(), []);
  useKeepAwake();

  useEffect(() => {
    if (!seen.current) {
      seen.current = new Set(chat.messages.map((message) => message.id));
      return;
    }
    const fresh = chat.messages.filter((message) => !seen.current!.has(message.id));
    if (!fresh.length) return;
    for (const message of fresh) seen.current.add(message.id);
    if (status !== 'connected') return;
    if (fresh.some((message) => message.role === 'assistant')) {
      setWaiting(false);
      sendUserMessage(voiceRelayCue);
    } else if (fresh.some((message) => message.role === 'user')) setWaiting(true);
  }, [chat.messages, sendUserMessage, status]);

  useEffect(() => {
    if (!waiting) return;
    const limit = setTimeout(() => setWaiting(false), 180_000);
    return () => clearTimeout(limit);
  }, [waiting]);

  const audible = waiting && status === 'connected' && !isSpeaking;
  useEffect(() => {
    waitingSound.loop = true;
    clearInterval(fade.current);
    if (audible) {
      waitingSound.volume = 0;
      waitingSound.play();
    }
    const target = audible ? 0.4 : 0;
    fade.current = setInterval(() => {
      const next = waitingSound.volume + (target > waitingSound.volume ? 0.05 : -0.05);
      if (Math.abs(target - waitingSound.volume) <= 0.05) {
        waitingSound.volume = target;
        clearInterval(fade.current);
        if (!audible) waitingSound.pause();
      } else waitingSound.volume = next;
    }, 40);
    return () => clearInterval(fade.current);
  }, [audible, waitingSound]);

  useEffect(() => {
    const cancel = new AbortController();
    void (async () => {
      const permission = await requestRecordingPermissionsAsync();
      if (cancel.signal.aborted) return;
      if (!permission.granted) {
        setMicDenied(true);
        setProblem(`Nod needs the microphone for calls. ${allowIn}`);
        return;
      }
      try {
        const { conversationToken } = await request<{ conversationToken: string }>(
          connection,
          '/api/fork/voice/session',
          'POST',
          {},
          cancel.signal,
        );
        if (cancel.signal.aborted) return;
        startSession({ conversationToken, connectionType: 'webrtc' });
      } catch (error) {
        if (cancel.signal.aborted) return;
        if (refusedToken(error)) refused(tokenRefused(connection.origin));
        else setProblem(`The call could not start: ${errorText(error)}`);
      }
    })();
    return () => {
      cancel.abort();
      endSession();
    };
  }, [attempt, connection, endSession, refused, startSession]);

  useEffect(() => {
    if (status === 'connected') connected.current = true;
    if (status === 'disconnected' && connected.current) router.back();
  }, [status]);

  const failure = problem ?? (status === 'error' ? message || 'The call stopped.' : undefined);
  const label = failure
    ? failure
    : status === 'connected'
      ? isSpeaking
        ? 'Nod is speaking'
        : waiting
          ? 'Asking Nod…'
          : isMuted
            ? 'Muted'
            : 'Listening…'
      : 'Connecting…';

  function hangUp() {
    connected.current = false;
    endSession();
    router.back();
  }

  function callAgain() {
    endSession();
    connected.current = false;
    setProblem(undefined);
    setMicDenied(false);
    setAttempt((count) => count + 1);
  }

  return (
    <View
      style={[styles.screen, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 40 }]}
    >
      <StatusBar style="light" />
      <View style={styles.center}>
        <View style={[styles.halo, { opacity: isSpeaking ? 1 : 0.35 }]}>
          <NodGlyph size={72} mark={colors.foreground} />
        </View>
        <Text style={styles.name}>Nod</Text>
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.status, { color: failure ? colors.error : colors.muted }]}
        >
          {label}
        </Text>
        {failure ? (
          <View style={styles.actions}>
            <Pressable
              onPress={callAgain}
              accessibilityRole="button"
              style={({ pressed }) => [styles.action, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={styles.actionText}>Try again</Text>
            </Pressable>
            {micDenied ? (
              <Pressable
                onPress={() => void Linking.openSettings()}
                accessibilityRole="button"
                style={({ pressed }) => [styles.action, { opacity: pressed ? 0.7 : 1 }]}
              >
                <Text style={styles.actionText}>Open settings</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
      {confirmation ? (
        <ScrollView style={styles.confirmation} contentContainerStyle={styles.confirmationContent}>
          <ApprovalCard
            message={confirmation}
            question={splitQuestion(confirmation.text).question || confirmation.text}
            theme={darkTheme}
            onAnswer={chat.answer}
          />
        </ScrollView>
      ) : null}
      <View style={styles.controls}>
        <Pressable
          onPress={() => setMuted(!isMuted)}
          disabled={status !== 'connected'}
          accessibilityRole="button"
          accessibilityLabel={isMuted ? 'Unmute' : 'Mute'}
          style={({ pressed }) => [
            styles.round,
            {
              backgroundColor: isMuted ? colors.foreground : colors.control,
              opacity: status === 'connected' ? (pressed ? 0.7 : 1) : 0.4,
            },
          ]}
        >
          {isMuted ? (
            <MicOff size={26} color={colors.background} />
          ) : (
            <Mic size={26} color={colors.foreground} />
          )}
        </Pressable>
        <Pressable
          onPress={hangUp}
          accessibilityRole="button"
          accessibilityLabel="End the call"
          testID="end-call"
          style={({ pressed }) => [
            styles.round,
            { backgroundColor: colors.hangUp, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <PhoneOff size={28} color={colors.foreground} />
        </Pressable>
      </View>
    </View>
  );
}

export function CallScreen() {
  return (
    <ConversationProvider>
      <Call />
    </ConversationProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, alignItems: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  halo: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: '#1f1f1f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontFamily: font.semibold, fontSize: 28, color: colors.foreground },
  actions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  action: {
    minHeight: 44,
    paddingHorizontal: 20,
    borderRadius: 22,
    backgroundColor: colors.control,
    justifyContent: 'center',
  },
  actionText: { fontFamily: font.medium, fontSize: 16, color: colors.foreground },
  status: {
    fontFamily: font.regular,
    fontSize: 17,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  controls: { flexDirection: 'row', gap: 48 },
  confirmation: { alignSelf: 'stretch', maxHeight: '45%', marginBottom: 32 },
  confirmationContent: { paddingHorizontal: 16 },
  round: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
