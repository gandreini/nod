import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Blocks,
  CalendarClock,
  Ellipsis,
  Gauge,
  LayoutGrid,
  Phone,
  Server,
  Settings,
  Vault,
} from '../ui/icons';
import { font, radius, type Theme } from '../ui/theme';
import type { Icon } from '../ui/ui';
import { useNodBase } from '../connection/nod-context';
import { claimCallStart } from '../call/active';

const items: Array<{ icon: Icon; label: string; href: Href }> = [
  { icon: CalendarClock, label: 'Scheduled', href: '/scheduled' },
  { icon: Blocks, label: 'Apps', href: '/apps' },
  { icon: Gauge, label: 'Usage', href: '/usage' },
  { icon: Vault, label: 'Vault', href: '/vault' },
  { icon: Settings, label: 'Settings', href: '/settings' },
  { icon: Server, label: 'Server', href: '/server' },
  ...(__DEV__ ? [{ icon: LayoutGrid, label: 'UI gallery', href: '/gallery' as Href }] : []),
];

const edge = 16;
const size = 44;
const gap = 8;

export function menuSpace(voice: boolean) {
  return edge + (voice ? 2 : 1) * (size + gap);
}

export function ChatMenu({ theme }: { theme: Theme }) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const { capabilities } = useNodBase();
  const top = insets.top + 8;

  function go(href: Href) {
    setOpen(false);
    router.push(href);
  }

  return (
    <>
      {capabilities.voice ? (
        <Pressable
          onPress={() => {
            if (claimCallStart()) router.push('/call');
          }}
          accessibilityRole="button"
          testID="call-button"
          accessibilityLabel="Talk with Nod"
          hitSlop={8}
          style={({ pressed }) => [
            styles.button,
            {
              top,
              right: menuSpace(false),
              boxShadow: theme.shadow.floating,
              backgroundColor: pressed ? theme.controlActive : theme.surface,
              borderColor: theme.border,
            },
          ]}
        >
          <Phone size={20} color={theme.foreground} />
        </Pressable>
      ) : null}
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        testID="menu-button"
        accessibilityLabel="Menu"
        hitSlop={8}
        style={({ pressed }) => [
          styles.button,
          {
            top,
            boxShadow: theme.shadow.floating,
            backgroundColor: pressed ? theme.controlActive : theme.surface,
            borderColor: theme.border,
          },
        ]}
      >
        <Ellipsis size={22} color={theme.foreground} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setOpen(false)}
            accessible={false}
          />
          <View
            accessibilityViewIsModal
            onAccessibilityEscape={() => setOpen(false)}
            style={[
              styles.menu,
              {
                top: top + 52,
                backgroundColor: theme.surface,
                borderColor: theme.border,
                boxShadow: theme.shadow.floating,
              },
            ]}
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
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    right: edge,
    width: size,
    height: size,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
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
