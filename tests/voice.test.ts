import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import test, { type TestContext } from 'node:test';
import Fastify from 'fastify';
import pg from 'pg';
import type { MemoryCurator } from '../src/ports/memory-curator.ts';
import type { VoiceAgents, VoiceEngineSettings, VoiceTalker } from '../src/ports/voice.ts';
import { createElevenLabsVoiceAgents } from '../src/providers/elevenlabs/voice-agents.ts';
import { registerForkCapabilities } from '../src/server/fork-capabilities.ts';
import { spendingLimitReached } from '../src/server/ledger.ts';
import { createVoice, voiceEnginePath } from '../src/server/voice.ts';
import { voiceRelayCue } from '../src/shared/voice.ts';

const database = { skip: !process.env.TEST_DATABASE_URL };

async function body(request: IncomingMessage) {
  let text = '';
  for await (const chunk of request) text += chunk;
  return text;
}

test('the ElevenLabs client creates a private, unrecorded Speech Engine and asks for a token', async (t) => {
  const calls: { method: string; url: string; key?: string; payload: string }[] = [];
  const server = createServer(async (request, response) => {
    const payload = await body(request);
    calls.push({
      method: request.method!,
      url: request.url!,
      key: request.headers['xi-api-key'] as string,
      payload,
    });
    response.writeHead(request.url!.startsWith('/v1/convai') ? 200 : 201, {
      'Content-Type': 'application/json',
    });
    response.end(
      JSON.stringify(
        request.url!.startsWith('/v1/convai')
          ? { token: 'conversation-token' }
          : { speech_engine_id: 'seng_fixture' },
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const agents = createElevenLabsVoiceAgents('fixture-key', {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  });
  const settings: VoiceEngineSettings = {
    name: 'Nod',
    wsUrl: 'wss://nod.example.test/fork/voice/engine',
    secretHeader: 'x-nod-voice-secret',
    secret: 'engine-secret',
    voiceId: 'voice-it',
    language: 'it',
    ttsModel: 'eleven_v4_turbo',
  };
  assert.equal(await agents.createEngine(settings), 'seng_fixture');
  await agents.updateEngine('seng_fixture', settings);
  assert.equal(await agents.conversationToken('seng_fixture'), 'conversation-token');
  assert.deepEqual(
    calls.map((call) => [call.method, call.url, call.key]),
    [
      ['POST', '/v1/speech-engine', 'fixture-key'],
      ['PATCH', '/v1/speech-engine/seng_fixture', 'fixture-key'],
      ['GET', '/v1/convai/conversation/token?agent_id=seng_fixture', 'fixture-key'],
    ],
  );
  assert.deepEqual(JSON.parse(calls[0]!.payload), {
    name: 'Nod',
    speech_engine: {
      ws_url: 'wss://nod.example.test/fork/voice/engine',
      request_headers: { 'x-nod-voice-secret': 'engine-secret' },
    },
    tts: { model_id: 'eleven_v4_turbo', voice_id: 'voice-it' },
    language: 'it',
    auth: { enable_auth: true },
    privacy: { record_voice: false },
  });
});

test('an ElevenLabs refusal keeps its own reason and status', async (t) => {
  const server = createServer((_request, response) => {
    response.writeHead(401, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ detail: { message: 'Missing permission convai_write.' } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const agents = createElevenLabsVoiceAgents('fixture-key', {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  });
  await assert.rejects(
    agents.conversationToken('seng_x'),
    /ElevenLabs refused GET \/v1\/convai\/conversation\/token\?agent_id=seng_x: Missing permission convai_write\. \(HTTP 401\)/,
  );
});

async function disposable(t: TestContext) {
  const schema = `test_voice_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({
    connectionString: process.env.TEST_DATABASE_URL,
    options: `-c search_path=${schema}`,
  });
  await pool.query(`
    CREATE TABLE threads (id uuid PRIMARY KEY, owner_id text NOT NULL, archived_at timestamptz);
    CREATE TABLE turns (id uuid PRIMARY KEY, owner_id text NOT NULL, message_id uuid, withdrawn boolean NOT NULL DEFAULT false, status text NOT NULL DEFAULT 'running', error text);
    CREATE TABLE messages (
      id uuid PRIMARY KEY, owner_id text NOT NULL, role text NOT NULL, text text NOT NULL,
      display_text text, thread_id uuid, turn_id uuid,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(), hidden_at timestamptz,
      answer_choices jsonb
    );
  `);
  t.after(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  return pool;
}

function fakeAgents() {
  const created: VoiceEngineSettings[] = [];
  const updated: string[] = [];
  const agents: VoiceAgents = {
    async createEngine(settings) {
      created.push(settings);
      return 'seng_fake';
    },
    async updateEngine(id) {
      updated.push(id);
    },
    async conversationToken(id) {
      return `token-for-${id}`;
    },
  };
  return { agents, created, updated };
}

type Recorded = { instructions: string; turns: { role: string; content: string }[] };

function scriptedTalker(
  script: (call: Recorded, signal?: AbortSignal) => AsyncIterable<string>,
  asks: (call: Recorded & { canAskNod?: boolean }) => boolean = () => false,
  ends: (call: Recorded) => boolean = () => false,
) {
  const calls: Recorded[] = [];
  const reports: unknown[] = [];
  const talker: VoiceTalker = {
    async talk(input, { signal, onText, report }) {
      calls.push(input);
      let all = '';
      for await (const text of script(input, signal)) {
        signal?.throwIfAborted();
        all += text;
        onText(text);
      }
      report?.({
        id: randomUUID(),
        model: 'fake-model',
        costUsd: 0.001,
        category: 'agent',
        operation: 'voice',
      });
      return {
        spoken: all,
        askNod: Boolean(input.canAskNod) && asks(input),
        endCall: Boolean(input.canAskNod) && ends(input),
      };
    },
  };
  return { talker, calls, reports };
}

async function voiceApp(
  pool: pg.Pool,
  options: {
    agents?: VoiceAgents;
    talker?: VoiceTalker;
    limit?: boolean;
    recorded?: unknown[];
    models?: string[];
    submitted?: string[];
    turnIds?: string[];
  } = {},
) {
  const voice = createVoice({
    pool,
    ownerId: 'owner-a',
    publicOrigin: 'https://nod.example.test',
    agents: options.agents,
    talker: (model) => {
      options.models?.push(model?.modelId ?? 'default');
      return options.talker ?? scriptedTalker(async function* () {}).talker;
    },
    meter: (base: MemoryCurator): MemoryCurator => ({
      ...base,
      async curate(request, signal, report) {
        if (options.limit) throw new Error(spendingLimitReached);
        return base.curate(request, signal, (usage) => {
          options.recorded?.push(usage);
          report?.(usage);
        });
      },
    }),
    checkModel: async (model) => {
      if (model.modelId !== 'claude-sonnet-5-5')
        throw new Error('The selected model is unavailable.');
    },
    modelsReady: () => true,
    preferences: async () => ({ timeZone: 'Europe/Rome' }),
    redact: (text) => text.replaceAll('sk-secret', '[redacted]'),
    voice: { voiceId: 'voice-it', language: 'it', ttsModel: 'eleven_v4_turbo' },
    submit: async (text) => {
      options.submitted?.push(text);
      const turnId = randomUUID();
      options.turnIds?.push(turnId);
      return { turnId, messageId: randomUUID() };
    },
  });
  await voice.initialize();
  const app = Fastify();
  voice.registerRoutes(app);
  registerForkCapabilities(app, () => ({ voice: voice.feature() }));
  await app.ready();
  const secret = (
    await pool.query<{ secret: string }>("SELECT secret FROM voice_state WHERE owner_id='owner-a'")
  ).rows[0]!.secret;
  return { app, voice, secret };
}

async function engineSocket(app: Awaited<ReturnType<typeof voiceApp>>['app'], secret?: string) {
  const socket = await app.injectWS(voiceEnginePath, {
    headers: secret ? { 'x-nod-voice-secret': secret } : {},
  });
  const received: { type: string; content?: string; event_id?: number; is_final?: boolean }[] = [];
  const closed = new Promise<number>((resolve) =>
    socket.on('close', (code: number) => resolve(code)),
  );
  socket.on('message', (data: Buffer) => received.push(JSON.parse(data.toString())));
  return { socket, received, closed };
}

async function until(check: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) assert.fail('The voice engine did not reach the expected state.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('capabilities list voice only with ElevenLabs configured', database, async (t) => {
  const pool = await disposable(t);
  const off = await voiceApp(pool);
  assert.deepEqual((await off.app.inject('/api/fork/capabilities')).json(), { features: {} });
  assert.equal(
    (await off.app.inject({ method: 'POST', url: '/api/fork/voice/session' })).statusCode,
    404,
  );
  const on = await voiceApp(pool, { agents: fakeAgents().agents });
  assert.deepEqual((await on.app.inject('/api/fork/capabilities')).json(), {
    features: { voice: { version: 1 } },
  });
});

test(
  'a session creates the engine once, with the secret, and returns a token',
  database,
  async (t) => {
    const pool = await disposable(t);
    const fake = fakeAgents();
    const { app, secret } = await voiceApp(pool, { agents: fake.agents });
    const first = await app.inject({ method: 'POST', url: '/api/fork/voice/session' });
    const second = await app.inject({ method: 'POST', url: '/api/fork/voice/session' });
    assert.deepEqual(first.json(), { conversationToken: 'token-for-seng_fake' });
    assert.deepEqual(second.json(), { conversationToken: 'token-for-seng_fake' });
    assert.equal(fake.created.length, 1);
    assert.deepEqual(fake.updated, []);
    assert.equal(fake.created[0]!.wsUrl, 'wss://nod.example.test/fork/voice/engine');
    assert.equal(fake.created[0]!.secret, secret);
    assert.ok(secret.length >= 40);
  },
);

test('the voice model choice is validated and saved', database, async (t) => {
  const pool = await disposable(t);
  const { app } = await voiceApp(pool, { agents: fakeAgents().agents });
  assert.deepEqual((await app.inject('/api/fork/voice/settings')).json(), { model: null });
  const sonnet = { connectionId: randomUUID(), modelId: 'claude-sonnet-5-5', effort: 'low' };
  const saved = await app.inject({
    method: 'PUT',
    url: '/api/fork/voice/settings',
    payload: { model: sonnet },
  });
  assert.deepEqual(saved.json(), { model: sonnet });
  const refused = await app.inject({
    method: 'PUT',
    url: '/api/fork/voice/settings',
    payload: { model: { ...sonnet, modelId: 'gone-model' } },
  });
  assert.equal(refused.statusCode, 400);
  assert.match(
    refused.json().error,
    /can't be used for calls: The selected model is unavailable\./,
  );
  assert.deepEqual((await app.inject('/api/fork/voice/settings')).json(), { model: sonnet });
  const cleared = await app.inject({
    method: 'PUT',
    url: '/api/fork/voice/settings',
    payload: { model: null },
  });
  assert.deepEqual(cleared.json(), { model: null });
});

test('the engine refuses a connection without the right secret', database, async (t) => {
  const pool = await disposable(t);
  const { app } = await voiceApp(pool, { agents: fakeAgents().agents });
  assert.equal(await (await engineSocket(app)).closed, 1008);
  assert.equal(await (await engineSocket(app, 'wrong-secret-value')).closed, 1008);
});

test(
  'a transcript streams chunks, ends final, and uses the chosen model and recent chat',
  database,
  async (t) => {
    const pool = await disposable(t);
    const thread = randomUUID();
    await pool.query("INSERT INTO threads(id,owner_id) VALUES($1,'owner-a')", [thread]);
    const kept = randomUUID();
    const withdrawn = randomUUID();
    await pool.query(
      `INSERT INTO messages(id,owner_id,role,text,thread_id) VALUES
     ($1,'owner-a','user','Remind me about the dentist sk-secret',$3),
     ($2,'owner-a','user','A message I withdrew',$3)`,
      [kept, withdrawn, thread],
    );
    await pool.query(
      "INSERT INTO turns(id,owner_id,message_id,withdrawn) VALUES($1,'owner-a',$2,true)",
      [randomUUID(), withdrawn],
    );
    const { talker, calls } = scriptedTalker(async function* () {
      yield 'Ciao, ';
      yield 'come stai?';
    });
    const recorded: unknown[] = [];
    const models: string[] = [];
    const { app, secret } = await voiceApp(pool, {
      agents: fakeAgents().agents,
      talker,
      recorded,
      models,
    });
    await app.inject({
      method: 'PUT',
      url: '/api/fork/voice/settings',
      payload: {
        model: { connectionId: randomUUID(), modelId: 'claude-sonnet-5-5', effort: 'low' },
      },
    });
    const { socket, received } = await engineSocket(app, secret);
    socket.send(JSON.stringify({ type: 'init', conversation_id: 'conv-1' }));
    socket.send(JSON.stringify({ type: 'ping' }));
    socket.send(
      JSON.stringify({
        type: 'user_transcript',
        user_transcript: [{ role: 'user', content: 'Ciao Nod' }],
        event_id: 3,
      }),
    );
    await until(() => received.some((message) => message.is_final));
    assert.deepEqual(received, [
      { type: 'pong' },
      { type: 'agent_response', content: 'Ciao, ', event_id: 3, is_final: false },
      { type: 'agent_response', content: 'come stai?', event_id: 3, is_final: false },
      { type: 'agent_response', content: '', event_id: 3, is_final: true },
    ]);
    assert.deepEqual(models, ['claude-sonnet-5-5']);
    assert.deepEqual(calls[0]!.turns, [{ role: 'user', content: 'Ciao Nod' }]);
    assert.match(calls[0]!.instructions, /Owner: Remind me about the dentist \[redacted\]/);
    assert.doesNotMatch(calls[0]!.instructions, /withdrew/);
    assert.equal(recorded.length, 1);
    socket.terminate();
  },
);

test('a newer transcript cancels the older reply', database, async (t) => {
  const pool = await disposable(t);
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const { talker } = scriptedTalker(async function* (call, signal) {
    if (call.turns.at(-1)!.content === 'first') {
      yield 'Starting a long ';
      await held;
      signal?.throwIfAborted();
      yield 'answer that must never arrive';
    } else yield 'Second answer.';
  });
  const { app, secret } = await voiceApp(pool, { agents: fakeAgents().agents, talker });
  const { socket, received } = await engineSocket(app, secret);
  socket.send(
    JSON.stringify({
      type: 'user_transcript',
      user_transcript: [{ role: 'user', content: 'first' }],
      event_id: 1,
    }),
  );
  await until(() => received.length === 1);
  socket.send(
    JSON.stringify({
      type: 'user_transcript',
      user_transcript: [
        { role: 'user', content: 'first' },
        { role: 'agent', content: 'Starting a long' },
        { role: 'user', content: 'second' },
      ],
      event_id: 2,
    }),
  );
  await until(() => received.some((message) => message.is_final));
  release();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(received, [
    { type: 'agent_response', content: 'Starting a long ', event_id: 1, is_final: false },
    { type: 'agent_response', content: 'Second answer.', event_id: 2, is_final: false },
    { type: 'agent_response', content: '', event_id: 2, is_final: true },
  ]);
  socket.terminate();
});

test('the monthly limit stops the reply with a spoken notice', database, async (t) => {
  const pool = await disposable(t);
  const { talker, calls } = scriptedTalker(async function* () {
    yield 'never';
  });
  const { app, secret } = await voiceApp(pool, {
    agents: fakeAgents().agents,
    talker,
    limit: true,
  });
  const { socket, received } = await engineSocket(app, secret);
  socket.send(
    JSON.stringify({
      type: 'user_transcript',
      user_transcript: [{ role: 'user', content: 'Ciao' }],
      event_id: 7,
    }),
  );
  await until(() => received.some((message) => message.is_final));
  assert.equal(calls.length, 0);
  assert.deepEqual(received, [
    {
      type: 'agent_response',
      content: 'Hai raggiunto il limite di spesa del mese, quindi devo fermarmi qui.',
      event_id: 7,
      is_final: false,
    },
    { type: 'agent_response', content: '', event_id: 7, is_final: true },
  ]);
  socket.terminate();
});

test(
  'a request for real work goes to Nod with the owner’s own words, and Nod’s answer is spoken',
  database,
  async (t) => {
    const pool = await disposable(t);
    const submitted: string[] = [];
    const turnIds: string[] = [];
    const { talker, calls } = scriptedTalker(
      async function* (call) {
        if (call.instructions.includes('The result:')) yield 'Domani a Milano 14 gradi e sole.';
        else if (call.turns.at(-1)!.content.includes('meteo')) yield 'Ok, chiedo a Nod. ';
        else yield 'Certo.';
      },
      (call) => call.turns.at(-1)!.content.includes('meteo'),
    );
    const { app, secret } = await voiceApp(pool, {
      agents: fakeAgents().agents,
      talker,
      submitted,
      turnIds,
    });
    const { socket, received } = await engineSocket(app, secret);
    const say = (event_id: number, ...owner: string[]) =>
      socket.send(
        JSON.stringify({
          type: 'user_transcript',
          user_transcript: owner.flatMap((content, index) => [
            { role: 'user', content },
            ...(index < owner.length - 1 ? [{ role: 'agent', content: 'Certo.' }] : []),
          ]),
          event_id,
        }),
      );
    say(1, 'Ciao');
    await until(() => received.filter((m) => m.is_final).length === 1);
    say(2, 'Ciao', 'Che meteo fa domani a Milano?');
    await until(() => submitted.length === 1);
    assert.deepEqual(submitted, ['Ciao\nChe meteo fa domani a Milano?']);
    await until(() => received.filter((m) => m.is_final).length === 2);
    assert.equal(calls.length, 2);
    const turnId = turnIds[0]!;
    await pool.query("INSERT INTO turns(id,owner_id,status) VALUES($1,'owner-a','succeeded')", [
      turnId,
    ]);
    await pool.query(
      "INSERT INTO messages(id,owner_id,role,text,turn_id) VALUES($1,'owner-a','assistant','**Milano**, domani: 14°C, sereno.',$2)",
      [randomUUID(), turnId],
    );
    say(5, 'Ciao', 'Che meteo fa domani a Milano?', voiceRelayCue);
    await until(() => received.filter((m) => m.is_final).length === 3);
    const relay = calls.at(-1)!;
    assert.match(relay.instructions, /The result:\n\*\*Milano\*\*, domani: 14°C, sereno\./);
    assert.deepEqual(received.slice(-2), [
      {
        type: 'agent_response',
        content: 'Domani a Milano 14 gradi e sole.',
        event_id: 5,
        is_final: false,
      },
      { type: 'agent_response', content: '', event_id: 5, is_final: true },
    ]);
    assert.ok(!relay.turns.some((turn) => turn.content === voiceRelayCue));
    say(6, 'Ciao', 'Che meteo fa domani a Milano?', voiceRelayCue, 'E a Roma, che meteo?');
    await until(() => submitted.length === 2);
    assert.equal(submitted[1], 'E a Roma, che meteo?');
    say(7, 'Ciao', voiceRelayCue);
    await until(() => received.filter((m) => m.is_final).length === 5);
    assert.deepEqual(received.at(-1), {
      type: 'agent_response',
      content: '',
      event_id: 7,
      is_final: true,
    });
    assert.equal(calls.filter((call) => call.instructions.includes('The result:')).length, 1);
    socket.terminate();
  },
);

test('a failed hand-off is said aloud and a failed Nod turn is reported', database, async (t) => {
  const pool = await disposable(t);
  const { talker } = scriptedTalker(
    async function* (call) {
      if (call.instructions.includes('The result:')) yield 'Nod non ce l’ha fatta.';
    },
    () => true,
  );
  const turnIds: string[] = [];
  const { app, secret } = await voiceApp(pool, { agents: fakeAgents().agents, talker, turnIds });
  const { socket, received } = await engineSocket(app, secret);
  socket.send(
    JSON.stringify({
      type: 'user_transcript',
      user_transcript: [{ role: 'user', content: 'Prenota il ristorante' }],
      event_id: 4,
    }),
  );
  await until(() => received.some((m) => m.is_final));
  assert.equal(received[0]!.content, 'Ok, controllo. Un attimo.');
  await pool.query(
    "INSERT INTO turns(id,owner_id,status,error) VALUES($1,'owner-a','failed','The restaurant site did not answer.')",
    [turnIds[0]],
  );
  socket.send(
    JSON.stringify({
      type: 'user_transcript',
      user_transcript: [
        { role: 'user', content: 'Prenota il ristorante' },
        { role: 'agent', content: 'Ok, lo chiedo a Nod.' },
        { role: 'user', content: voiceRelayCue },
      ],
      event_id: 5,
    }),
  );
  await until(() => received.filter((m) => m.is_final).length === 2);
  assert.equal(received.at(-2)!.content, 'Nod non ce l’ha fatta.');
  socket.terminate();
});

test('silence after a hand-off stays silent and is never sent to Nod', database, async (t) => {
  const pool = await disposable(t);
  const submitted: string[] = [];
  const { talker, calls } = scriptedTalker(
    async function* () {
      yield 'Ok, controllo. ';
    },
    () => true,
  );
  const { app, secret } = await voiceApp(pool, { agents: fakeAgents().agents, talker, submitted });
  const { socket, received } = await engineSocket(app, secret);
  const history = [
    { role: 'user', content: 'Guardami su Slack se ci sono messaggi' },
    { role: 'agent', content: 'Ok, controllo.' },
  ];
  socket.send(
    JSON.stringify({ type: 'user_transcript', user_transcript: history.slice(0, 1), event_id: 1 }),
  );
  await until(() => submitted.length === 1 && received.some((m) => m.is_final));
  for (const [index, silence] of ['...', ' … ', ''].entries())
    socket.send(
      JSON.stringify({
        type: 'user_transcript',
        user_transcript: [...history, { role: 'user', content: silence }],
        event_id: index + 2,
      }),
    );
  await until(() => received.filter((m) => m.is_final).length === 4);
  assert.deepEqual(received.slice(-3), [
    { type: 'agent_response', content: '', event_id: 2, is_final: true },
    { type: 'agent_response', content: '', event_id: 3, is_final: true },
    { type: 'agent_response', content: '', event_id: 4, is_final: true },
  ]);
  assert.equal(calls.length, 1);
  assert.deepEqual(submitted, ['Guardami su Slack se ci sono messaggi']);
  socket.send(
    JSON.stringify({
      type: 'user_transcript',
      user_transcript: [
        ...history,
        { role: 'user', content: '...' },
        { role: 'agent', content: '' },
        { role: 'user', content: 'Grazie' },
      ],
      event_id: 5,
    }),
  );
  await until(() => calls.length === 2);
  await until(() => received.filter((m) => m.is_final).length === 5);
  assert.ok(!calls[1]!.turns.some((turn) => turn.content === '...'));
  assert.deepEqual(submitted, ['Guardami su Slack se ci sono messaggi', 'Grazie']);
  socket.terminate();
});

test(
  'saying it will check without the tool still hands the request to Nod',
  database,
  async (t) => {
    const pool = await disposable(t);
    const submitted: string[] = [];
    const { talker } = scriptedTalker(async function* (call) {
      yield call.turns.at(-1)!.content.includes('Slack')
        ? 'Ok, controllo subito i messaggi Slack.'
        : 'Bene, grazie!';
    });
    const { app, secret } = await voiceApp(pool, {
      agents: fakeAgents().agents,
      talker,
      submitted,
    });
    const { socket, received } = await engineSocket(app, secret);
    const turns = [
      { role: 'user', content: 'Ciao, come stai?' },
      { role: 'agent', content: 'Bene, grazie!' },
      { role: 'user', content: 'Mi controlli i messaggi Slack delle ultime due ore?' },
    ];
    socket.send(
      JSON.stringify({ type: 'user_transcript', user_transcript: turns.slice(0, 1), event_id: 1 }),
    );
    await until(() => received.filter((m) => m.is_final).length === 1);
    assert.deepEqual(submitted, []);
    socket.send(JSON.stringify({ type: 'user_transcript', user_transcript: turns, event_id: 2 }));
    await until(() => submitted.length === 1);
    assert.deepEqual(submitted, [
      'Ciao, come stai?\nMi controlli i messaggi Slack delle ultime due ore?',
    ]);
    socket.terminate();
  },
);

test('a question from Nod reaches the call with its options', database, async (t) => {
  const pool = await disposable(t);
  const turnIds: string[] = [];
  const { talker, calls } = scriptedTalker(
    async function* (call) {
      if (call.instructions.includes('The result:')) yield 'Cosa cerco?';
    },
    () => true,
  );
  const { app, secret } = await voiceApp(pool, { agents: fakeAgents().agents, talker, turnIds });
  const { socket, received } = await engineSocket(app, secret);
  socket.send(
    JSON.stringify({
      type: 'user_transcript',
      user_transcript: [{ role: 'user', content: 'Riprova a cercare' }],
      event_id: 1,
    }),
  );
  await until(() => turnIds.length === 1 && received.some((m) => m.is_final));
  await pool.query("INSERT INTO turns(id,owner_id,status) VALUES($1,'owner-a','waiting')", [
    turnIds[0],
  ]);
  await pool.query(
    `INSERT INTO messages(id,owner_id,role,text,turn_id,answer_choices) VALUES($1,'owner-a','assistant','Cosa riprovo a cercare?',$2,$3)`,
    [
      randomUUID(),
      turnIds[0],
      JSON.stringify({
        options: [
          { id: randomUUID(), label: 'Slack recenti' },
          { id: randomUUID(), label: 'Mail Remote' },
        ],
        multiple: false,
      }),
    ],
  );
  socket.send(
    JSON.stringify({
      type: 'user_transcript',
      user_transcript: [
        { role: 'user', content: 'Riprova a cercare' },
        { role: 'user', content: voiceRelayCue },
      ],
      event_id: 2,
    }),
  );
  await until(() => received.filter((m) => m.is_final).length === 2);
  assert.match(
    calls.at(-1)!.instructions,
    /Cosa riprovo a cercare\?\nThe owner can choose: Slack recenti; Mail Remote\./,
  );
  socket.terminate();
});

test('asking to hang up says goodbye and closes the call', database, async (t) => {
  const pool = await disposable(t);
  const submitted: string[] = [];
  const { talker } = scriptedTalker(
    async function* () {},
    () => false,
    (call) => call.turns.at(-1)!.content.includes('chiudi'),
  );
  const { app, secret } = await voiceApp(pool, { agents: fakeAgents().agents, talker, submitted });
  const { socket, received, closed } = await engineSocket(app, secret);
  socket.send(
    JSON.stringify({
      type: 'user_transcript',
      user_transcript: [{ role: 'user', content: 'Ok, chiudi la chiamata' }],
      event_id: 9,
    }),
  );
  await until(() => received.some((m) => m.is_final));
  assert.deepEqual(received, [
    { type: 'agent_response', content: 'Va bene, a presto!', event_id: 9, is_final: false },
    { type: 'agent_response', content: '', event_id: 9, is_final: true },
  ]);
  assert.equal(await closed, 1000);
  assert.deepEqual(submitted, []);
});
