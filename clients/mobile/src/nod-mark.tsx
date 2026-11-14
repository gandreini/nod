import { View } from 'react-native';
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
