import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { ConnectionProblem, checkServer, serverOrigin } from '../src/connection/connection.ts';
import { monthlyLimit } from '../src/sections/money.ts';
import { startFakeServer } from './fake-server.ts';

function problem(kind: ConnectionProblem['kind']) {
  return (error: unknown) => error instanceof ConnectionProblem && error.kind === kind;
}

describe('serverOrigin', () => {
  test('keeps an HTTPS origin', () => {
    assert.equal(serverOrigin(' https://nod.example.com '), 'https://nod.example.com');
    assert.equal(serverOrigin('https://nod.example.com/'), 'https://nod.example.com');
    assert.equal(serverOrigin('https://nod.example.com:8443'), 'https://nod.example.com:8443');
  });

  test('allows plain HTTP only on the same device', () => {
    assert.equal(serverOrigin('http://localhost:4310'), 'http://localhost:4310');
    assert.equal(serverOrigin('http://127.0.0.1:4310'), 'http://127.0.0.1:4310');
    assert.throws(() => serverOrigin('http://nod.example.com'), problem('address'));
    assert.throws(() => serverOrigin('http://192.168.1.20:4310'), problem('address'));
  });

  test('refuses paths, credentials, queries and other schemes', () => {
    for (const value of [
      'https://nod.example.com/chat',
      'https://user:secret@nod.example.com',
      'https://nod.example.com/?token=x',
      'https://nod.example.com/#x',
      'ftp://nod.example.com',
      'nod.example.com',
      '',
    ])
      assert.throws(() => serverOrigin(value), problem('address'), value);
  });
});

describe('checkServer', () => {
  let fake: Awaited<ReturnType<typeof startFakeServer>>;
  let other: Server;
  let fakeOrigin: string;
  let otherOrigin: string;
  let token: string;

  before(async () => {
    fake = await startFakeServer();
    fakeOrigin = fake.origin;
    token = fake.token;
    other = createServer((_request, response) => response.end('<html>not nod</html>'));
    await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve));
    otherOrigin = `http://127.0.0.1:${(other.address() as AddressInfo).port}`;
  });

  after(async () => {
    other.close();
    await fake.stop();
  });

  test('accepts the token the server accepts', async () => {
    const connection = await checkServer({ url: `${fakeOrigin}/`, token });
    assert.equal(connection.origin, fakeOrigin);
    assert.equal(connection.token, token);
    assert.equal(connection.owner, '00000000-0000-4000-8000-000000000005');
  });

  test('reports a token the server refuses', async () => {
    await assert.rejects(
      checkServer({ url: fakeOrigin, token: randomBytes(32).toString('hex') }),
      problem('rejected'),
    );
  });

  test('refuses a malformed token before any request', async () => {
    await assert.rejects(checkServer({ url: fakeOrigin, token: 'short' }), problem('token'));
  });

  test('refuses a bad address before any request', async () => {
    await assert.rejects(
      checkServer({ url: 'http://nod.example.com', token: randomBytes(32).toString('hex') }),
      problem('address'),
    );
  });

  test('reports a server that is not Nod', async () => {
    await assert.rejects(checkServer({ url: otherOrigin, token }), problem('not-nod'));
  });

  test('reports an unreachable server', async () => {
    await assert.rejects(checkServer({ url: 'http://127.0.0.1:9', token }), problem('unreachable'));
  });
});

describe('monthly limit', () => {
  test('accepts whole dollars and cents typed with a dot or a comma', () => {
    for (const [typed, usd] of [
      ['19.99', 19.99],
      ['1.13', 1.13],
      ['10.29', 10.29],
      ['25.50', 25.5],
      ['25,50', 25.5],
      ['12.5', 12.5],
      ['1', 1],
    ] as const)
      assert.deepEqual(monthlyLimit(typed), { usd }, typed);
  });

  test('refuses amounts below $1, negatives and more than two decimals', () => {
    for (const typed of ['0.99', '0.29', '0', '-5', '', 'abc'])
      assert.deepEqual(monthlyLimit(typed), { error: 'Enter a limit of at least $1.' }, typed);
    assert.deepEqual(monthlyLimit('1.234'), {
      error: 'Use at most two decimals, for example 25.50.',
    });
  });
});
