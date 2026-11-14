import {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  useFonts,
} from '@expo-google-fonts/geist';
import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ConnectScreen } from '../connect-screen';
import type { Connection } from '../connection';
import { NodProvider } from '../nod-context';
import { forgetPending } from '../pending-voice';
import { forgetConnection, loadConnection } from '../stored-connection';
import { useTheme } from '../theme';

type State =
  | { name: 'loading' }
  | { name: 'connect'; notice?: string }
  | { name: 'connected'; connection: Connection };

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function Root() {
  const theme = useTheme();
  const [state, setState] = useState<State>({ name: 'loading' });
  const [fontsLoaded] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    GeistMono_400Regular,
  });

  useEffect(() => {
    loadConnection()
      .then((connection) =>
        setState(connection ? { name: 'connected', connection } : { name: 'connect' }),
      )
      .catch((problem) =>
        setState({
          name: 'connect',
          notice: `Could not read the saved connection: ${message(problem)}`,
        }),
      );
  }, []);

  const current = useRef<Connection | null>(null);
  current.current = state.name === 'connected' ? state.connection : null;

  const refused = useCallback((notice: string, from: Connection) => {
    if (current.current !== from) return;
    current.current = null;
    void forgetConnection();
    setState({ name: 'connect', notice });
  }, []);

  const disconnect = useCallback(async (from: Connection) => {
    if (current.current !== from) return;
    current.current = null;
    await forgetPending(from.origin).catch(() => {});
    await forgetConnection();
    setState({ name: 'connect' });
  }, []);

  if (state.name === 'loading' || !fontsLoaded)
    return (
      <View style={{ flex: 1, backgroundColor: theme.background, justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );

  if (state.name === 'connect')
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
        <ConnectScreen
          notice={state.notice}
          onConnected={(connection) => setState({ name: 'connected', connection })}
        />
      </SafeAreaView>
    );

  return (
    <NodProvider connection={state.connection} refused={refused} disconnect={disconnect}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.background },
        }}
      />
    </NodProvider>
  );
}

export default function Layout() {
  const theme = useTheme();
  return (
    <SafeAreaProvider>
      <Root />
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
    </SafeAreaProvider>
  );
}
