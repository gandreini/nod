import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text } from 'react-native';
import { font, type Theme } from '../ui/theme';

const tuck = 28;

export const noticeMotion = { duration: 220, easing: Easing.out(Easing.cubic) };
const shownFor = 5000;

export function ComposerNotice({
  text,
  theme,
  onDismiss,
  onHeight,
}: {
  text?: string;
  theme: Theme;
  onDismiss(): void;
  onHeight(height: number): void;
}) {
  const [shown, setShown] = useState(text);
  const progress = useRef(new Animated.Value(0)).current;
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const resize = useRef(onHeight);
  resize.current = onHeight;
  useEffect(() => {
    if (!text) resize.current(0);
  }, [text]);
  useEffect(() => {
    if (text) setShown(text);
    Animated.timing(progress, {
      toValue: text ? 1 : 0,
      ...noticeMotion,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !text) setShown(undefined);
    });
    if (!text) return;
    const timer = setTimeout(() => dismiss.current(), shownFor);
    return () => clearTimeout(timer);
  }, [progress, text]);
  if (!shown) return null;
  return (
    <Animated.View
      onLayout={(event) => text && onHeight(event.nativeEvent.layout.height - tuck)}
      style={[
        styles.notice,
        {
          backgroundColor: theme.muted,
          borderColor: theme.hairline,
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [tuck, 0] }) },
          ],
        },
      ]}
    >
      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel={`${shown} Dismiss`}
        accessibilityLiveRegion="polite"
        style={styles.body}
      >
        <Text style={[styles.text, { color: theme.foreground }]}>{shown}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  notice: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '100%',
    marginBottom: -tuck,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
  },
  body: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12 + tuck },
  text: { fontFamily: font.regular, fontSize: 13, lineHeight: 18 },
});
