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
import { View } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ConnectScreen } from '../connection/connect-screen';
import type { Connection } from '../connection/connection';
import { clearDownloads } from '../files/downloads';
import { FileViewerProvider } from '../files/file-viewer';
import { NodGlyph } from '../ui/nod-mark';
import { NodProvider } from '../connection/nod-context';
import { forgetPending } from '../voice/pending-voice';
import { forgetConnection, loadConnection } from '../connection/stored-connection';
import { useTheme } from '../ui/theme';
import { errorText } from '../connection/api';

type State =
  | { name: 'loading' }
  | { name: 'connect'; notice?: string }
  | { name: 'connected'; connection: Connection };

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
    clearDownloads();
    loadConnection()
      .then((connection) =>
        setState(connection ? { name: 'connected', connection } : { name: 'connect' }),
      )
      .catch((problem) =>
        setState({
          name: 'connect',
          notice: `Could not read the saved connection: ${errorText(problem)}`,
        }),
      );
  }, []);

  const current = useRef<Connection | null>(null);
  current.current = state.name === 'connected' ? state.connection : null;

  const refused = useCallback((notice: string, from: Connection) => {
    if (current.current !== from) return;
    current.current = null;
    clearDownloads();
    setState({ name: 'connect', notice });
    forgetConnection().catch((problem) =>
      setState((state) =>
        state.name === 'connect' && state.notice === notice
          ? {
              name: 'connect',
              notice: `${notice} The saved token could not be removed, so it will load again next time: ${errorText(problem)}`,
            }
          : state,
      ),
    );
  }, []);

  const disconnect = useCallback(async (from: Connection) => {
    if (current.current !== from) return;
    current.current = null;
    await forgetPending(from.origin).catch(() => {});
    clearDownloads();
    await forgetConnection();
    setState({ name: 'connect' });
  }, []);

  if (state.name === 'loading' || !fontsLoaded)
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <NodGlyph size={32} />
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
      <FileViewerProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.background },
          }}
        />
      </FileViewerProvider>
    </NodProvider>
  );
}

export default function Layout() {
  const theme = useTheme();
  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <Root />
      </KeyboardProvider>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
    </SafeAreaProvider>
  );
}
