import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { checkServer, type Connection } from './connection';
import { NodMark } from '../ui/nod-mark';
import { saveConnection } from './stored-connection';
import { font, radius, useTheme } from '../ui/theme';
import { errorText } from './api';
import { Notice } from '../ui/ui';

export function ConnectScreen({
  notice,
  onConnected,
}: {
  notice?: string;
  onConnected: (connection: Connection) => void;
}) {
  const theme = useTheme();
  const [url, setUrl] = useState('https://');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(notice);
  const [focused, setFocused] = useState<'url' | 'token' | null>(null);

  async function connect() {
    if (disabled) return;
    setBusy(true);
    setError(undefined);
    try {
      const connection = await checkServer({ url, token });
      await saveConnection(connection);
      setToken('');
      onConnected(connection);
    } catch (problem) {
      setError(errorText(problem));
    } finally {
      setBusy(false);
    }
  }

  const field = (name: 'url' | 'token') => [
    styles.field,
    {
      color: theme.foreground,
      backgroundColor: theme.surface,
      borderColor: focused === name ? theme.primary : theme.input,
    },
  ];
  const disabled = busy || !token;

  return (
    <KeyboardAvoidingView style={styles.fill} behavior="padding">
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <NodMark size={48} />
        <Text style={[styles.title, { color: theme.foreground }]} accessibilityRole="header">
          Connect to your Nod
        </Text>
        <Text style={[styles.body, { color: theme.mutedForeground }]}>
          Enter your server’s address and the token from NOD_AUTH_TOKEN in its .env file.
        </Text>
        <View style={styles.group}>
          <Text style={[styles.label, { color: theme.foreground }]} nativeID="address-label">
            Server address
          </Text>
          <TextInput
            style={field('url')}
            value={url}
            onChangeText={setUrl}
            onFocus={() => setFocused('url')}
            onBlur={() => setFocused(null)}
            testID="connect-address"
            accessibilityLabelledBy="address-label"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            inputMode="url"
            placeholder="https://nod.example.com"
            placeholderTextColor={theme.placeholder}
            cursorColor={theme.accent}
            selectionColor={theme.primary}
            selectionHandleColor={theme.accent}
            editable={!busy}
          />
        </View>
        <View style={styles.group}>
          <Text style={[styles.label, { color: theme.foreground }]} nativeID="token-label">
            Token
          </Text>
          <TextInput
            style={field('token')}
            value={token}
            onChangeText={setToken}
            onFocus={() => setFocused('token')}
            onBlur={() => setFocused(null)}
            testID="connect-token"
            accessibilityLabelledBy="token-label"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            importantForAutofill="no"
            secureTextEntry
            cursorColor={theme.accent}
            selectionColor={theme.primary}
            selectionHandleColor={theme.accent}
            editable={!busy}
            onSubmitEditing={connect}
          />
        </View>
        {error ? <Notice text={error} /> : null}
        <Pressable
          testID="connect-submit"
          onPress={connect}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityState={{ disabled, busy }}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: disabled
                ? theme.inset
                : pressed
                  ? theme.primaryPressed
                  : theme.primary,
              transform: [{ scale: pressed && !disabled ? 0.98 : 1 }],
            },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={theme.primaryForeground} />
          ) : (
            <Text
              style={[
                styles.buttonText,
                { color: disabled ? theme.mutedForeground : theme.primaryForeground },
              ]}
            >
              Connect
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  form: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 16 },
  title: { fontFamily: font.semibold, fontSize: 28, lineHeight: 34, letterSpacing: -0.6 },
  body: { fontFamily: font.regular, fontSize: 16, lineHeight: 24 },
  group: { gap: 8 },
  label: { fontFamily: font.medium, fontSize: 14 },
  field: {
    borderWidth: 1,
    borderRadius: radius.input,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontFamily: font.regular,
    fontSize: 16,
  },
  button: {
    minHeight: 48,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  buttonText: { fontFamily: font.semibold, fontSize: 16 },
});
