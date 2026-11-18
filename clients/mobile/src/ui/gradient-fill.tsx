import { useId, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

export function GradientFill({
  color,
  opaque,
  mid,
}: {
  color: string;
  opaque: 'top' | 'bottom' | 'start' | 'end';
  mid: { offset: number; opacity: number };
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [size, setSize] = useState<{ width: number; height: number }>();
  const vertical = opaque === 'top' || opaque === 'bottom';
  const from = opaque === 'top' || opaque === 'start' ? 0 : 1;
  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={({ nativeEvent: { layout } }) =>
        setSize((current) =>
          current?.width === layout.width && current.height === layout.height
            ? current
            : { width: layout.width, height: layout.height },
        )
      }
    >
      {size ? (
        <Svg width={size.width} height={size.height}>
          <Defs>
            <LinearGradient
              id={id}
              x1={vertical ? 0 : from}
              y1={vertical ? from : 0}
              x2={vertical ? 0 : 1 - from}
              y2={vertical ? 1 - from : 0}
            >
              <Stop offset="0" stopColor={color} stopOpacity={1} />
              <Stop offset={mid.offset} stopColor={color} stopOpacity={mid.opacity} />
              <Stop offset="1" stopColor={color} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect width={size.width} height={size.height} fill={`url(#${id})`} />
        </Svg>
      ) : null}
    </View>
  );
}
