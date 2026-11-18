import { ChevronLeft, ChevronRight, RefreshCw } from './icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NodGlyph } from './nod-mark';
import { font, radius, useTheme, type Theme } from './theme';

export type Icon = ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

export function Page({
  title,
  action,
  back,
  refreshing,
  onRefresh,
  onEndReached,
  children,
}: {
  title: string;
  action?: ReactNode;
  back?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  onEndReached?: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  const [pulled, setPulled] = useState(false);
  const reachedAt = useRef(0);
  useEffect(() => {
    if (!refreshing) setPulled(false);
  }, [refreshing]);
  return (
    <SafeAreaView edges={['top']} style={[styles.fill, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        {back ? (
          <Pressable
            onPress={() => router.back()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={({ pressed }) => [
              styles.back,
              { backgroundColor: pressed ? theme.controlActive : 'transparent' },
            ]}
          >
            <ChevronLeft size={24} color={theme.foreground} />
          </Pressable>
        ) : null}
        <Text style={[styles.title, { color: theme.foreground }]} accessibilityRole="header">
          {title}
        </Text>
        {action}
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        scrollEventThrottle={onEndReached ? 100 : undefined}
        onScroll={
          onEndReached
            ? ({ nativeEvent: { contentOffset, contentSize, layoutMeasurement } }) => {
                const left = contentSize.height - contentOffset.y - layoutMeasurement.height;
                if (left > layoutMeasurement.height || reachedAt.current === contentSize.height)
                  return;
                reachedAt.current = contentSize.height;
                onEndReached();
              }
            : undefined
        }
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={pulled && Boolean(refreshing)}
              onRefresh={() => {
                setPulled(true);
                onRefresh();
              }}
              tintColor={theme.accent}
              colors={[theme.accent]}
              progressBackgroundColor={theme.surface}
            />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return (
    <View
      style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }, style]}
    >
      {children}
    </View>
  );
}

export function Button({
  label,
  onPress,
  icon: IconComponent,
  variant = 'ghost',
  busy,
  disabled,
}: {
  label: string;
  onPress(): void;
  icon?: Icon;
  variant?: 'primary' | 'ghost' | 'danger';
  busy?: boolean;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const off = disabled || busy;
  const colors = {
    primary: { rest: theme.primary, pressed: theme.primaryPressed, text: theme.primaryForeground },
    ghost: { rest: theme.control, pressed: theme.controlActive, text: theme.foreground },
    danger: { rest: theme.errorSoft, pressed: theme.controlActive, text: theme.error },
  }[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: pressed ? colors.pressed : colors.rest,
          opacity: off && !busy ? 0.5 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.text} />
      ) : IconComponent ? (
        <IconComponent size={16} color={colors.text} />
      ) : null}
      <Text style={[styles.buttonText, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

export function Notice({ text, onRetry }: { text: string; onRetry?: () => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.notice, { backgroundColor: theme.errorSoft }]}>
      <Text
        style={[styles.small, styles.fill, { color: theme.error }]}
        accessibilityLiveRegion="polite"
      >
        {text}
      </Text>
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Retry"
        >
          <RefreshCw size={18} color={theme.error} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function SectionTitle({ children, count }: { children: string; count?: number }) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionText, { color: theme.mutedForeground }]}>{children}</Text>
      {count !== undefined ? (
        <Text style={[styles.sectionText, { color: theme.mutedForeground }]}>{count}</Text>
      ) : null}
    </View>
  );
}

export function Empty({
  icon: IconComponent,
  title,
  body,
  fill,
  children,
}: {
  icon: Icon;
  title: string;
  body: string;
  fill?: boolean;
  children?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.empty, fill ? styles.emptyFill : null]}>
      <View style={[styles.emptyIcon, { backgroundColor: theme.accentSoft }]}>
        <IconComponent size={28} color={theme.accent} />
      </View>
      <Text style={[styles.emptyTitle, { color: theme.foreground }]}>{title}</Text>
      <Text style={[styles.body, styles.center, { color: theme.mutedForeground }]}>{body}</Text>
      {children}
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.loading} accessibilityRole="progressbar" accessibilityLabel="Loading">
      <NodGlyph size={32} />
    </View>
  );
}

export function Loaded<T>({
  resource,
  label,
  children,
}: {
  resource: { data?: T; error?: string; reload(): unknown };
  label: string;
  children(data: T): ReactNode;
}) {
  return (
    <>
      {resource.error ? (
        <Notice text={`${label} did not load: ${resource.error}`} onRetry={resource.reload} />
      ) : null}
      {resource.data !== undefined ? children(resource.data) : resource.error ? null : <Loading />}
    </>
  );
}

function tone(theme: Theme, kind: 'attention' | 'error' | 'quiet' | 'good') {
  return {
    attention: { background: theme.accentSoft, color: theme.accent },
    error: { background: theme.errorSoft, color: theme.error },
    quiet: { background: theme.muted, color: theme.secondary },
    good: { background: theme.muted, color: theme.foreground },
  }[kind];
}

export function Pill({
  label,
  icon: IconComponent,
  kind = 'quiet',
}: {
  label: string;
  icon?: Icon;
  kind?: 'attention' | 'error' | 'quiet' | 'good';
}) {
  const theme = useTheme();
  const colors = tone(theme, kind);
  return (
    <View style={[styles.pill, { backgroundColor: colors.background }]}>
      {IconComponent ? <IconComponent size={12} color={colors.color} strokeWidth={2.5} /> : null}
      <Text style={[styles.pillText, { color: colors.color }]}>{label}</Text>
    </View>
  );
}

export function Meta({ icon: IconComponent, children }: { icon?: Icon; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.meta}>
      {IconComponent ? <IconComponent size={14} color={theme.mutedForeground} /> : null}
      <Text style={[styles.small, styles.fill, { color: theme.mutedForeground }]}>{children}</Text>
    </View>
  );
}

export function Group({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      {children}
    </View>
  );
}

export function Row({
  icon: RowIcon,
  title,
  detail,
  first,
  danger,
  onPress,
}: {
  icon: Icon;
  title: string;
  detail?: string;
  first?: boolean;
  danger?: boolean;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const color = danger ? theme.error : theme.foreground;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? theme.controlActive : 'transparent',
          borderTopColor: theme.border,
          borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
        },
      ]}
    >
      <View style={[styles.glyph, { backgroundColor: danger ? theme.errorSoft : theme.muted }]}>
        <RowIcon size={18} color={danger ? theme.error : theme.secondary} />
      </View>
      <View style={styles.fill}>
        <Text style={[text.label, { color }]}>{title}</Text>
        {detail ? (
          <Text style={[text.small, { color: theme.mutedForeground }]} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      {onPress && !danger ? <ChevronRight size={18} color={theme.mutedForeground} /> : null}
    </Pressable>
  );
}

export const text = StyleSheet.create({
  title: { fontFamily: font.semibold, fontSize: 16, lineHeight: 22, letterSpacing: -0.2 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22 },
  small: { fontFamily: font.regular, fontSize: 13, lineHeight: 18 },
  label: { fontFamily: font.medium, fontSize: 14, lineHeight: 20 },
});

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { textAlign: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    minHeight: 56,
  },
  back: {
    width: 40,
    height: 40,
    marginLeft: -8,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flex: 1, fontFamily: font.semibold, fontSize: 28, lineHeight: 34, letterSpacing: -0.6 },
  content: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 12 },
  card: { borderWidth: 1, borderRadius: radius.card, padding: 16, gap: 8 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: radius.full,
  },
  buttonText: { fontFamily: font.medium, fontSize: 14 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: radius.card,
    padding: 12,
  },
  small: { fontFamily: font.regular, fontSize: 13, lineHeight: 18 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22 },
  section: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 16,
    paddingHorizontal: 4,
  },
  sectionText: {
    fontFamily: font.medium,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  empty: { alignItems: 'center', gap: 12, paddingVertical: 48, paddingHorizontal: 24 },
  emptyFill: { flexGrow: 1, justifyContent: 'center', paddingBottom: 96 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontFamily: font.semibold, fontSize: 20, letterSpacing: -0.4 },
  loading: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  pillText: { fontFamily: font.medium, fontSize: 12 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  group: { borderWidth: 1, borderRadius: radius.card, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  glyph: {
    width: 32,
    height: 32,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
