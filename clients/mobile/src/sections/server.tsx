import { LogOut, Server } from '../ui/icons';
import { useState } from 'react';
import { Alert } from 'react-native';
import { errorText } from '../connection/api';
import { useNod } from '../connection/nod-context';
import { Group, Page, Row } from '../ui/ui';

export function ServerScreen() {
  const { connection, chat, disconnect } = useNod();
  const host = new URL(connection.origin).host;
  const [leaving, setLeaving] = useState(false);
  function confirmDisconnect() {
    Alert.alert(
      'Disconnect from this server?',
      `The address and token for ${host} are deleted from this phone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => {
            setLeaving(true);
            disconnect().catch((problem) => {
              setLeaving(false);
              Alert.alert('Disconnect failed', errorText(problem));
            });
          },
        },
      ],
    );
  }
  return (
    <Page title="Server" back>
      <Group>
        <Row first icon={Server} title={host} detail={chat.live ? 'Connected' : 'Reconnecting…'} />
        <Row
          icon={LogOut}
          title={leaving ? 'Disconnecting…' : 'Disconnect'}
          danger
          onPress={leaving ? undefined : confirmDisconnect}
        />
      </Group>
    </Page>
  );
}
