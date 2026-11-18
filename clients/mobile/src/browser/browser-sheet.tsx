import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Keyboard, PanResponder, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Connection } from '../connection/connection';
import type { Turn } from '../connection/contracts';
import { useNod } from '../connection/nod-context';
import { ArrowLeft, Globe2, RefreshCw } from '../ui/icons';
import { IconButton, Sheet, SheetTitle, sheetStyles } from '../ui/sheet';
import { font, radius, type Theme } from '../ui/theme';
import { Button, Loading } from '../ui/ui';
import { pageScale, pointAt, tap, textEdits } from './input';
import { useBrowserHandoff, type BrowserHandoff, type Frame } from './use-browser-handoff';

export type HandoffState = 'active' | 'returned';

const revealed = new Set<string>();
const dragStart = 8;
const returnedText = 'Control returned to Nod. It will check the page and continue.';

export function useHandoffs(turns: Turn[]) {
  const active = useMemo(
    () =>
      new Map(
        turns.flatMap((turn) =>
          turn.handoffMessageId ? [[turn.handoffMessageId, turn.id] as const] : [],
        ),
      ),
    [turns],
  );
  const [open, setOpen] = useState<{ messageId: string; turnId: string } | null>(null);
  const [returned, setReturned] = useState<ReadonlySet<string>>(new Set());
  const current = useRef(active);
  current.current = active;

  useEffect(() => {
    for (const [messageId, turnId] of active) {
      if (revealed.has(messageId)) continue;
      revealed.add(messageId);
      Keyboard.dismiss();
      setOpen({ messageId, turnId });
    }
    setOpen((shown) => (shown && active.get(shown.messageId) === shown.turnId ? shown : null));
  }, [active]);

  const status = useCallback(
    (messageId: string): HandoffState | undefined =>
      returned.has(messageId) ? 'returned' : active.has(messageId) ? 'active' : undefined,
    [active, returned],
  );
  const show = useCallback((messageId: string) => {
    const turnId = current.current.get(messageId);
    if (!turnId) return;
    Keyboard.dismiss();
    setOpen({ messageId, turnId });
  }, []);
  const close = useCallback(() => setOpen(null), []);
  const markReturned = useCallback(
    (messageId: string) => setReturned((items) => new Set(items).add(messageId)),
    [],
  );
  return { open, status, show, close, markReturned };
}

export function BrowserCard({
  state,
  theme,
  onOpen,
}: {
  state: HandoffState;
  theme: Theme;
  onOpen(): void;
}) {
  if (state === 'returned')
    return <Text style={[styles.caption, { color: theme.mutedForeground }]}>{returnedText}</Text>;
  return (
    <View style={[styles.card, { backgroundColor: theme.muted }]}>
      <View style={styles.cardTitle}>
        <Globe2 size={16} color={theme.secondary} />
        <Text style={[styles.title, { color: theme.foreground }]}>Nod's browser</Text>
      </View>
      <Text style={[styles.caption, { color: theme.mutedForeground }]}>
        Nod handed you its browser. It is paused while you use the page.
      </Text>
      <Button label="Open browser" icon={Globe2} variant="primary" onPress={onOpen} />
    </View>
  );
}

export function BrowserSheet({
  turnId,
  connection,
  theme,
  onClose,
  onReturned,
}: {
  turnId: string;
  connection: Connection;
  theme: Theme;
  onClose(): void;
  onReturned(): void;
}) {
  const { refused } = useNod();
  const insets = useSafeAreaInsets();
  const handoff = useBrowserHandoff(connection, turnId, refused);
  const off = !handoff.live || Boolean(handoff.busy) || Boolean(handoff.end);
  return (
    <Sheet
      theme={theme}
      handleTestID="browser-sheet-handle"
      onClose={onClose}
      header={(close) => (
        <>
          <SheetTitle
            icon={Globe2}
            title="Browser"
            meta={handoff.end ? 'Ended' : handoff.status}
            closeLabel="Close the browser"
            theme={theme}
            onClose={() => close()}
          />
          <View style={sheetStyles.toolbar}>
            <IconButton
              icon={ArrowLeft}
              label="Back"
              theme={theme}
              disabled={off}
              onPress={() => void handoff.navigate('back')}
            />
            <IconButton
              icon={RefreshCw}
              label="Reload"
              theme={theme}
              disabled={off}
              onPress={() => void handoff.navigate('reload')}
            />
          </View>
        </>
      )}
    >
      {(close) => (
        <KeyboardAvoidingView
          behavior="padding"
          keyboardVerticalOffset={insets.top + 12}
          style={styles.fill}
        >
          {handoff.end ? (
            <View style={[styles.center, { paddingBottom: insets.bottom + 24 }]}>
              <Text style={[styles.message, { color: theme.mutedForeground }]}>
                {handoff.end === 'returned'
                  ? returnedText
                  : 'This browser handoff has ended. Continue in chat.'}
              </Text>
            </View>
          ) : (
            <BrowserBody
              handoff={handoff}
              theme={theme}
              bottom={insets.bottom + 12}
              onReturn={async () => {
                if (!(await handoff.done())) return;
                onReturned();
                close();
              }}
            />
          )}
        </KeyboardAvoidingView>
      )}
    </Sheet>
  );
}

function BrowserBody({
  handoff,
  theme,
  bottom,
  onReturn,
}: {
  handoff: BrowserHandoff;
  theme: Theme;
  bottom: number;
  onReturn(): void;
}) {
  const [typed, setTyped] = useState('');
  const box = useRef({ width: 0, height: 0 });
  const current = useRef(handoff);
  current.current = handoff;
  const start = useRef<{ x: number; y: number; sentX: number; sentY: number; moved: boolean }>(
    null,
  );

  const touch = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (event) => {
          const { locationX: x, locationY: y } = event.nativeEvent;
          start.current = { x, y, sentX: 0, sentY: 0, moved: false };
        },
        onPanResponderMove: (_, move) => {
          const from = start.current;
          const { size, send } = current.current;
          if (!from || !size.width) return;
          if (!from.moved && Math.abs(move.dx) + Math.abs(move.dy) < dragStart) return;
          from.moved = true;
          const scale = pageScale(box.current, size);
          const x = Math.round(-move.dx * scale);
          const y = Math.round(-move.dy * scale);
          if (x === from.sentX && y === from.sentY) return;
          send([{ type: 'wheel', deltaX: x - from.sentX, deltaY: y - from.sentY }]);
          from.sentX = x;
          from.sentY = y;
        },
        onPanResponderRelease: () => {
          const from = start.current;
          start.current = null;
          if (!from || from.moved) return;
          const at = pointAt(from, box.current, current.current.size);
          if (at) current.current.send(tap(at));
        },
        onPanResponderTerminate: () => {
          start.current = null;
        },
      }),
    [],
  );

  const busy = Boolean(handoff.busy);
  return (
    <>
      <View
        {...touch.panHandlers}
        collapsable={false}
        style={[styles.screen, { backgroundColor: theme.muted }]}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          box.current = { width, height };
        }}
      >
        {handoff.unavailable ? (
          <View style={styles.center} pointerEvents="box-none">
            <Text style={[styles.title, { color: theme.foreground }]}>
              The browser view could not connect.
            </Text>
            <Text style={[styles.message, { color: theme.mutedForeground }]}>
              {[handoff.streamError, 'Your task is waiting. The page can close after 30 minutes.']
                .filter(Boolean)
                .join(' ')}
            </Text>
            <Button label="Reconnect view" icon={RefreshCw} onPress={handoff.reconnect} />
          </View>
        ) : (
          <>
            <FrameImages frame={handoff.frame} onShown={handoff.shown} onMissed={handoff.missed} />
            {handoff.frame ? null : (
              <View style={styles.center} pointerEvents="none">
                <Loading />
              </View>
            )}
          </>
        )}
      </View>
      <View style={[styles.bar, { paddingBottom: bottom }]}>
        {handoff.error ? (
          <Text
            style={[styles.caption, { color: theme.error }]}
            accessibilityLiveRegion="polite"
            numberOfLines={3}
          >
            {handoff.error}
          </Text>
        ) : null}
        <TextInput
          value={typed}
          onChangeText={(next) => {
            handoff.send(textEdits(typed, next));
            setTyped(next);
          }}
          onKeyPress={(event) => {
            if (event.nativeEvent.key === 'Backspace' && !typed)
              handoff.send([{ type: 'key', key: 'Backspace' }]);
          }}
          onSubmitEditing={() => {
            handoff.send([{ type: 'key', key: 'Enter' }]);
            setTyped('');
          }}
          submitBehavior="submit"
          returnKeyType="go"
          autoCapitalize="none"
          editable={handoff.live && !busy}
          placeholder="Type on the page"
          placeholderTextColor={theme.placeholder}
          accessibilityLabel="Type on the page"
          style={[
            styles.input,
            { backgroundColor: theme.surface, borderColor: theme.input, color: theme.foreground },
          ]}
        />
        <View style={styles.footer}>
          <Text style={[styles.caption, styles.fill, { color: theme.mutedForeground }]}>
            Nod is paused while you use this page.
          </Text>
          <Button
            label="Return to Nod"
            variant="primary"
            busy={handoff.busy === 'done'}
            disabled={busy}
            onPress={onReturn}
          />
        </View>
      </View>
    </>
  );
}

function FrameImages({
  frame,
  onShown,
  onMissed,
}: {
  frame?: Frame;
  onShown(width?: number, height?: number): void;
  onMissed(): void;
}) {
  const [slots, setSlots] = useState<[string, string]>(['', '']);
  const [top, setTop] = useState(0);

  useEffect(() => {
    if (!frame) return;
    const back = 1 - top;
    if (frame.uri === slots[top]) return onShown();
    if (frame.uri === slots[back]) {
      setTop(back);
      return onShown();
    }
    setSlots((current) => (back === 0 ? [frame.uri, current[1]] : [current[0], frame.uri]));
  }, [frame?.id]);

  return slots.map((uri, index) =>
    uri ? (
      <Image
        key={index}
        source={{ uri }}
        resizeMode="contain"
        fadeDuration={0}
        pointerEvents="none"
        accessible={index === top}
        accessibilityLabel={index === top ? "Nod's browser" : undefined}
        testID={index === top ? 'browser-frame' : undefined}
        style={[StyleSheet.absoluteFill, { opacity: index === top ? 1 : 0 }]}
        onLoad={(event) => {
          if (index === top || uri !== frame?.uri) return;
          setTop(index);
          onShown(event.nativeEvent.source.width, event.nativeEvent.source.height);
        }}
        onError={() => {
          if (index !== top && uri === frame?.uri) onMissed();
        }}
      />
    ) : null,
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  card: { borderRadius: radius.card, padding: 16, gap: 10 },
  cardTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontFamily: font.semibold, fontSize: 15, lineHeight: 20 },
  caption: { fontFamily: font.regular, fontSize: 13, lineHeight: 18 },
  message: { fontFamily: font.regular, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 32,
  },
  screen: { flex: 1, overflow: 'hidden' },
  bar: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  input: {
    minHeight: 44,
    borderRadius: radius.input,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    fontFamily: font.regular,
    fontSize: 16,
  },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
