import { ArrowUp, Mic, Plus, Square, X } from '../ui/icons';
import { DraftStrip } from '../files/attachment-views';
import { sendable, type Draft } from '../files/attachments';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { font, radius, type Theme } from '../ui/theme';
import { clock, Levels } from '../voice/voice';

export function Composer({
  theme,
  draft,
  onDraft,
  ready,
  working,
  recording,
  onSubmit,
  onStop,
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
  onSubmit(): void;
  onStop(): void;
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
  const showStop = working && !hasContent;
  const [height, setHeight] = useState(52);
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
                styles.sendButton,
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
              accessibilityRole="button"
              accessibilityLabel="Send voice message"
              style={({ pressed }) => [
                styles.sendButton,
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
              accessibilityRole="button"
              accessibilityLabel="Add a photo or file"
              style={({ pressed }) => [
                styles.sendButton,
                { backgroundColor: pressed ? theme.controlActive : 'transparent' },
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
            {!hasContent ? (
              <Pressable
                onPress={onRecord}
                disabled={!ready}
                accessibilityRole="button"
                accessibilityLabel="Record a voice message"
                style={({ pressed }) => [
                  styles.sendButton,
                  { backgroundColor: pressed ? theme.controlActive : 'transparent' },
                ]}
              >
                <Mic size={20} color={theme.foreground} />
              </Pressable>
            ) : null}
            {showStop ? (
              <Pressable
                onPress={onStop}
                accessibilityRole="button"
                accessibilityLabel="Stop"
                style={({ pressed }) => [
                  styles.sendButton,
                  { backgroundColor: pressed ? theme.controlActive : theme.control },
                ]}
              >
                <Square size={14} color={theme.foreground} solid />
              </Pressable>
            ) : hasContent ? (
              <Pressable
                onPress={onSubmit}
                disabled={!ready || !canSend}
                accessibilityRole="button"
                testID="composer-send"
                accessibilityLabel="Send"
                accessibilityState={{ disabled: !ready || !canSend }}
                style={({ pressed }) => [
                  styles.sendButton,
                  {
                    backgroundColor: !canSend
                      ? theme.inset
                      : pressed
                        ? theme.primaryPressed
                        : theme.primary,
                    transform: [{ scale: pressed ? 0.96 : 1 }],
                  },
                ]}
              >
                <ArrowUp size={20} color={theme.primaryForeground} />
              </Pressable>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  recording: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36 },
  timer: { fontFamily: font.medium, fontSize: 15, fontVariant: ['tabular-nums'], minWidth: 40 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  composer: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: 8,
    paddingRight: 8,
    paddingVertical: 8,
  },
  input: {
    flex: 1,
    maxHeight: 160,
    paddingVertical: 8,
    fontFamily: font.regular,
    fontSize: 16,
    lineHeight: 22,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
