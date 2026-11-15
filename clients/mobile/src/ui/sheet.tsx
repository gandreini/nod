import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from './icons';
import { font, radius, type Theme } from './theme';
import type { Icon } from './ui';

const offscreen = 10_000;
const dismissDistance = 120;
const dismissVelocity = 0.8;

export type CloseSheet = (then?: () => void) => void;

export function IconButton({
  icon: IconComponent,
  label,
  theme,
  onPress,
  disabled,
  selected,
}: {
  icon: Icon;
  label: string;
  theme: Theme;
  onPress(): void;
  disabled?: boolean;
  selected?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      style={({ pressed }) => [
        styles.iconButton,
        {
          backgroundColor: selected ? theme.surface : pressed ? theme.controlActive : 'transparent',
          opacity: disabled ? 0.35 : 1,
        },
        selected ? styles.selected : null,
      ]}
    >
      <IconComponent size={18} color={selected ? theme.foreground : theme.secondary} />
    </Pressable>
  );
}

export function SheetTitle({
  icon: IconComponent,
  title,
  meta,
  closeLabel,
  theme,
  onClose,
}: {
  icon: Icon;
  title: string;
  meta: string;
  closeLabel: string;
  theme: Theme;
  onClose(): void;
}) {
  return (
    <View style={styles.titleRow}>
      <View style={[styles.glyph, { backgroundColor: theme.muted }]}>
        <IconComponent size={18} color={theme.secondary} />
      </View>
      <View style={styles.fill}>
        <Text
          numberOfLines={1}
          style={[styles.title, { color: theme.foreground }]}
          accessibilityRole="header"
        >
          {title}
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.meta, { color: theme.mutedForeground }]}
          accessibilityLiveRegion="polite"
        >
          {meta}
        </Text>
      </View>
      <View style={styles.closeButton}>
        <IconButton icon={X} label={closeLabel} theme={theme} onPress={onClose} />
      </View>
    </View>
  );
}

export function Sheet({
  theme,
  handleTestID,
  onClose,
  header,
  children,
}: {
  theme: Theme;
  handleTestID: string;
  onClose(): void;
  header(close: CloseSheet): ReactNode;
  children(close: CloseSheet): ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const [box, setBox] = useState(0);
  const y = useRef(new Animated.Value(offscreen)).current;
  const closing = useRef(false);
  const opened = useRef(false);
  const top = insets.top + 12;

  const [rested, setRested] = useState(false);
  const rise = useCallback(() => {
    Animated.spring(y, {
      toValue: 0,
      useNativeDriver: true,
      damping: 26,
      stiffness: 240,
      mass: 0.9,
      restDisplacementThreshold: 0.5,
      restSpeedThreshold: 0.5,
    }).start(({ finished }) => {
      if (!finished) return;
      y.setValue(0);
      setRested(true);
    });
  }, [y]);
  const close = useCallback(
    (then?: () => void) => {
      if (closing.current) return;
      closing.current = true;
      setRested(false);
      Animated.timing(y, {
        toValue: box || offscreen,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        onClose();
        then?.();
      });
    },
    [box, onClose, y],
  );

  useEffect(() => {
    if (!box || opened.current) return;
    opened.current = true;
    y.setValue(box);
    rise();
  }, [box, rise, y]);

  const drag = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => setRested(false),
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, move) => y.setValue(Math.max(0, move.dy)),
        onPanResponderRelease: (_, move) => {
          if (move.dy > dismissDistance || move.vy > dismissVelocity) return close();
          rise();
        },
        onPanResponderTerminate: rise,
      }),
    [close, rise, y],
  );

  const backdrop = y.interpolate({
    inputRange: [0, box || 1],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => close()}
    >
      <View style={styles.fill} onLayout={(event) => setBox(event.nativeEvent.layout.height)}>
        <Animated.View style={[styles.backdrop, { opacity: backdrop }]}>
          <Pressable style={styles.fill} onPress={() => close()} accessible={false} />
        </Animated.View>
        {box ? (
          <Animated.View
            accessibilityViewIsModal
            style={[
              styles.sheet,
              {
                top,
                backgroundColor: theme.background,
                borderColor: theme.hairline,
                boxShadow: theme.shadow.sheet,
                transform: [{ translateY: rested ? 0 : y }],
              },
            ]}
          >
            <View {...drag.panHandlers} collapsable={false} style={styles.header}>
              <View collapsable={false} testID={handleTestID} style={styles.grabArea}>
                <View style={[styles.grab, { backgroundColor: theme.border }]} />
              </View>
              {header(close)}
            </View>
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            {children(close)}
          </Animated.View>
        ) : null}
      </View>
    </Modal>
  );
}

export const sheetStyles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12 },
});

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.32)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    overflow: 'hidden',
  },
  header: { paddingHorizontal: 16, paddingBottom: 8 },
  grabArea: { alignItems: 'center', paddingTop: 12, paddingBottom: 16 },
  grab: { width: 36, height: 4, borderRadius: 2, pointerEvents: 'none' },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  closeButton: { marginTop: -7, marginRight: -8 },
  glyph: {
    width: 36,
    height: 36,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontFamily: font.semibold, fontSize: 16, lineHeight: 22, letterSpacing: -0.2 },
  meta: { fontFamily: font.regular, fontSize: 12, lineHeight: 16 },
  selected: {
    boxShadow: '0 1px 2px rgba(25,25,25,0.08), 0 1px 1px rgba(25,25,25,0.04)',
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: radius.input - 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: { height: StyleSheet.hairlineWidth },
});
