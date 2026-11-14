import { ChevronRight, LogOut, Server } from 'lucide-react-native';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNod } from '../nod-context';
import { radius, useTheme } from '../theme';
import { Page, text, type Icon } from '../ui';

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

export function Group({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      {children}
    </View>
  );
}

export function ServerScreen() {
  const { connection, chat, disconnect } = useNod();
  const host = new URL(connection.origin).host;
  function confirmDisconnect() {
    Alert.alert(
      'Disconnect from this server?',
      `The address and token for ${host} are deleted from this phone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: () => void disconnect() },
      ],
    );
  }
  return (
    <Page title="Server" back>
      <Group>
        <Row first icon={Server} title={host} detail={chat.live ? 'Connected' : 'Reconnecting…'} />
        <Row icon={LogOut} title="Disconnect" danger onPress={confirmDisconnect} />
      </Group>
    </Page>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
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
