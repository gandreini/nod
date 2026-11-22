import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import test, { type TestContext } from 'node:test';
import Fastify from 'fastify';
import { decodeJwt } from 'jose';
import pg from 'pg';
import type { PushDevice, PushNotification, PushSender } from '../src/ports/push.ts';
import { createFcmSender, parseServiceAccount } from '../src/providers/fcm/index.ts';
import { registerForkCapabilities } from '../src/server/fork-capabilities.ts';
import { createPush, notificationText } from '../src/server/push.ts';

async function body(request: IncomingMessage) {
  let text = '';
  for await (const chunk of request) text += chunk;
  return text;
}

async function fakeGoogle(
  answer: (path: string, payload: string) => { status: number; json: unknown },
) {
  const calls: { path: string; payload: string; authorization?: string }[] = [];
  const server = createServer(async (request, response) => {
    const payload = await body(request);
    calls.push({ path: request.url!, payload, authorization: request.headers.authorization });
    const { status, json } = answer(request.url!, payload);
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(json));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function account(origin: string) {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    type: 'service_account',
    project_id: 'fixture-project',
    client_email: 'fixture@fixture-project.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    token_uri: `${origin}/token`,
  };
}

const notification = { title: 'Nod', body: 'Hello', data: { messageId: 'm1' } };

test('the service account is read from JSON or base64 and refused otherwise', () => {
  const json = JSON.stringify(account('https://oauth2.googleapis.com'));
  assert.equal(parseServiceAccount(json).project_id, 'fixture-project');
  assert.equal(
    parseServiceAccount(Buffer.from(json).toString('base64')).project_id,
    'fixture-project',
  );
  assert.throws(() => parseServiceAccount('not a key'), /NOD_FCM_SERVICE_ACCOUNT must be/);
  assert.throws(
    () => parseServiceAccount('{"type":"authorized_user"}'),
    /NOD_FCM_SERVICE_ACCOUNT must be/,
  );
});

test('FCM receives a signed token exchange and the message Android expects', async (t) => {
  const google = await fakeGoogle((path) =>
    path === '/token'
      ? { status: 200, json: { access_token: 'fixture-access', expires_in: 3600 } }
      : { status: 200, json: { name: 'projects/fixture-project/messages/1' } },
  );
  t.after(google.close);
  const sender = createFcmSender(parseServiceAccount(JSON.stringify(account(google.origin))), {
    fcmOrigin: google.origin,
  });
  assert.deepEqual(await sender.send({ token: 'device-1', platform: 'android' }, notification), {
    status: 'sent',
  });
  assert.deepEqual(await sender.send({ token: 'device-2', platform: 'android' }, notification), {
    status: 'sent',
  });
  const exchanges = google.calls.filter((call) => call.path === '/token');
  assert.equal(exchanges.length, 1);
  const form = new URLSearchParams(exchanges[0]!.payload);
  assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const claims = decodeJwt(form.get('assertion')!);
  assert.equal(claims.iss, 'fixture@fixture-project.iam.gserviceaccount.com');
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/firebase.messaging');
  assert.equal(claims.aud, `${google.origin}/token`);
  const send = google.calls.find(
    (call) => call.path === '/v1/projects/fixture-project/messages:send',
  )!;
  assert.equal(send.authorization, 'Bearer fixture-access');
  assert.deepEqual(JSON.parse(send.payload), {
    message: {
      token: 'device-1',
      notification: { title: 'Nod', body: 'Hello' },
      data: { messageId: 'm1' },
      android: { priority: 'HIGH', notification: { channel_id: 'messages' } },
    },
  });
});

test('an unregistered token is gone and other refusals keep FCM status and reason', async (t) => {
  let next: { status: number; json: unknown } = {
    status: 404,
    json: {
      error: {
        code: 404,
        message: 'Requested entity was not found.',
        status: 'NOT_FOUND',
        details: [
          {
            '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
            errorCode: 'UNREGISTERED',
          },
        ],
      },
    },
  };
  const google = await fakeGoogle((path) =>
    path === '/token' ? { status: 200, json: { access_token: 'a', expires_in: 3600 } } : next,
  );
  t.after(google.close);
  const sender = createFcmSender(parseServiceAccount(JSON.stringify(account(google.origin))), {
    fcmOrigin: google.origin,
  });
  const device = { token: 'device', platform: 'android' as const };
  assert.deepEqual(await sender.send(device, notification), { status: 'gone' });
  next = {
    status: 429,
    json: {
      error: { code: 429, message: 'Quota exceeded for sender.', status: 'RESOURCE_EXHAUSTED' },
    },
  };
  assert.deepEqual(await sender.send(device, notification), {
    status: 'failed',
    httpStatus: 429,
    reason:
      'FCM refused the notification: Quota exceeded for sender. (RESOURCE_EXHAUSTED, HTTP 429)',
  });
});

test('a refused token exchange keeps Google’s reason', async (t) => {
  const google = await fakeGoogle(() => ({
    status: 400,
    json: { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' },
  }));
  t.after(google.close);
  const sender = createFcmSender(parseServiceAccount(JSON.stringify(account(google.origin))), {
    fcmOrigin: google.origin,
  });
  assert.deepEqual(await sender.send({ token: 'd', platform: 'android' }, notification), {
    status: 'failed',
    httpStatus: 400,
    reason:
      'Google refused the Firebase service account: invalid_grant: Invalid JWT Signature. (HTTP 400)',
  });
});

const database = { skip: !process.env.TEST_DATABASE_URL };

async function disposable(t: TestContext) {
  const schema = `test_push_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({
    connectionString: process.env.TEST_DATABASE_URL,
    options: `-c search_path=${schema}`,
  });
  await pool.query(`
    CREATE TABLE turns (
      id uuid PRIMARY KEY, owner_id text NOT NULL, channel text NOT NULL DEFAULT 'web',
      thread_id uuid, session_id uuid, parent_turn_id uuid, source text NOT NULL DEFAULT 'user',
      source_id text, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE tasks (id uuid PRIMARY KEY, owner_id text NOT NULL, activity_key text);
    CREATE TABLE schedules (id uuid PRIMARY KEY, owner_id text NOT NULL);
    CREATE TABLE messages (
      id uuid PRIMARY KEY, owner_id text NOT NULL, role text NOT NULL, text text NOT NULL,
      thread_id uuid, turn_id uuid, attachments jsonb NOT NULL DEFAULT '[]',
      created_at timestamptz NOT NULL DEFAULT now(), hidden_at timestamptz, delivered_channel text
    );
  `);
  t.after(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  return pool;
}

function recordingSender(
  answer: (device: PushDevice) => 'sent' | 'gone' | 'failed' = () => 'sent',
) {
  const sent: { device: PushDevice; notification: PushNotification }[] = [];
  const sender: PushSender = {
    platforms: ['android'],
    async send(device, notification) {
      sent.push({ device, notification });
      const status = answer(device);
      return status === 'failed'
        ? { status, reason: 'FCM refused the notification: fixture (HTTP 500)', httpStatus: 500 }
        : { status };
    },
  };
  return { sender, sent };
}

const awake = async () => ({
  quietHoursEnabled: false,
  quietStart: '22:00',
  quietEnd: '07:00',
  timeZone: 'UTC',
});

async function routes(pool: pg.Pool, sender?: PushSender, ownerId = 'owner-a') {
  const push = createPush({
    pool,
    ownerId,
    sender,
    quietHours: awake,
    accessKey: async () => 'access-key-a',
    redact: (text) => text,
  });
  await push.initialize();
  const app = Fastify();
  push.registerRoutes(app);
  registerForkCapabilities(app, () => ({ push: push.feature() }));
  return { app, push };
}

function register(
  app: Awaited<ReturnType<typeof routes>>['app'],
  token: string,
  platform = 'android',
) {
  return app.inject({ method: 'PUT', url: '/api/fork/push/devices', payload: { token, platform } });
}

async function assistant(
  pool: pg.Pool,
  values: {
    owner?: string;
    text?: string;
    channel?: string;
    hidden?: boolean;
    delivered?: string;
    minutesAgo?: number;
    source?: string;
    after?: string;
  } = {},
) {
  const id = randomUUID();
  const turn = randomUUID();
  const owner = values.owner ?? 'owner-a';
  const thread = '00000000-0000-4000-8000-000000000001';
  const parent = values.after
    ? (await pool.query('SELECT session_id FROM turns WHERE id=$1', [values.after])).rows[0]
    : undefined;
  await pool.query(
    `INSERT INTO turns(id,owner_id,channel,thread_id,session_id,parent_turn_id,source)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      turn,
      owner,
      values.channel ?? 'web',
      thread,
      parent?.session_id ?? turn,
      values.after ?? null,
      values.source ?? 'user',
    ],
  );
  await pool.query(
    `INSERT INTO messages(id,owner_id,role,text,thread_id,turn_id,created_at,hidden_at,delivered_channel)
     VALUES($1,$2,'assistant',$3,$4,$5,clock_timestamp()-make_interval(mins => $6),$7,$8)`,
    [
      id,
      owner,
      values.text ?? 'Hello **there**',
      thread,
      values.delivered ? null : turn,
      values.minutesAgo ?? 0,
      values.hidden ? new Date() : null,
      values.delivered ?? null,
    ],
  );
  return id;
}

test('capabilities list push only when a sender exists', database, async (t) => {
  const pool = await disposable(t);
  const off = await routes(pool);
  assert.deepEqual((await off.app.inject('/api/fork/capabilities')).json(), { features: {} });
  const on = await routes(pool, recordingSender().sender);
  assert.deepEqual((await on.app.inject('/api/fork/capabilities')).json(), {
    features: { push: { version: 1, platforms: ['android'] } },
  });
  assert.equal((await register(off.app, 'abc')).statusCode, 404);
});

test('devices are owner-scoped, validated and capped at 20', database, async (t) => {
  const pool = await disposable(t);
  const { sender } = recordingSender();
  const a = await routes(pool, sender, 'owner-a');
  const b = await routes(pool, sender, 'owner-b');
  assert.equal((await register(a.app, 'token-a:1')).statusCode, 204);
  assert.equal((await register(a.app, 'bad token with spaces')).statusCode, 400);
  assert.equal((await register(a.app, 'token-x', 'ios')).statusCode, 400);
  const removedByOther = await b.app.inject({
    method: 'DELETE',
    url: '/api/fork/push/devices',
    payload: { token: 'token-a:1' },
  });
  assert.equal(removedByOther.statusCode, 204);
  assert.equal(
    (await pool.query("SELECT 1 FROM push_devices WHERE owner_id='owner-a'")).rowCount,
    1,
  );
  for (let index = 0; index < 21; index++) await register(a.app, `token-${index}`);
  const kept = await pool.query<{ token: string }>(
    "SELECT token FROM push_devices WHERE owner_id='owner-a'",
  );
  assert.equal(kept.rowCount, 20);
  assert.ok(!kept.rows.some((row) => row.token === 'token-a:1'));
  await a.app.inject({
    method: 'DELETE',
    url: '/api/fork/push/devices',
    payload: { token: 'token-20' },
  });
  assert.equal((await pool.query("SELECT 1 FROM push_devices WHERE token='token-20'")).rowCount, 0);
});

test('notification text is plain, redacted and at most 240 characters', () => {
  const redact = (text: string) => text.replaceAll('sk-secret-value', '[redacted]');
  assert.equal(
    notificationText('**Done.** See [the doc](https://x.test/a) and `code`', [], redact),
    'Done. See the doc and code',
  );
  assert.equal(notificationText('Key: sk-secret-value', [], redact), 'Key: [redacted]');
  assert.equal(notificationText('```\nconst x = 1\n```\nShort', [], redact), 'Short');
  assert.equal(notificationText('', [{ name: 'report.pdf' }], redact), 'Shared report.pdf');
  assert.equal(
    notificationText('', [{ name: 'a' }, { name: 'b' }], redact),
    'Shared 2 attachments.',
  );
  assert.equal(notificationText('', [], redact), 'You have a new message from Nod.');
  const long = notificationText('word '.repeat(100), [], redact);
  assert.equal(Array.from(long).length, 240);
  assert.ok(long.endsWith('…'));
});

test('each new web message is sent once to every device of its owner', database, async (t) => {
  const pool = await disposable(t);
  const { sender, sent } = recordingSender();
  const { app, push } = await routes(pool, sender, 'owner-a');
  await register(app, 'phone-1');
  await register(app, 'phone-2');
  const id = await assistant(pool, { text: 'Your flight is booked.' });
  await assistant(pool, { channel: 'telegram' });
  await assistant(pool, { delivered: 'whatsapp' });
  await assistant(pool, { hidden: true });
  await assistant(pool, { minutesAgo: 30 });
  await assistant(pool, { owner: 'owner-b' });
  await Promise.all([push.deliver(), push.deliver()]);
  await push.deliver();
  assert.deepEqual(
    sent
      .map((item) => [item.device.token, item.notification] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
    [
      ['phone-1', { title: 'Nod', body: 'Your flight is booked.', data: { messageId: id } }],
      ['phone-2', { title: 'Nod', body: 'Your flight is booked.', data: { messageId: id } }],
    ],
  );
  const again = await routes(pool, sender, 'owner-a');
  await again.push.deliver();
  assert.equal(sent.length, 2);
});

test('messages from before push started are never sent', database, async (t) => {
  const pool = await disposable(t);
  await assistant(pool, { minutesAgo: 1 });
  const { sender, sent } = recordingSender();
  const { app, push } = await routes(pool, sender);
  await register(app, 'phone');
  await push.deliver();
  assert.equal(sent.length, 0);
});

test('quiet hours skip messages for good and gone tokens are removed', database, async (t) => {
  const pool = await disposable(t);
  const { sender, sent } = recordingSender((device) =>
    device.token === 'old-phone' ? 'gone' : device.token === 'flaky' ? 'failed' : 'sent',
  );
  const failures: unknown[] = [];
  let quiet = true;
  const push = createPush({
    pool,
    ownerId: 'owner-a',
    sender,
    accessKey: async () => 'access-key-a',
    redact: (text) => text,
    quietHours: async () => {
      const hour = new Date().getUTCHours();
      const clock = (value: number) => `${String((value + 24) % 24).padStart(2, '0')}:00`;
      return {
        quietHoursEnabled: quiet,
        quietStart: clock(hour - 1),
        quietEnd: clock(hour + 2),
        timeZone: 'UTC',
      };
    },
    failure: (_event, _error, context) => failures.push(context),
  });
  await push.initialize();
  const app = Fastify();
  push.registerRoutes(app);
  for (const token of ['old-phone', 'flaky', 'phone']) await register(app, token);
  await assistant(pool);
  await push.deliver();
  assert.equal(sent.length, 0);
  quiet = false;
  await push.deliver();
  assert.equal(sent.length, 0);
  await assistant(pool);
  await push.deliver();
  assert.deepEqual(sent.map((item) => item.device.token).sort(), ['flaky', 'old-phone', 'phone']);
  assert.deepEqual(
    (await pool.query('SELECT token FROM push_devices ORDER BY token')).rows.map(
      (row) => row.token,
    ),
    ['flaky', 'phone'],
  );
  assert.deepEqual(failures, [
    { reason: 'FCM refused the notification: fixture (HTTP 500)', httpStatus: 500 },
  ]);
});

test("during quiet hours only results of the owner's schedules are sent", database, async (t) => {
  const pool = await disposable(t);
  const { sender, sent } = recordingSender();
  const push = createPush({
    pool,
    ownerId: 'owner-a',
    sender,
    accessKey: async () => 'access-key-a',
    redact: (text) => text,
    quietHours: async () => {
      const hour = new Date().getUTCHours();
      const clock = (value: number) => `${String((value + 24) % 24).padStart(2, '0')}:00`;
      return {
        quietHoursEnabled: true,
        quietStart: clock(hour - 1),
        quietEnd: clock(hour + 2),
        timeZone: 'UTC',
      };
    },
  });
  await push.initialize();
  const app = Fastify();
  push.registerRoutes(app);
  await register(app, 'phone');
  await assistant(pool, { text: 'Reply to the owner' });
  await assistant(pool, { text: 'Nod on its own', source: 'event' });
  const fired = await assistant(pool, { text: 'Morning check-in', source: 'schedule' });
  const scheduleTurn = (await pool.query('SELECT turn_id FROM messages WHERE id=$1', [fired]))
    .rows[0].turn_id;
  await assistant(pool, { text: 'Check-in follow-up', source: 'resume', after: scheduleTurn });
  await push.deliver();
  assert.deepEqual(
    sent.map((item) => item.notification.body),
    ['Morning check-in', 'Check-in follow-up'],
  );
  await push.deliver();
  assert.equal(sent.length, 2);
});

test('a new access key stops pushes to phones registered with the old one', database, async (t) => {
  const pool = await disposable(t);
  const { sender, sent } = recordingSender();
  let key = 'access-key-a';
  const push = createPush({
    pool,
    ownerId: 'owner-a',
    sender,
    quietHours: awake,
    accessKey: async () => key,
    redact: (text) => text,
  });
  await push.initialize();
  const app = Fastify();
  push.registerRoutes(app);
  await register(app, 'lost-phone');
  key = 'access-key-b';
  await register(app, 'new-phone');
  await assistant(pool, { text: 'Your code is 123456' });
  await push.deliver();
  assert.deepEqual(
    sent.map((item) => item.device.token),
    ['new-phone'],
  );
  assert.deepEqual(
    (await pool.query('SELECT token FROM push_devices')).rows.map((row) => row.token),
    ['new-phone'],
  );
});
