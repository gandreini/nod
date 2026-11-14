import { router, type Href } from 'expo-router';
import {
  Blocks,
  CalendarClock,
  Ellipsis,
  Gauge,
  Palette,
  Server,
  Settings,
  Vault,
} from 'lucide-react-native';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font, radius, type Theme } from './theme';
import type { Icon } from './ui';

const items: Array<{ icon: Icon; label: string; href: Href }> = [
  { icon: CalendarClock, label: 'Scheduled', href: '/scheduled' },
  { icon: Blocks, label: 'Apps', href: '/apps' },
  { icon: Gauge, label: 'Usage', href: '/usage' },
  { icon: Vault, label: 'Vault', href: '/vault' },
  { icon: Settings, label: 'Settings', href: '/settings' },
  { icon: Server, label: 'Server', href: '/server' },
  ...(__DEV__ ? [{ icon: Palette, label: 'UI gallery', href: '/gallery' as Href }] : []),
];

export function floatingShadow(theme: Theme) {
  return {
    shadowColor: theme.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: theme.dark ? 0.4 : 0.08,
    shadowRadius: 16,
    elevation: 4,
  };
}

export function ChatMenu({ theme, attention }: { theme: Theme; attention?: boolean }) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const top = insets.top + 8;

  function go(href: Href) {
    setOpen(false);
    router.push(href);
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        testID="menu-button"
        accessibilityLabel="Menu"
        hitSlop={8}
        style={({ pressed }) => [
          styles.button,
          floatingShadow(theme),
          {
            top,
            backgroundColor: pressed ? theme.controlActive : theme.surface,
            borderColor: theme.border,
          },
        ]}
      >
        <Ellipsis size={22} color={theme.foreground} />
        {attention ? (
          <View
            style={[styles.dot, { backgroundColor: theme.primary, borderColor: theme.surface }]}
          />
        ) : null}
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          style={styles.backdrop}
          onPress={() => setOpen(false)}
          accessibilityLabel="Close menu"
        >
          <View
            style={[
              styles.menu,
              floatingShadow(theme),
              { top: top + 52, backgroundColor: theme.surface, borderColor: theme.border },
            ]}
            onStartShouldSetResponder={() => true}
          >
            {items.map(({ icon: ItemIcon, label, href }, index) => (
              <Pressable
                key={label}
                onPress={() => go(href)}
                accessibilityRole="menuitem"
                style={({ pressed }) => [
                  styles.item,
                  {
                    backgroundColor: pressed ? theme.controlActive : 'transparent',
                    borderTopColor: theme.border,
                    borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <ItemIcon size={20} color={theme.secondary} />
                <Text style={[styles.label, { color: theme.foreground }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    right: 16,
    width: 44,
    height: 44,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  dot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
  backdrop: { flex: 1 },
  menu: {
    position: 'absolute',
    right: 16,
    minWidth: 208,
    borderRadius: radius.card + 4,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    paddingVertical: 4,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 16,
  },
  label: { fontFamily: font.medium, fontSize: 16 },
});
