import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { connectionIdentity, connectionIssue } from '../../../../src/web/lib/secondary-pages';
import type { AppConnection } from '../connection/contracts';
import { Ellipsis, Pencil, Plus, RefreshCw, Users } from '../ui/icons';
import { Sheet, SheetTitle } from '../ui/sheet';
import { radius, type Theme } from '../ui/theme';
import { Button, Notice, text, type Icon } from '../ui/ui';

function accountLabel(account: AppConnection) {
  const identity = connectionIdentity(account);
  return account.slug === 'notion' && identity.secondary
    ? `${identity.primary} · ${identity.secondary}`
    : identity.primary;
}

function accountDetail(account: AppConnection) {
  if (account.disconnectPending) return 'Disconnecting';
  return connectionIssue(account) ?? connectionIdentity(account).secondary;
}

function TextAction({
  label,
  color,
  theme,
  onPress,
}: {
  label: string;
  color: string;
  theme: Theme;
  onPress(): void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.textAction,
        { backgroundColor: pressed ? theme.controlActive : theme.control },
      ]}
    >
      <Text style={[text.label, { color }]}>{label}</Text>
    </Pressable>
  );
}

export function AccountsSheet({
  name,
  accounts,
  theme,
  onClose,
  onSignIn,
  onDisconnect,
  onAdd,
}: {
  name: string;
  accounts: AppConnection[];
  theme: Theme;
  onClose(): void;
  onSignIn(account: AppConnection): void;
  onDisconnect(account: AppConnection): void;
  onAdd?(): void;
}) {
  return (
    <Sheet
      fit
      theme={theme}
      handleTestID="app-accounts-handle"
      onClose={onClose}
      header={(close) => (
        <SheetTitle
          icon={Users}
          title={`${name} accounts`}
          meta={`${accounts.length} ${accounts.length === 1 ? 'account' : 'accounts'}`}
          closeLabel="Close accounts"
          theme={theme}
          onClose={() => close()}
        />
      )}
    >
      {(close) => (
        <View style={styles.body}>
          {accounts.map((account, index) => {
            const detail = accountDetail(account);
            const issue = Boolean(connectionIssue(account)) && !account.disconnectPending;
            return (
              <View
                key={account.connectionId ?? index}
                style={[
                  styles.account,
                  {
                    borderTopColor: theme.border,
                    borderTopWidth: index ? StyleSheet.hairlineWidth : 0,
                  },
                ]}
              >
                <View style={styles.fill}>
                  <Text style={[text.label, { color: theme.foreground }]} numberOfLines={1}>
                    {accountLabel(account)}
                  </Text>
                  {detail ? (
                    <Text
                      style={[text.small, { color: issue ? theme.accent : theme.mutedForeground }]}
                      numberOfLines={1}
                    >
                      {detail}
                    </Text>
                  ) : null}
                </View>
                {issue ? (
                  <TextAction
                    label="Sign in again"
                    color={theme.foreground}
                    theme={theme}
                    onPress={() => close(() => onSignIn(account))}
                  />
                ) : null}
                {account.disconnectPending ? null : (
                  <TextAction
                    label="Disconnect"
                    color={theme.error}
                    theme={theme}
                    onPress={() =>
                      Alert.alert(
                        `Disconnect ${accountLabel(account)}?`,
                        `Nod stops using this ${name} account.`,
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Disconnect',
                            style: 'destructive',
                            onPress: () => close(() => onDisconnect(account)),
                          },
                        ],
                      )
                    }
                  />
                )}
              </View>
            );
          })}
          {onAdd ? (
            <View style={styles.footer}>
              <Button label="Add account" icon={Plus} onPress={() => close(onAdd)} />
            </View>
          ) : null}
        </View>
      )}
    </Sheet>
  );
}

function MenuItem({
  icon: ItemIcon,
  label,
  theme,
  onPress,
}: {
  icon: Icon;
  label: string;
  theme: Theme;
  onPress(): void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.item,
        { backgroundColor: pressed ? theme.controlActive : 'transparent' },
      ]}
    >
      <ItemIcon size={18} color={theme.secondary} />
      <Text style={[text.body, { color: theme.foreground }]}>{label}</Text>
    </Pressable>
  );
}

export function OptionsSheet({
  name,
  theme,
  onClose,
  onRefresh,
  onRename,
  onManage,
  onAdd,
}: {
  name: string;
  theme: Theme;
  onClose(): void;
  onRefresh?(): void;
  onRename?(): void;
  onManage(): void;
  onAdd?(): void;
}) {
  return (
    <Sheet
      fit
      theme={theme}
      handleTestID="app-options-handle"
      onClose={onClose}
      header={(close) => (
        <SheetTitle
          icon={Ellipsis}
          title={name}
          meta="Options"
          closeLabel="Close options"
          theme={theme}
          onClose={() => close()}
        />
      )}
    >
      {(close) => (
        <View style={styles.menu}>
          {onRefresh ? (
            <MenuItem
              icon={RefreshCw}
              label="Refresh tools"
              theme={theme}
              onPress={() => close(onRefresh)}
            />
          ) : null}
          {onRename ? (
            <MenuItem icon={Pencil} label="Rename" theme={theme} onPress={() => close(onRename)} />
          ) : null}
          <MenuItem
            icon={Users}
            label="Manage accounts"
            theme={theme}
            onPress={() => close(onManage)}
          />
          {onAdd ? (
            <MenuItem icon={Plus} label="Add account" theme={theme} onPress={() => close(onAdd)} />
          ) : null}
        </View>
      )}
    </Sheet>
  );
}

export function RenameSheet({
  name,
  theme,
  onClose,
  onSave,
}: {
  name: string;
  theme: Theme;
  onClose(): void;
  onSave(name: string): Promise<void>;
}) {
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <Sheet
      theme={theme}
      handleTestID="app-rename-handle"
      onClose={onClose}
      header={(close) => (
        <SheetTitle
          icon={Pencil}
          title={`Rename ${name}`}
          meta="Nod and your confirmations use this name."
          closeLabel="Close rename"
          theme={theme}
          onClose={() => close()}
        />
      )}
    >
      {(close) => {
        const save = async () => {
          const next = value.trim();
          if (!next || next === name) return close();
          setSaving(true);
          setError(undefined);
          try {
            await onSave(next);
            close();
          } catch (problem) {
            setError(problem instanceof Error ? problem.message : String(problem));
          } finally {
            setSaving(false);
          }
        };
        return (
          <View style={styles.body}>
            <TextInput
              value={value}
              onChangeText={setValue}
              editable={!saving}
              autoFocus
              maxLength={80}
              returnKeyType="done"
              onSubmitEditing={() => void save()}
              accessibilityLabel="Name"
              placeholderTextColor={theme.placeholder}
              cursorColor={theme.accent}
              selectionColor={theme.primary}
              style={[
                text.body,
                styles.input,
                {
                  color: theme.foreground,
                  borderColor: theme.border,
                  backgroundColor: theme.surface,
                },
              ]}
            />
            {error ? <Notice text={error} /> : null}
            <View style={styles.footer}>
              <Button
                label="Save"
                variant="primary"
                busy={saving}
                disabled={!value.trim()}
                onPress={() => void save()}
              />
            </View>
          </View>
        );
      }}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  account: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  textAction: {
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', paddingTop: 8 },
  menu: { paddingVertical: 8 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 20,
  },
  input: {
    minHeight: 48,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: radius.input,
  },
});
