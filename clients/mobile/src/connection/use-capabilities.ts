import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { tokenRefused, refusedToken } from './api';
import { loadCapabilities, type Capabilities } from './capabilities';
import type { Connection } from './connection';

export function useCapabilities(connection: Connection, refused: (notice: string) => void) {
  const [capabilities, setCapabilities] = useState<Capabilities>({});
  useEffect(() => {
    let current = true;
    const load = () =>
      loadCapabilities(connection)
        .then((next) => {
          if (current && next)
            setCapabilities((known) =>
              JSON.stringify(known) === JSON.stringify(next) ? known : next,
            );
        })
        .catch((problem) => {
          if (current && refusedToken(problem)) refused(tokenRefused(connection.origin));
        });
    void load();
    const foreground = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load();
    });
    return () => {
      current = false;
      foreground.remove();
    };
  }, [connection, refused]);
  return capabilities;
}
