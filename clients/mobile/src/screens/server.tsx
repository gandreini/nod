import { LogOut, Server } from '../icons';
import { Alert } from 'react-native';
import { useNod } from '../nod-context';
import { Group, Page, Row } from '../ui';

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
