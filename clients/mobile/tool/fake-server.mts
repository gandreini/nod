import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { registerLocalAccess } from '../../../src/server/access.ts';
import { browserHandoffInputs } from '../../../src/shared/browser-handoff.ts';
import { fileBytes } from '../../../src/shared/files.ts';
import {
  answerReply,
  browserPage,
  demoConversation,
  demoSections,
  returnReply,
  scriptReply,
  type DemoReply,
  type DemoState,
} from './demo.mts';

interface FixtureMessage {
  id: string;
  clientMessageId?: string;
  role: 'user' | 'assistant';
  text: string;
  turnId: string;
  createdAt: string;
  replyToMessageId?: string;
  answerChoices?: { multiple: boolean; options: { id: string; label: string }[] };
  answerChoicesPending?: boolean;
  attachments?: FixtureArtifact[];
  streamId?: string;
}

interface FixtureArtifact {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
}

type AudioFault = 'drop-response' | 'abort-after-claim' | 'cancel' | 'busy';

interface FixtureStore {
  messages: FixtureMessage[];
  artifacts?: FixtureArtifact[];
  files?: Record<string, string>;
  audioClaims?: Record<string, { fingerprint: string; response?: object }>;
  audioFaults?: AudioFault[];
  turn: 'idle' | 'running' | 'waiting' | 'cancelled';
  parity?: {
    question: 'pending' | 'answered';
    dispatches: number;
    refusals: number;
  };
  handoff?: { messageId: string; open: boolean; turnId?: string };
  browser?: Record<string, number>;
  demo?: DemoState;
}

const port = Number(process.env.NOD_VALIDATION_PORT);
const token = process.env.NOD_VALIDATION_TOKEN ?? '';
const controlToken = process.env.NOD_VALIDATION_CONTROL_TOKEN ?? '';
const dataPath = process.env.NOD_VALIDATION_DATA ?? '';
const demo = process.env.NOD_DEMO === '1';
const host = process.env.NOD_VALIDATION_HOST ?? '127.0.0.1';
const origin = process.env.NOD_VALIDATION_ORIGIN ?? `http://127.0.0.1:${port}`;
const threadId = '00000000-0000-4000-8000-000000000001';
const questionId = '00000000-0000-4000-8000-000000000101';
const choiceId = '00000000-0000-4000-8000-000000000102';
const taskId = '00000000-0000-4000-8000-000000000104';
const handoffTurnId = '00000000-0000-4000-8000-000000000105';
const jpegHeader =
  '/9j/4AAQSkZJRgABAQAASABIAAD/wAARCABkAKADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9sAQwAJCQkJCQkQCQkQFhAQEBYeFhYWFh4mHh4eHh4mLiYmJiYmJi4uLi4uLi4uNzc3Nzc3QEBAQEBISEhISEhISEhI/9sAQwELDAwSERIfEREfSzMqM0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tL/90ABAAK';
const jpegScans = [
  '/9oADAMBAAIRAxEAPwDpKKKK90+RCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP//Q6SiiivdPkQooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//0ekooor3T5EKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA//9LpKKKK90+RCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP//T6SiiivdPkQooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//1Okooor3T5EKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA//9XpKKKK90+RCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP//Z',
  '/9oADAMBAAIRAxEAPwDoaKKK+cPpwooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//Q6GiiivnD6cKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA//0ehooor5w+nCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/9LoaKKK+cPpwooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//T6GiiivnD6cKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA//1Ohooor5w+nCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/9XoaKKK+cPpwooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//Z',
];
const jpegFrames = jpegScans.map((scan) =>
  Buffer.concat([Buffer.from(jpegHeader, 'base64'), Buffer.from(scan, 'base64')]),
);
const handoffClosed = 'The browser opens here when Nod hands it to you.';
const initialStore: FixtureStore = {
  turn: 'idle',
  messages: [
    {
      id: '00000000-0000-4000-8000-000000000002',
      role: 'assistant',
      text: 'Synthetic history ready',
      turnId: '00000000-0000-4000-8000-000000000003',
      createdAt: '2026-11-06T12:00:00.000Z',
    },
  ],
};

if (
  !Number.isInteger(port) ||
  port < 1 ||
  port > 65535 ||
  !token ||
  (!controlToken && !demo) ||
  !dataPath
)
  throw new Error('Invalid validation fixture configuration.');
if (demo && !/^[A-Za-z0-9_-]{43,}$/.test(token))
  throw new Error(
    'NOD_VALIDATION_TOKEN must be at least 43 letters, digits, - or _ in demo mode, as the app requires.',
  );

const saved = await readFile(dataPath, 'utf8').catch(() => undefined);
const store = (
  saved ? JSON.parse(saved) : demo ? { turn: 'idle', messages: [] } : initialStore
) as FixtureStore;
const trim = () => {
  store.messages = store.messages.slice(-200);
  const used = new Set(
    store.messages.flatMap((message) => (message.attachments ?? []).map((item) => item.id)),
  );
  const loose = (store.artifacts ?? []).filter((item) => !used.has(item.id)).slice(-10);
  const keep = new Set([...used, ...loose.map((item) => item.id)]);
  store.artifacts = store.artifacts?.filter((item) => keep.has(item.id));
  store.files = Object.fromEntries(
    Object.entries(store.files ?? {}).filter(([id]) => keep.has(id)),
  );
  store.audioClaims = Object.fromEntries(Object.entries(store.audioClaims ?? {}).slice(-200));
};
let persistence = Promise.resolve();
const persist = () => {
  if (demo) trim();
  const snapshot = JSON.stringify(store);
  persistence = persistence.then(() => writeFile(dataPath, snapshot));
  return persistence;
};
const app = Fastify({ logger: false, trustProxy: false, forceCloseConnections: true });
const streams = new Set<ServerResponse>();
const views = new Set<ServerResponse>();
const frame = (payload: object) => `data: ${JSON.stringify(payload)}\n\n`;
const emit = (payload: object) => {
  const event = frame(payload);
  for (const stream of streams) if (!stream.destroyed) stream.write(event);
};
const emitRefresh = () => emit({ type: 'refresh' });
const controlled = (headers: Record<string, unknown>) =>
  controlToken !== '' && headers['x-fixture-control'] === controlToken;
const stamp = () =>
  demo
    ? new Date().toISOString()
    : new Date(Date.UTC(2026, 10, 6, 12, 0, store.messages.length)).toISOString();
const choices = (options: string[], pending: boolean) => ({
  answerChoices: {
    multiple: false,
    options: options.map((label) => ({ id: randomUUID(), label })),
  },
  answerChoicesPending: pending,
});
let activity: object[] = [];
let pending: { timers: NodeJS.Timeout[]; turnId: string; streamId: string } | null = null;
const view = () => ({
  threadId,
  revision: `${store.messages.length}:${store.turn}:${JSON.stringify(store.parity)}`,
  pendingAnswerChoiceMessageIds: store.messages
    .filter((message) => message.answerChoicesPending)
    .map((message) => message.id),
  configuration: { conversationResetEnabled: false },
  messages: store.messages,
  turns: [
    {
      id: '00000000-0000-4000-8000-000000000004',
      status: store.turn,
      createdAt: '2026-11-06T12:00:00.000Z',
    },
    ...(store.handoff
      ? [
          {
            id: store.handoff.turnId ?? handoffTurnId,
            status: store.handoff.open ? 'waiting' : 'completed',
            source: 'user',
            handoffMessageId: store.handoff.open ? store.handoff.messageId : null,
            createdAt: '2026-11-06T12:03:00.000Z',
          },
        ]
      : []),
  ],
  turn: store.turn,
  ...(demo ? { activity } : {}),
});

const cancelReply = () => {
  if (!pending) return;
  pending.timers.forEach(clearTimeout);
  const { turnId, streamId } = pending;
  emit({ type: 'delta', threadId, turnId, streamId, text: '', done: true });
  pending = null;
  activity = [];
  emit({ type: 'activity', items: activity });
};
const respond = (next: DemoReply, turnId: string, advance: boolean) => {
  cancelReply();
  const streamId = randomUUID();
  const since = new Date().toISOString();
  const timers: NodeJS.Timeout[] = [];
  pending = { timers, turnId, streamId };
  activity = [
    {
      turnId,
      taskId: null,
      title: null,
      step: next.step,
      site: next.site ?? null,
      since,
      doing: next.site ? 'tool' : 'model',
      quietSince: since,
    },
  ];
  emit({ type: 'activity', items: activity });
  const words = next.text.split(/(?<=\s)/);
  const size = Math.ceil(words.length / 8);
  for (let index = 0; index * size < words.length; index++)
    timers.push(
      setTimeout(
        () =>
          emit({
            type: 'delta',
            threadId,
            turnId,
            streamId,
            text: words.slice(index * size, (index + 1) * size).join(''),
            done: false,
          }),
        1500 + index * 120,
      ),
    );
  timers.push(
    setTimeout(async () => {
      pending = null;
      activity = [];
      const message: FixtureMessage = {
        id: randomUUID(),
        role: 'assistant',
        text: next.text,
        turnId,
        streamId,
        createdAt: stamp(),
        ...(next.file
          ? { attachments: [artifact(next.file.bytes, next.file.name, next.file.mimeType)] }
          : {}),
        ...(next.options ? choices(next.options, true) : {}),
      };
      store.messages.push(message);
      if (next.handoff) store.handoff = { messageId: message.id, open: true, turnId };
      if (advance) store.demo!.step++;
      store.turn = 'idle';
      emit({ type: 'activity', items: activity });
      await persist();
      emitRefresh();
    }, 2600),
  );
};

registerLocalAccess(app, port, { key: token, origin, bearer: true });
await app.register(multipart, {
  limits: { fileSize: demo ? fileBytes : 25 * 1024 * 1024, files: 1, fields: 2 },
});
app.addHook('preClose', async () => {
  for (const stream of [...streams, ...views]) stream.end();
});
app.get('/api/session', async () => ({
  threadId,
  user: { id: '00000000-0000-4000-8000-000000000005' },
  settings: { onboardingCompleted: true },
}));
app.get('/fixture/counts', async (request, reply) => {
  if (!controlled(request.headers)) return reply.code(401).send({ error: 'Unauthorized.' });
  return {
    messages: store.messages.length,
    userMessages: store.messages.filter((message) => message.role === 'user').length,
    answers: store.parity?.dispatches ?? 0,
    refusals: store.parity?.refusals ?? 0,
    browser: store.browser ?? {},
  };
});
const sections = () => demoSections(Date.now(), store.demo!);
app.get('/api/schedules', async () => (demo ? sections().schedules : []));
app.get('/api/trust', async () =>
  demo
    ? sections().trust
    : {
        month: {
          start: '2026-11-01T00:00:00.000Z',
          days: 30,
          elapsedDays: 9,
          spentUsd: 0,
          forecastUsd: 0,
          planUsd: 0,
          planUsage: false,
          unpriced: false,
          daily: [0],
          backgroundUsd: 0,
          outside: [],
        },
        week: { things: 3, actions: 1, spentUsd: 0, planUsd: 0 },
        entries: [],
        next: null,
        limit: null,
        taskUsd: null,
      },
);
app.get('/api/state', async () => view());
app.get('/api/messages', async () => ({ messages: store.messages, hasMore: false }));
app.post('/api/messages', async (request, reply) => {
  const body = request.body as {
    clientMessageId?: unknown;
    text?: unknown;
    threadId?: unknown;
    replyToMessageId?: unknown;
    questionAnswer?: { choiceIds?: unknown };
  };
  if (
    typeof body?.clientMessageId !== 'string' ||
    typeof body.text !== 'string' ||
    (body.threadId !== undefined && body.threadId !== threadId)
  )
    return reply.code(400).send({ error: 'Invalid synthetic message.' });
  const existing = store.messages.find(
    (message) =>
      message.clientMessageId === body.clientMessageId || message.id === body.clientMessageId,
  );
  if (existing) return { messageId: existing.id, turnId: existing.turnId };
  const question = store.messages.find(
    (message) => body.questionAnswer && message.id === body.replyToMessageId,
  );
  const chosen = question?.answerChoices?.options.filter(
    (option) =>
      Array.isArray(body.questionAnswer?.choiceIds) &&
      body.questionAnswer.choiceIds.includes(option.id),
  );
  if (demo && body.questionAnswer && (!question?.answerChoicesPending || !chosen?.length))
    return reply.code(409).send({
      code: 'question_unavailable',
      error: 'This question is no longer waiting for an answer.',
    });
  const parity = store.parity;
  if (parity) {
    const allowed =
      body.threadId === threadId &&
      body.replyToMessageId === questionId &&
      parity.question === 'pending' &&
      body.text === 'Use synthetic draft' &&
      JSON.stringify(body.questionAnswer) === JSON.stringify({ choiceIds: [choiceId] });
    if (!allowed) {
      parity.refusals++;
      await persist();
      return reply.code(409).send({ code: 'question_unavailable' });
    }
    parity.question = 'answered';
    parity.dispatches++;
    store.messages.find((item) => item.id === questionId)!.answerChoicesPending = false;
  }
  const attachmentIds = (body as { attachmentIds?: unknown }).attachmentIds;
  const attachments = Array.isArray(attachmentIds)
    ? (store.artifacts ?? []).filter((artifact) => attachmentIds.includes(artifact.id))
    : [];
  if (Array.isArray(attachmentIds) && attachments.length !== attachmentIds.length)
    return reply.code(400).send({ error: 'An attachment is unavailable.' });
  const message: FixtureMessage = {
    id: body.clientMessageId,
    clientMessageId: body.clientMessageId,
    role: 'user',
    text: body.text,
    ...(attachments.length ? { attachments } : {}),
    ...(typeof body.replyToMessageId === 'string'
      ? { replyToMessageId: body.replyToMessageId }
      : {}),
    turnId: randomUUID(),
    createdAt: stamp(),
  };
  store.messages.push(message);
  store.turn = parity ? 'idle' : 'running';
  if (demo) {
    if (store.handoff?.open) endHandoff();
    if (question && chosen) {
      question.answerChoicesPending = false;
      respond(answerReply(chosen.map((option) => option.label).join(', ')), message.turnId, false);
    } else respond(scriptReply(store.demo!.step), message.turnId, true);
  }
  await persist();
  emitRefresh();
  return { messageId: message.id, turnId: message.turnId };
});
app.post('/api/thread/stop', async () => {
  cancelReply();
  store.turn = 'cancelled';
  await persist();
  emitRefresh();
  return { ok: true };
});
app.get('/api/events', async (_request, reply) => {
  reply.hijack();
  streams.add(reply.raw);
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  reply.raw.write(frame({ type: 'refresh' }));
  const keepalive = setInterval(() => reply.raw.write(': keepalive\n\n'), 15000);
  reply.raw.on('close', () => {
    clearInterval(keepalive);
    streams.delete(reply.raw);
  });
});
app.post('/fixture/stream', async (request, reply) => {
  if (!controlled(request.headers)) return reply.code(401).send({ error: 'Unauthorized.' });
  emit({
    type: 'activity',
    items: [
      {
        turnId: '00000000-0000-4000-8000-000000000006',
        title: 'Synthetic validation work',
        since: '2026-11-06T12:01:00.000Z',
      },
    ],
  });
  emit({
    type: 'delta',
    threadId,
    turnId: '00000000-0000-4000-8000-000000000006',
    streamId: 'synthetic-validation-stream',
    text: 'Synthetic streamed reply',
    done: false,
  });
  return { ok: true };
});
app.post('/fixture/activity', async (request, reply) => {
  if (!controlled(request.headers)) return reply.code(401).send({ error: 'Unauthorized.' });
  const body = request.body as { items?: unknown };
  if (!Array.isArray(body?.items))
    return reply.code(400).send({ error: 'Invalid synthetic activity.' });
  emit({ type: 'activity', items: body.items });
  return { ok: true };
});
app.post('/fixture/interrupt', async (request, reply) => {
  if (!controlled(request.headers)) return reply.code(401).send({ error: 'Unauthorized.' });
  const body = request.body as { id?: unknown; text?: unknown };
  if (typeof body?.id !== 'string' || typeof body.text !== 'string')
    return reply.code(400).send({ error: 'Invalid synthetic interruption.' });
  for (const stream of [...streams]) stream.end();
  if (!store.messages.some((message) => message.id === body.id)) {
    store.messages.push({
      id: body.id,
      role: 'assistant',
      text: body.text,
      turnId: randomUUID(),
      createdAt: new Date(Date.UTC(2026, 10, 6, 12, 0, store.messages.length)).toISOString(),
    });
    await persist();
  }
  return { ok: true };
});
app.post('/fixture/reply', async (request, reply) => {
  if (!controlled(request.headers)) return reply.code(401).send({ error: 'Unauthorized.' });
  const body = request.body as {
    id?: unknown;
    text?: unknown;
    file?: { name?: unknown; mimeType?: unknown; text?: unknown };
  };
  if (typeof body?.id !== 'string' || typeof body.text !== 'string')
    return reply.code(400).send({ error: 'Invalid synthetic reply.' });
  const file = body.file;
  if (
    file &&
    (typeof file.name !== 'string' ||
      typeof file.mimeType !== 'string' ||
      typeof file.text !== 'string')
  )
    return reply.code(400).send({ error: 'Invalid synthetic file.' });
  if (!store.messages.some((message) => message.id === body.id)) {
    store.messages.push({
      id: body.id,
      role: 'assistant',
      text: body.text,
      ...(file
        ? {
            attachments: [
              artifact(
                Buffer.from(file.text as string),
                file.name as string,
                file.mimeType as string,
              ),
            ],
          }
        : {}),
      turnId: randomUUID(),
      createdAt: new Date(Date.UTC(2026, 10, 6, 12, 0, store.messages.length)).toISOString(),
    });
    await persist();
  }
  emitRefresh();
  return { ok: true };
});

app.post<{ Params: { action: string } }>('/fixture/parity/:action', async (request, reply) => {
  if (!controlled(request.headers)) return reply.code(401).send({ error: 'Unauthorized.' });
  const action = request.params.action;
  if (action === 'seed') {
    if (store.parity) return reply.code(409).send({ error: 'Use a fresh fixture directory.' });
    store.parity = { question: 'pending', dispatches: 0, refusals: 0 };
    store.messages.push({
      id: questionId,
      role: 'assistant',
      text: 'Synthetic pending choice',
      turnId: taskId,
      createdAt: '2026-11-06T12:02:00.000Z',
      answerChoices: { multiple: false, options: [{ id: choiceId, label: 'Use synthetic draft' }] },
      answerChoicesPending: true,
    });
    store.turn = 'idle';
  } else if (!store.parity) {
    return reply.code(409).send({ error: 'Seed the synthetic workflows first.' });
  } else if (action !== 'inspect') {
    return reply.code(404).send({ error: 'Unknown fixture action.' });
  }
  await persist();
  if (action !== 'inspect') emitRefresh();
  return store.parity;
});
const handoffOpen = (turnId: unknown) =>
  turnId === (store.handoff?.turnId ?? handoffTurnId) && store.handoff?.open === true;
const countBrowser = (kind: string) => {
  store.browser = { ...store.browser, [kind]: (store.browser?.[kind] ?? 0) + 1 };
};
const endHandoff = () => {
  if (store.handoff) store.handoff.open = false;
  for (const view of [...views]) view.end();
};
const closeHandoff = async () => {
  endHandoff();
  await persist();
  emitRefresh();
};
app.post('/fixture/handoff', async (request, reply) => {
  if (!controlled(request.headers)) return reply.code(401).send({ error: 'Unauthorized.' });
  const body = request.body as { open?: unknown; messageId?: unknown; text?: unknown };
  if (typeof body?.open !== 'boolean') return reply.code(400).send({ error: 'Send open.' });
  if (!body.open) {
    await closeHandoff();
    return { ok: true };
  }
  const messageId =
    typeof body.messageId === 'string' ? body.messageId : '00000000-0000-4000-8000-000000000106';
  if (!store.messages.some((message) => message.id === messageId))
    store.messages.push({
      id: messageId,
      role: 'assistant',
      text: typeof body.text === 'string' ? body.text : 'Synthetic page needs you',
      turnId: handoffTurnId,
      createdAt: new Date(Date.UTC(2026, 10, 6, 12, 0, store.messages.length)).toISOString(),
    });
  store.handoff = { messageId, open: true };
  await persist();
  emitRefresh();
  return { ok: true };
});
app.get('/api/browser-handoff/stream', async (request, reply) => {
  const query = request.query as { turnId?: unknown; view?: unknown };
  if (typeof query.view !== 'string') return reply.code(400).send({ error: 'Name the view.' });
  if (!handoffOpen(query.turnId)) return reply.code(423).send({ error: handoffClosed });
  reply.hijack();
  views.add(reply.raw);
  reply.raw.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
  });
  let index = 0;
  const frames = demo ? [browserPage] : jpegFrames;
  const send = () => {
    const bytes = frames[index++ % frames.length]!;
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    reply.raw.write(Buffer.concat([length, bytes]));
  };
  send();
  const timer = setInterval(send, demo ? 1000 : 500);
  reply.raw.on('close', () => {
    clearInterval(timer);
    views.delete(reply.raw);
  });
});
app.post('/api/browser-handoff', async (request, reply) => {
  const body = request.body as { turnId?: unknown; inputs?: unknown };
  const inputs = browserHandoffInputs.safeParse(body?.inputs);
  if (!inputs.success)
    return reply.code(400).send({ error: 'Send pointer, wheel, key, text or copy input.' });
  if (!handoffOpen(body.turnId)) return reply.code(423).send({ error: handoffClosed });
  for (const input of inputs.data) countBrowser(input.type);
  await persist();
  return { ok: true };
});
app.post('/api/browser-handoff/navigate', async (request, reply) => {
  const body = request.body as { turnId?: unknown; action?: unknown };
  if (body?.action !== 'back' && body?.action !== 'reload')
    return reply.code(400).send({ error: 'Choose back or reload.' });
  if (!handoffOpen(body.turnId)) return reply.code(423).send({ error: handoffClosed });
  countBrowser(body.action);
  await persist();
  return { ok: true };
});
app.post('/api/browser-handoff/done', async (request, reply) => {
  const body = request.body as { turnId?: unknown };
  if (!handoffOpen(body?.turnId)) return reply.code(423).send({ error: handoffClosed });
  countBrowser('done');
  await closeHandoff();
  if (demo) respond(returnReply, randomUUID(), false);
  return { ok: true };
});
const preferences: Record<string, unknown> = {
  hourCycle: 'auto',
  rules: '',
  locale: null,
  timeZone: null,
  notificationRule: '',
  quietHoursEnabled: true,
  quietStart: '22:00',
  quietEnd: '08:00',
  proactivePaused: false,
};
const models = {
  connections: [
    {
      id: '00000000-0000-4000-8000-000000000201',
      provider: 'anthropic',
      method: 'api_key',
      label: 'Synthetic model service',
      status: 'connected',
      managed: false,
      models: [
        {
          id: 'synthetic-large',
          name: 'Synthetic Large',
          efforts: ['low', 'high'],
          images: true,
          contextWindow: 200000,
        },
        {
          id: 'synthetic-small',
          name: 'Synthetic Small',
          efforts: ['low'],
          images: false,
          contextWindow: 100000,
        },
      ],
    },
  ],
  selection: {
    connectionId: '00000000-0000-4000-8000-000000000201',
    modelId: 'synthetic-large',
    effort: 'low',
  },
};
app.get('/api/preferences', async () =>
  demo ? { ...preferences, ...store.demo!.preferences } : preferences,
);
app.get('/api/models', async () =>
  demo ? { ...models, selection: store.demo!.selection ?? models.selection } : models,
);
const taskView = () => ({
  id: taskId,
  title: 'Synthetic saved task',
  status: 'needs_you',
  now: 'Synthetic task state',
  result: 'Synthetic task result',
  doneWhen: 'The draft is ready',
  waitingFor: [],
  question: 'Synthetic older task question: continue the draft?',
  messageId: questionId,
  createdAt: '2026-11-06T11:00:00.000Z',
});
app.get('/api/tasks', async () => (demo ? sections().tasks : store.parity ? [taskView()] : []));
app.get('/api/apps', async () =>
  demo
    ? sections().apps
    : [
        {
          slug: 'gmail',
          name: 'Gmail',
          status: 'connected',
          connectionId: '00000000-0000-4000-8000-000000000301',
          accountId: 'synthetic-account',
          accountEmail: 'owner@example.com',
          triggersEnabled: false,
        },
      ],
);
app.get('/api/apps/catalog', async () =>
  demo
    ? sections().catalog
    : [
        { slug: 'gmail', name: 'Gmail', status: 'disconnected', triggersEnabled: false },
        { slug: 'notion', name: 'Notion', status: 'disconnected', triggersEnabled: false },
        { slug: 'slack', name: 'Slack', status: 'disconnected', triggersEnabled: false },
      ],
);
app.get('/api/vault', async () => (demo ? sections().vault : []));
app.get('/api/vault/sessions', async () => (demo ? sections().sessions : []));
if (demo) {
  const remove = async (id: string) => {
    store.demo!.removed = [...new Set([...store.demo!.removed, id])];
    await persist();
    return { ok: true };
  };
  app.get('/api/schedule-runs', async (request) =>
    sections().runs(String((request.query as { scheduleId?: unknown }).scheduleId ?? '')),
  );
  app.patch<{ Params: { id: string } }>('/api/schedules/:id', async (request, reply) => {
    const enabled = (request.body as { enabled?: unknown })?.enabled;
    if (typeof enabled !== 'boolean') return reply.code(400).send({ error: 'Send enabled.' });
    const state = store.demo!;
    state.paused = state.paused.filter((id) => id !== request.params.id);
    if (!enabled) state.paused.push(request.params.id);
    await persist();
    const schedule = sections().schedules.find((item) => item.id === request.params.id);
    return schedule ?? reply.code(404).send({ error: 'Schedule not found.' });
  });
  app.delete<{ Params: { id: string } }>('/api/schedules/:id', (request) =>
    remove(request.params.id),
  );
  app.delete<{ Params: { id: string } }>('/api/vault/:id', (request) => remove(request.params.id));
  app.delete<{ Params: { id: string } }>('/api/vault/sessions/:id', (request) =>
    remove(request.params.id),
  );
  app.post<{ Params: { id: string } }>('/api/apps/:slug/accounts/:id/disconnect', (request) =>
    remove(request.params.id),
  );
  app.post<{ Params: { id: string } }>('/api/tasks/:id/stop', async (request) => {
    store.demo!.stopped = [...new Set([...store.demo!.stopped, request.params.id])];
    await persist();
    return { ok: true };
  });
  app.patch('/api/preferences', async (request) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(body))
      if (
        key in preferences &&
        (preferences[key] === null || typeof value === typeof preferences[key])
      )
        store.demo!.preferences[key] = value;
    await persist();
    return { ...preferences, ...store.demo!.preferences };
  });
  app.put('/api/models/selection', async (request, reply) => {
    const body = request.body as { connectionId?: unknown; modelId?: unknown; effort?: unknown };
    const connection = models.connections.find((item) => item.id === body?.connectionId);
    const model = connection?.models.find((item) => item.id === body?.modelId);
    if (
      !connection ||
      !model ||
      typeof body.effort !== 'string' ||
      !model.efforts.includes(body.effort)
    )
      return reply.code(400).send({ error: 'Choose a listed model and one of its efforts.' });
    store.demo!.selection = { connectionId: connection.id, modelId: model.id, effort: body.effort };
    await persist();
    return { ...models, selection: store.demo!.selection };
  });
  app.put('/api/trust/limit', async (request, reply) => {
    const monthlyUsd = (request.body as { monthlyUsd?: unknown })?.monthlyUsd;
    if (monthlyUsd !== null && (typeof monthlyUsd !== 'number' || !(monthlyUsd > 0)))
      return reply.code(400).send({ error: 'Send a positive monthly limit or null.' });
    store.demo!.limit = monthlyUsd;
    await persist();
    return { ok: true };
  });
}

function artifact(bytes: Buffer, name: string, mimeType: string) {
  const id = randomUUID();
  const item = { id, name, mimeType, size: bytes.length, url: `/api/artifacts/${id}` };
  store.artifacts = [...(store.artifacts ?? []), item];
  store.files = { ...store.files, [id]: bytes.toString('base64') };
  return item;
}

app.get<{ Params: { id: string } }>('/api/artifacts/:id', async (request, reply) => {
  const item = store.artifacts?.find((artifact) => artifact.id === request.params.id);
  const bytes = store.files?.[request.params.id];
  if (!item || bytes === undefined) return reply.code(404).send({ error: 'File not found.' });
  return reply.type(item.mimeType).send(Buffer.from(bytes, 'base64'));
});
app.get<{ Params: { id: string } }>('/api/artifacts/:id/metadata', async (request, reply) => {
  const item = store.artifacts?.find((artifact) => artifact.id === request.params.id);
  return item ?? reply.code(404).send({ error: 'File not found.' });
});

app.post('/api/uploads', async (request, reply) => {
  const file = await request.file();
  if (!file) return reply.code(400).send({ error: 'Choose a file to upload.' });
  const item = artifact(await file.toBuffer(), file.filename, file.mimetype);
  await persist();
  return item;
});

app.post('/api/messages/audio', async (request, reply) => {
  let message: { clientMessageId?: unknown; threadId?: unknown } | undefined;
  let recording: { bytes: Buffer; name: string; mimeType: string } | undefined;
  for await (const part of request.parts()) {
    if (part.type === 'file')
      recording = { bytes: await part.toBuffer(), name: part.filename, mimeType: part.mimetype };
    else if (part.fieldname === 'message' && typeof part.value === 'string')
      message = JSON.parse(part.value);
  }
  if (!recording || !recording.mimeType.startsWith('audio/'))
    return reply.code(400).send({ error: 'Choose an audio recording.' });
  if (typeof message?.clientMessageId !== 'string' || message.threadId !== threadId)
    return reply.code(400).send({ error: 'Check the voice message details.' });
  const id = message.clientMessageId;
  const fault = store.audioFaults?.shift();
  if (fault === 'cancel') {
    await persist();
    return reply.code(409).send({ error: 'This voice message was cancelled.' });
  }
  if (fault === 'busy') {
    await persist();
    return reply.code(503).send({ error: 'Synthetic busy server.' });
  }
  const fingerprint = createHash('sha256').update(recording.bytes).digest('hex');
  const claims = (store.audioClaims ??= {});
  const claim = claims[id];
  if (claim) {
    if (claim.response && claim.fingerprint === fingerprint) return claim.response;
    return reply.code(409).send({
      error:
        'This recording may already be in the conversation. Check before sending a new recording.',
    });
  }
  claims[id] = { fingerprint };
  if (fault === 'abort-after-claim') {
    await persist();
    reply.hijack();
    request.raw.socket.destroy();
    return;
  }
  const clip = artifact(recording.bytes, recording.name, recording.mimeType);
  const turnId = randomUUID();
  const transcript = demo
    ? "Voice message (the demo doesn't transcribe audio)"
    : 'Synthetic transcript';
  store.messages.push({
    id,
    clientMessageId: id,
    role: 'user',
    text: transcript,
    turnId,
    attachments: [clip],
    createdAt: stamp(),
  });
  const response = { threadId, turnId, messageId: id, messageText: transcript };
  claims[id].response = response;
  if (demo) {
    store.turn = 'running';
    respond(scriptReply(store.demo!.step), turnId, true);
  }
  await persist();
  emitRefresh();
  if (fault === 'drop-response') {
    reply.hijack();
    request.raw.socket.destroy();
    return;
  }
  return response;
});

app.post('/fixture/audio-faults', async (request, reply) => {
  if (!controlled(request.headers)) return reply.code(401).send({ error: 'Unauthorized.' });
  const body = request.body as { faults?: unknown };
  if (!Array.isArray(body?.faults)) return reply.code(400).send({ error: 'Invalid faults.' });
  store.audioFaults = body.faults as AudioFault[];
  await persist();
  return { ok: true };
});

if (demo && !store.demo) {
  const now = Date.now();
  let previous: FixtureMessage | undefined;
  for (const entry of demoConversation) {
    const message: FixtureMessage = {
      id: randomUUID(),
      role: entry.role,
      text: entry.text,
      turnId: randomUUID(),
      createdAt: new Date(now - entry.minutesAgo * 60_000).toISOString(),
      ...(entry.files
        ? { attachments: entry.files.map((file) => artifact(file.bytes, file.name, file.mimeType)) }
        : {}),
      ...(entry.options ? choices(entry.options, !entry.answered) : {}),
      ...(entry.replyToPrevious && previous ? { replyToMessageId: previous.id } : {}),
    };
    store.messages.push(message);
    previous = message;
  }
  store.demo = { step: 0, removed: [], paused: [], stopped: [], preferences: {}, limit: 20 };
  await persist();
}
await app.listen({ host, port });
process.stdout.write(`${JSON.stringify({ ready: true })}\n`);

const close = async () => {
  await app.close();
  await persistence;
};
process.once('SIGTERM', () => void close().then(() => process.exit(0)));
process.once('SIGINT', () => void close().then(() => process.exit(0)));
