import * as ScreenOrientation from 'expo-screen-orientation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Platform,
  Image,
  Keyboard,
  Modal,
  PanResponder,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Connection } from '../connection/connection';
import type { Turn } from '../connection/contracts';
import { useNodBase } from '../connection/nod-context';
import { ArrowLeft, Globe2, RefreshCw, X } from '../ui/icons';
import { IconButton } from '../ui/sheet';
import { darkTheme, font, radius, type Theme } from '../ui/theme';
import { Button, Loading } from '../ui/ui';
import {
  clampZoom,
  pageScale,
  pinchZoom,
  pointAt,
  tap,
  textEdits,
  unzoom,
  type Zoom,
} from './input';
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
  onClose,
  onReturned,
}: {
  turnId: string;
  connection: Connection;
  onClose(): void;
  onReturned(): void;
}) {
  const theme = darkTheme;
  const { refused } = useNodBase();
  const insets = useSafeAreaInsets();
  const handoff = useBrowserHandoff(connection, turnId, refused);
  const off = !handoff.live || Boolean(handoff.busy) || Boolean(handoff.end);
  useEffect(() => {
    void ScreenOrientation.unlockAsync().catch(() => {});
    return () => {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(
        () => {},
      );
    };
  }, []);
  return (
    <Modal
      visible
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      supportedOrientations={['portrait', 'landscape-left', 'landscape-right']}
      onRequestClose={onClose}
    >
      <StatusBar barStyle="light-content" />
      <View
        style={[
          styles.fill,
          styles.theater,
          { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right },
        ]}
      >
        <View style={styles.top}>
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
          <View style={styles.heading}>
            <Text style={[styles.title, { color: theme.foreground }]} numberOfLines={1}>
              Browser
            </Text>
            <Text style={[styles.caption, { color: theme.mutedForeground }]} numberOfLines={1}>
              {handoff.end ? 'Ended' : handoff.status}
            </Text>
          </View>
          <IconButton icon={X} label="Close the browser" theme={theme} onPress={onClose} />
        </View>
        <KeyboardAvoidingView behavior="padding" style={styles.fill}>
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
                onClose();
              }}
            />
          )}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

type Gesture = {
  mode: 'tap' | 'scroll' | 'pan' | 'pinch';
  x: number;
  y: number;
  sentX: number;
  sentY: number;
  zoom: Zoom;
  mid?: { x: number; y: number };
  distance?: number;
};

function fingers(event: GestureResponderEvent) {
  const [a, b] = event.nativeEvent.touches;
  if (!a || !b) return null;
  return {
    mid: { x: (a.locationX + b.locationX) / 2, y: (a.locationY + b.locationY) / 2 },
    distance: Math.max(1, Math.hypot(a.locationX - b.locationX, a.locationY - b.locationY)),
  };
}

function BrowserScreen({
  handoff,
  theme,
  dark,
  onTap,
}: {
  handoff: BrowserHandoff;
  theme: Theme;
  dark?: boolean;
  onTap?(): void;
}) {
  const box = useRef({ width: 0, height: 0 });
  const current = useRef(handoff);
  current.current = handoff;
  const tapped = useRef(onTap);
  tapped.current = onTap;
  const zoom = useRef<Zoom>({ scale: 1, x: 0, y: 0 });
  const scale = useRef(new Animated.Value(1)).current;
  const shiftX = useRef(new Animated.Value(0)).current;
  const shiftY = useRef(new Animated.Value(0)).current;
  const gesture = useRef<Gesture | null>(null);

  const show = useCallback(
    (next: Zoom) => {
      zoom.current = next;
      scale.setValue(next.scale);
      shiftX.setValue(next.x);
      shiftY.setValue(next.y);
    },
    [scale, shiftX, shiftY],
  );

  const touch = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (event) => {
          const { locationX: x, locationY: y } = event.nativeEvent;
          gesture.current = { mode: 'tap', x, y, sentX: 0, sentY: 0, zoom: zoom.current };
        },
        onPanResponderMove: (event, move) => {
          const now = gesture.current;
          const { size, send } = current.current;
          if (!now || !size.width) return;
          const pair = fingers(event);
          if (pair) {
            if (now.mode !== 'pinch' || !now.mid || !now.distance) {
              gesture.current = { ...now, mode: 'pinch', zoom: zoom.current, ...pair };
              return;
            }
            show(
              pinchZoom(
                now.zoom,
                now.mid,
                now.distance,
                pair.mid,
                pair.distance,
                box.current,
                size,
              ),
            );
            return;
          }
          if (now.mode === 'pinch') return;
          if (now.mode === 'tap') {
            if (Math.abs(move.dx) + Math.abs(move.dy) < dragStart) return;
            now.mode = zoom.current.scale > 1 ? 'pan' : 'scroll';
            now.zoom = zoom.current;
          }
          if (now.mode === 'pan') {
            show(
              clampZoom(
                { ...now.zoom, x: now.zoom.x + move.dx, y: now.zoom.y + move.dy },
                box.current,
                size,
              ),
            );
            return;
          }
          const ratio = pageScale(box.current, size) / zoom.current.scale;
          const x = Math.round(-move.dx * ratio);
          const y = Math.round(-move.dy * ratio);
          if (x === now.sentX && y === now.sentY) return;
          send([{ type: 'wheel', deltaX: x - now.sentX, deltaY: y - now.sentY }]);
          now.sentX = x;
          now.sentY = y;
        },
        onPanResponderRelease: () => {
          const now = gesture.current;
          gesture.current = null;
          if (!now || now.mode !== 'tap') return;
          const at = pointAt(
            unzoom(now, box.current, zoom.current),
            box.current,
            current.current.size,
          );
          if (at) {
            current.current.send(tap(at));
            tapped.current?.();
          }
        },
        onPanResponderTerminate: () => {
          gesture.current = null;
        },
      }),
    [show],
  );

  return (
    <View
      {...touch.panHandlers}
      collapsable={false}
      style={[styles.screen, { backgroundColor: dark ? '#000000' : theme.muted }]}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        box.current = { width, height };
        show(clampZoom(zoom.current, box.current, current.current.size));
      }}
    >
      {handoff.unavailable ? (
        <View style={styles.center} pointerEvents="box-none">
          <Text style={[styles.title, { color: dark ? '#ffffff' : theme.foreground }]}>
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
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { transform: [{ translateX: shiftX }, { translateY: shiftY }, { scale }] },
            ]}
          >
            <FrameImages frame={handoff.frame} onShown={handoff.shown} onMissed={handoff.missed} />
          </Animated.View>
          {handoff.frame ? null : (
            <View style={styles.center} pointerEvents="none">
              <Loading />
            </View>
          )}
        </>
      )}
    </View>
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
  const busy = Boolean(handoff.busy);
  return (
    <>
      <BrowserScreen handoff={handoff} theme={theme} dark onTap={() => setTyped('')} />
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
          autoCorrect={false}
          spellCheck={false}
          autoComplete="off"
          importantForAutofill="no"
          textContentType="none"
          keyboardType={Platform.OS === 'android' ? 'visible-password' : 'default'}
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
  theater: { backgroundColor: '#000000' },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  heading: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
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
