import { CreditCard, Globe2, KeyRound, Vault } from '../ui/icons';
import { useState } from 'react';
import { Alert } from 'react-native';
import { errorText } from '../connection/api';
import type { VaultListEntry, VaultSession } from '../connection/contracts';
import { Empty, Group, Loaded, Notice, Page, Row, SectionTitle } from '../ui/ui';
import { useRequest, useResource } from './use-resource';

function site(origin: string) {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

const sessionStates = {
  pending: 'Checking',
  saved: 'Signed in',
  needs_sign_in: 'Needs sign-in',
  disconnecting: 'Signing out',
};

export function VaultScreen() {
  const send = useRequest();
  const entries = useResource<VaultListEntry[]>('/api/vault');
  const sessions = useResource<VaultSession[]>('/api/vault/sessions');
  const [error, setError] = useState<string>();
  const logins = (entries.data ?? []).filter((entry) => entry.kind === 'login');
  const cards = (entries.data ?? []).filter((entry) => entry.kind === 'card');
  const signedIn = sessions.data ?? [];

  function confirm(title: string, body: string, path: string, after: () => void) {
    Alert.alert(title, body, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setError(undefined);
          try {
            await send(path, 'DELETE');
          } catch (problem) {
            setError(`${title.replace(/\?$/, '')} failed: ${errorText(problem)}`);
          } finally {
            after();
          }
        },
      },
    ]);
  }

  const removeEntry = (entry: VaultListEntry) =>
    confirm(
      'Delete this item?',
      `${entry.label} is removed from Nod. Nod can't use it again until you save it again.`,
      `/api/vault/${encodeURIComponent(entry.id)}`,
      entries.reload,
    );

  const removeSession = (session: VaultSession) =>
    confirm(
      'Sign out of this site?',
      `Nod forgets its saved sign-in for ${site(session.origin)}.`,
      `/api/vault/sessions/${encodeURIComponent(session.id)}`,
      sessions.reload,
    );

  const empty = !logins.length && !cards.length && !signedIn.length;

  return (
    <Page
      title="Vault"
      back
      refreshing={entries.loading || sessions.loading}
      onRefresh={() => {
        void entries.reload();
        void sessions.reload();
      }}
    >
      {error ? <Notice text={error} /> : null}
      {entries.error && sessions.error ? (
        <Notice text={`Sign-ins did not load: ${sessions.error}`} onRetry={sessions.reload} />
      ) : null}
      <Loaded resource={entries} label="Vault">
        {() => (
          <Loaded resource={sessions} label="Sign-ins">
            {() =>
              empty ? (
                <Empty
                  fill
                  icon={Vault}
                  title="Nothing saved yet"
                  body="When Nod signs in or pays for you, you enter the details in a private form. What you save shows up here."
                />
              ) : (
                <>
                  {logins.length ? (
                    <>
                      <SectionTitle count={logins.length}>Logins</SectionTitle>
                      <Group>
                        {logins.map((entry, index) => (
                          <Row
                            key={entry.id}
                            first={index === 0}
                            icon={KeyRound}
                            title={entry.label}
                            detail={[entry.username || entry.usernameHint, site(entry.origin)]
                              .filter(Boolean)
                              .join(' · ')}
                            onPress={() => removeEntry(entry)}
                          />
                        ))}
                      </Group>
                    </>
                  ) : null}
                  {cards.length ? (
                    <>
                      <SectionTitle count={cards.length}>Cards</SectionTitle>
                      <Group>
                        {cards.map((entry, index) =>
                          entry.kind === 'card' ? (
                            <Row
                              key={entry.id}
                              first={index === 0}
                              icon={CreditCard}
                              title={entry.label}
                              detail={`${entry.brand} •••• ${entry.last4} · ${String(entry.expiryMonth).padStart(2, '0')}/${String(entry.expiryYear).slice(-2)}`}
                              onPress={() => removeEntry(entry)}
                            />
                          ) : null,
                        )}
                      </Group>
                    </>
                  ) : null}
                  {signedIn.length ? (
                    <>
                      <SectionTitle count={signedIn.length}>Signed-in sites</SectionTitle>
                      <Group>
                        {signedIn.map((session, index) => (
                          <Row
                            key={session.id}
                            first={index === 0}
                            icon={Globe2}
                            title={session.label || site(session.origin)}
                            detail={`${site(session.origin)} · ${sessionStates[session.state]}`}
                            onPress={() => removeSession(session)}
                          />
                        ))}
                      </Group>
                    </>
                  ) : null}
                </>
              )
            }
          </Loaded>
        )}
      </Loaded>
    </Page>
  );
}
