import { ArrowUp, Mic, Plus, Square, X } from '../ui/icons';
import { DraftStrip } from '../files/attachment-views';
import { sendable, type Draft } from '../files/attachments';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { font, radius, type Theme } from '../ui/theme';
import { clock, Levels } from '../voice/voice';

export function Composer({
  theme,
  draft,
  onDraft,
  ready,
  working,
  recording,
  micBlocked,
  onSubmit,
  onStop,
  stopping = false,
  onRecord,
  onCancelRecording,
  onSendRecording,
  drafts = [],
  onAttach,
  onRemoveDraft,
  onRetryDraft,
}: {
  theme: Theme;
  draft: string;
  onDraft(text: string): void;
  ready: boolean;
  working: boolean;
  recording?: { seconds: number; levels: number[] };
  micBlocked?: boolean;
  onSubmit(): void;
  onStop(): void;
  stopping?: boolean;
  onRecord(): void;
  onCancelRecording(): void;
  onSendRecording(): void;
  drafts?: Draft[];
  onAttach(): void;
  onRemoveDraft(id: string): void;
  onRetryDraft(id: string): void;
}) {
  const hasContent = draft.trim().length > 0 || drafts.length > 0;
  const canSend = sendable(draft, drafts);
  const action = hasContent ? 'send' : working ? 'stop' : 'mic';
  const [height, setHeight] = useState(56);
  return (
    <View
      onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
      style={[
        styles.composer,
        {
          borderRadius: height <= 60 ? height / 2 : 28,
          backgroundColor: theme.surface,
          borderColor: theme.hairline,
          boxShadow: theme.shadow.raised,
        },
      ]}
    >
      {!recording && drafts.length ? (
        <DraftStrip drafts={drafts} theme={theme} onRemove={onRemoveDraft} onRetry={onRetryDraft} />
      ) : null}
      <View style={styles.row}>
        {recording ? (
          <>
            <Pressable
              onPress={onCancelRecording}
              accessibilityRole="button"
              accessibilityLabel="Cancel recording"
              hitSlop={8}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: pressed ? theme.controlActive : theme.control },
              ]}
            >
              <X size={18} color={theme.foreground} />
            </Pressable>
            <View style={styles.recording}>
              <Text style={[styles.timer, { color: theme.foreground }]}>
                {clock(recording.seconds)}
              </Text>
              <Levels levels={recording.levels} theme={theme} />
            </View>
            <Pressable
              onPress={onSendRecording}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel="Send voice message"
              style={({ pressed }) => [
                styles.button,
                {
                  backgroundColor: pressed ? theme.primaryPressed : theme.primary,
                  transform: [{ scale: pressed ? 0.96 : 1 }],
                },
              ]}
            >
              <ArrowUp size={20} color={theme.primaryForeground} />
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              onPress={onAttach}
              disabled={!ready}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel="Add a photo or file"
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: pressed ? theme.controlActive : theme.control },
              ]}
            >
              <Plus size={22} color={theme.foreground} />
            </Pressable>
            <TextInput
              value={draft}
              onChangeText={onDraft}
              placeholder="Message Nod"
              placeholderTextColor={theme.placeholder}
              cursorColor={theme.accent}
              selectionColor={theme.primary}
              selectionHandleColor={theme.accent}
              multiline
              style={[styles.input, { color: theme.foreground }]}
              testID="composer-input"
              accessibilityLabel="Message"
            />
            {action === 'send' ? (
              <ActionButton
                kind="send"
                color={canSend ? theme.primary : theme.inset}
                pressed={theme.primaryPressed}
                onPress={onSubmit}
                disabled={!ready || !canSend}
                label="Send"
                testID="composer-send"
              >
                <ArrowUp
                  size={20}
                  color={canSend ? theme.primaryForeground : theme.mutedForeground}
                />
              </ActionButton>
            ) : action === 'stop' ? (
              <ActionButton
                kind="stop"
                color={theme.control}
                pressed={theme.controlActive}
                onPress={onStop}
                disabled={stopping}
                label={stopping ? 'Stopping all work' : 'Stop all work'}
              >
                <Square size={14} color={theme.foreground} solid />
              </ActionButton>
            ) : (
              <ActionButton
                kind="mic"
                color={theme.surface}
                pressed={theme.controlActive}
                onPress={onRecord}
                disabled={!ready}
                label="Record a voice message"
              >
                <Mic size={20} color={micBlocked ? theme.placeholder : theme.foreground} />
              </ActionButton>
            )}
          </>
        )}
      </View>
    </View>
  );
}

const slide = 14;

function ActionButton({
  kind,
  color,
  pressed,
  onPress,
  disabled,
  label,
  testID,
  children,
}: {
  kind: string;
  color: string;
  pressed: string;
  onPress(): void;
  disabled?: boolean;
  label: string;
  testID?: string;
  children: ReactNode;
}) {
  const previous = useRef({ kind, node: children, color });
  const [leaving, setLeaving] = useState<ReactNode>(null);
  const [fading, setFading] = useState<string | null>(null);
  const progress = useRef(new Animated.Value(1)).current;
  const tint = useRef(new Animated.Value(0)).current;
  useLayoutEffect(() => {
    if (previous.current.color !== color) {
      setFading(previous.current.color);
      tint.setValue(1);
      Animated.timing(tint, { toValue: 0, duration: 200, useNativeDriver: true }).start(
        ({ finished }) => {
          if (finished) setFading(null);
        },
      );
    }
    if (previous.current.kind === kind) return;
    setLeaving(previous.current.node);
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setLeaving(null);
    });
  }, [kind, color, progress, tint]);
  useEffect(() => {
    previous.current = { kind, node: children, color };
  });
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={disabled ? { disabled } : undefined}
      testID={testID}
      hitSlop={4}
      style={styles.button}
    >
      {({ pressed: down }) => (
        <View
          style={[
            styles.face,
            {
              backgroundColor: down ? pressed : color,
              opacity: disabled && kind === 'stop' ? 0.5 : 1,
            },
          ]}
        >
          {fading && !down ? (
            <Animated.View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, { backgroundColor: fading, opacity: tint }]}
            />
          ) : null}
          {leaving ? (
            <Animated.View
              style={[
                styles.icon,
                {
                  opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
                  transform: [
                    {
                      translateY: progress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, -slide],
                      }),
                    },
                  ],
                },
              ]}
            >
              {leaving}
            </Animated.View>
          ) : null}
          <Animated.View
            style={[
              styles.icon,
              {
                opacity: progress,
                transform: [
                  {
                    translateY: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [slide, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            {children}
          </Animated.View>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  recording: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40 },
  timer: { fontFamily: font.medium, fontSize: 15, fontVariant: ['tabular-nums'], minWidth: 40 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  composer: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: 8,
    paddingRight: 8,
    paddingVertical: 8,
  },
  input: {
    flex: 1,
    maxHeight: 160,
    minHeight: 40,
    paddingTop: 8.5,
    paddingBottom: 8.5,
    fontFamily: font.regular,
    fontSize: 17,
    lineHeight: 23,
  },
  button: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  face: { width: 40, height: 40, borderRadius: radius.full, overflow: 'hidden' },
  icon: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
