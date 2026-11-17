import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

const edge = 1;

function fadeEdges(offset: number, viewport: number, content: number) {
  return { start: offset > edge, end: offset + viewport < content - edge };
}

function Fade({
  color,
  side,
  shown,
  width,
}: {
  color: string;
  side: 'start' | 'end';
  shown: boolean;
  width: number;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: shown ? 1 : 0,
      duration: 150,
      useNativeDriver: true,
    }).start();
  }, [opacity, shown]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.fade, side === 'start' ? styles.start : styles.end, { width, opacity }]}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient
            id={id}
            x1={side === 'start' ? '0' : '1'}
            y1="0"
            x2={side === 'start' ? '1' : '0'}
            y2="0"
          >
            <Stop offset="0" stopColor={color} stopOpacity={1} />
            <Stop offset="0.35" stopColor={color} stopOpacity={0.9} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

export function ScrollFade({
  color,
  children,
  style,
  contentContainerStyle,
  width = 56,
  ...props
}: {
  color: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  width?: number;
} & Omit<ScrollViewProps, 'horizontal' | 'onScroll' | 'onLayout' | 'onContentSizeChange'>) {
  const size = useRef({ offset: 0, viewport: 0, content: 0 });
  const [edges, setEdges] = useState({ start: false, end: false });
  const update = (next: Partial<typeof size.current>) => {
    size.current = { ...size.current, ...next };
    const { offset, viewport, content } = size.current;
    const now = fadeEdges(offset, viewport, content);
    setEdges((was) => (was.start === now.start && was.end === now.end ? was : now));
  };
  return (
    <View style={style}>
      <ScrollView
        {...props}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={contentContainerStyle}
        scrollEventThrottle={16}
        onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) =>
          update({ offset: event.nativeEvent.contentOffset.x })
        }
        onLayout={(event) => update({ viewport: event.nativeEvent.layout.width })}
        onContentSizeChange={(content) => update({ content })}
      >
        {children}
      </ScrollView>
      <Fade color={color} side="start" shown={edges.start} width={width} />
      <Fade color={color} side="end" shown={edges.end} width={width} />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  fade: { position: 'absolute', top: 0, bottom: 0 },
  start: { left: 0 },
  end: { right: 0 },
});
