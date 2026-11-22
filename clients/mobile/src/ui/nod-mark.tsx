import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useTheme } from './theme';

export function NodMark({ size = 28 }: { size?: number }) {
  const theme = useTheme();
  const ring = size * 0.6;
  const dot = size * 0.24;
  return (
    <View
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <View
        style={{
          width: ring,
          height: ring,
          borderRadius: ring / 2,
          borderWidth: size * 0.12,
          borderColor: theme.mark,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: size * 0.06,
          right: size * 0.07,
          width: dot,
          height: dot,
          borderRadius: dot / 2,
          backgroundColor: theme.primary,
        }}
      />
    </View>
  );
}

export function NodGlyph({ size = 28, mark }: { size?: number; mark?: string }) {
  const theme = useTheme();
  const turn = useRef(new Animated.Value(0)).current;
  const [still, setStill] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => live && setStill(value));
    const change = AccessibilityInfo.addEventListener('reduceMotionChanged', setStill);
    return () => {
      live = false;
      change.remove();
    };
  }, []);
  useEffect(() => {
    if (still) return;
    const spin = Animated.loop(
      Animated.timing(turn, {
        toValue: 1,
        duration: 1100,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    spin.start();
    return () => spin.stop();
  }, [still, turn]);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <View
      style={{ width: size, height: size }}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={size} height={size} viewBox="0 0 32 32">
        <Circle cx="16" cy="16" r="10" stroke={mark ?? theme.mark} strokeWidth="4" fill="none" />
      </Svg>
      <Animated.View
        style={{ position: 'absolute', width: size, height: size, transform: [{ rotate }] }}
      >
        <Svg width={size} height={size} viewBox="0 0 32 32">
          <Circle cx="25" cy="6" r="4" fill={theme.primary} />
        </Svg>
      </Animated.View>
    </View>
  );
}
