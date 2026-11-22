import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import { errorText, tokenRefused, refusedToken } from '../connection/api';
import type { Capabilities } from '../connection/capabilities';
import type { Connection } from '../connection/connection';
import { disablePush, enablePush, loadPushChoice, markAsked, pushBuild, refreshPush } from './push';

export function usePush(
  connection: Connection,
  refused: (notice: string) => void,
  capabilities: Capabilities,
) {
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabledState] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const asking = useRef(false);

  const setEnabled = useCallback(
    async (next: boolean) => {
      setBusy(true);
      setError(undefined);
      try {
        if (!next) {
          await disablePush(connection);
          setEnabledState(false);
        } else if ((await enablePush(connection)) === 'denied') {
          setEnabledState(false);
          setError(
            'Android notifications are off for Nod. Allow them in Android settings → Apps → Nod → Notifications.',
          );
        } else setEnabledState(true);
      } catch (problem) {
        if (refusedToken(problem)) refused(tokenRefused(connection.origin));
        else
          setError(
            `Notifications could not be turned ${next ? 'on' : 'off'}: ${errorText(problem)}`,
          );
      } finally {
        setBusy(false);
      }
    },
    [connection, refused],
  );

  const check = useCallback(async () => {
    try {
      const supported = capabilities.push?.platforms.includes('android') === true;
      setAvailable(supported);
      if (!supported) return;
      const choice = await loadPushChoice(connection);
      if (choice.enabled) await refreshPush(connection).catch(() => {});
      setEnabledState((await loadPushChoice(connection)).enabled);
      if (!choice.asked && !asking.current) {
        asking.current = true;
        await markAsked(connection);
        Alert.alert(
          'Get notified when Nod replies?',
          'Nod can tell you when it writes to you, even when the app is closed. You can change this in Settings.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Turn on', onPress: () => void setEnabled(true) },
          ],
        );
      }
    } catch (problem) {
      if (refusedToken(problem)) refused(tokenRefused(connection.origin));
    }
  }, [capabilities, connection, refused, setEnabled]);

  useEffect(() => {
    if (!pushBuild) return;
    const clear = () => void Notifications.dismissAllNotificationsAsync().catch(() => {});
    clear();
    const foreground = AppState.addEventListener('change', (state) => {
      if (state === 'active') clear();
    });
    return () => foreground.remove();
  }, []);

  useEffect(() => {
    if (!pushBuild) return;
    void check();
    const tokens = Notifications.addPushTokenListener((token) => {
      void refreshPush(connection, String(token.data)).catch(() => {});
    });
    return () => {
      tokens.remove();
    };
  }, [check, connection]);

  return useMemo(
    () => ({ available, enabled, busy, error, setEnabled }),
    [available, enabled, busy, error, setEnabled],
  );
}
