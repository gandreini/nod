import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiError, getState, read, sendText } from '../src/connection/api.ts';
import { choiceAnswerText } from '../src/connection/contracts.ts';
import {
  codeRequestTargets,
  keepOlder,
  mergeMessages,
  persistable,
  privateCode,
  sendTime,
  timeline,
  unsent,
  inTail,
  nextStep,
  workState,
  type Outgoing,
} from '../src/chat/chat-state.ts';
import type { Activity, Message } from '../src/connection/contracts.ts';
import { claimCallStart, inCall, openCall } from '../src/call/active.ts';
import { liveHeld } from '../src/chat/live-holds.ts';
import { startFakeServer } from './fake-server.ts';

function message(id: string, createdAt: string, text = id): Message {
  return { id, role: 'user', text, turnId: null, createdAt, attachments: [] };
}

const claimed =
  'This recording may already be in the conversation. Check before sending a new recording.';

function work(fields: Partial<Activity>): Activity {
  return {
    turnId: 't',
    taskId: null,
    title: null,
    step: null,
    site: null,
    since: '2026-11-15T08:00:00.000Z',
    doing: 'model',
    quietSince: '2026-11-15T08:00:00.000Z',
    ...fields,
  };
}

describe('chat state', () => {
  test('a double tap opens one call, and a call keeps the live connection open', () => {
    assert.equal(claimCallStart(1_000), true);
    assert.equal(claimCallStart(1_100), false);
    const close = openCall();
    assert.equal(inCall(), true);
    assert.equal(liveHeld(), true);
    assert.equal(claimCallStart(10_000), false);
    close();
    assert.equal(inCall(), false);
    assert.equal(liveHeld(), false);
    assert.equal(claimCallStart(20_000), true);
  });

  test('a code sent while Nod waits for one is masked, and nothing else is', () => {
    const otp = [{ id: 'r1', turnId: 't1', kind: 'otp' as const }];
    const card = [{ id: 'r2', turnId: 't1', kind: 'payment' as const }];
    assert.equal(privateCode('482913', otp), 'Verification code sent securely.');
    assert.equal(privateCode('the code is 482913', otp), 'Verification code sent securely.');
    assert.equal(privateCode('123', card), 'Security code sent securely.');
    assert.equal(privateCode('cvv 4321', card), 'Security code sent securely.');
    assert.equal(privateCode('482913', []), undefined);
    assert.equal(privateCode('yes, go ahead', otp), undefined);
    assert.equal(privateCode('see you at 5', card), undefined);
  });

  test('a code is never kept with the unsent messages, even before Nod asks for it', () => {
    const outgoing = (text: string, extra: Partial<Outgoing> = {}): Outgoing => ({
      id: 'o',
      text,
      status: 'queued',
      createdAt: '2026-11-22T10:00:00.000Z',
      ...extra,
    });
    assert.equal(persistable(outgoing('482913')), false);
    assert.equal(persistable(outgoing('the code is 482913')), false);
    assert.equal(persistable(outgoing('cvv 123')), false);
    assert.equal(
      persistable(outgoing('ok', { privateText: 'Verification code sent securely.' })),
      false,
    );
    assert.equal(persistable(outgoing('Book the table for Friday')), true);
  });

  test('the code card goes under Nod’s latest message in the waiting turn', () => {
    const message = (id: string, role: 'user' | 'assistant', turnId: string): Message => ({
      id,
      role,
      text: id,
      turnId,
      createdAt: '2026-11-22T10:00:00.000Z',
      attachments: [],
    });
    const targets = codeRequestTargets(
      [{ id: 'r1', turnId: 't2', kind: 'otp' }],
      [
        message('a', 'assistant', 't1'),
        message('b', 'user', 't2'),
        message('c', 'assistant', 't2'),
        message('d', 'assistant', 't2'),
      ],
    );
    assert.deepEqual([...targets], [['d', 'otp']]);
  });

  test('Nod shows it is working whenever Stop is offered, a task it continues included', () => {
    const task = [work({ taskId: 'task', title: 'Synthetic benchmark' })];
    assert.deepEqual(workState(task, [], false), { working: true, thinking: true });
    assert.deepEqual(workState(task, [], true), { working: true, thinking: false });
    assert.deepEqual(workState([work({ background: true })], [], false), {
      working: false,
      thinking: false,
    });
    const outgoing = (fields: Partial<Outgoing>): Outgoing => ({
      id: 'o',
      text: '',
      status: 'sending',
      createdAt: '2026-11-15T08:00:00.000Z',
      ...fields,
    });
    assert.deepEqual(workState([], [outgoing({})], false), { working: false, thinking: true });
  });

  test('a message waiting to be sent again does not show Nod as working', () => {
    const waiting: Outgoing = {
      id: 'o',
      text: '',
      status: 'sending',
      attempts: 2,
      createdAt: '2026-11-15T08:00:00.000Z',
    };
    assert.deepEqual(workState([], [waiting], false), { working: false, thinking: false });
    assert.deepEqual(workState([], [{ ...waiting, status: 'failed' }], false), {
      working: false,
      thinking: false,
    });
  });

  test('history and live state merge with each message once, oldest first', () => {
    const history = [
      message('a', '2026-11-13T08:00:00.000Z'),
      message('b', '2026-11-13T08:01:00.000Z', 'old text'),
    ];
    const live = [
      message('b', '2026-11-13T08:01:00.000Z', 'new text'),
      message('c', '2026-11-13T08:02:00.000Z'),
    ];
    const merged = mergeMessages(history, live);
    assert.deepEqual(
      merged.map((item) => item.id),
      ['a', 'b', 'c'],
    );
    assert.equal(merged[1].text, 'new text');
  });

  test('messages pushed out of the latest window stay once older pages are loaded', () => {
    const loaded = [message('a', '2026-11-13T08:00:00.000Z')];
    const window = [
      message('b', '2026-11-13T08:01:00.000Z'),
      message('c', '2026-11-13T08:02:00.000Z'),
    ];
    const moved = [
      message('c', '2026-11-13T08:02:00.000Z'),
      message('d', '2026-11-13T08:03:00.000Z'),
    ];
    const older = keepOlder(loaded, window, moved);
    assert.deepEqual(
      mergeMessages(older, moved).map((item) => item.id),
      ['a', 'b', 'c', 'd'],
    );
    assert.deepEqual(keepOlder([], window, moved), []);
  });

  test('a message the server hides inside the latest window does not come back', () => {
    const loaded = [message('a', '2026-11-13T08:00:00.000Z')];
    const window = [
      message('b', '2026-11-13T08:01:00.000Z'),
      message('c', '2026-11-13T08:02:00.000Z'),
    ];
    const hidden = [message('b', '2026-11-13T08:01:00.000Z')];
    assert.deepEqual(
      mergeMessages(keepOlder(loaded, window, hidden), hidden).map((item) => item.id),
      ['a', 'b'],
    );
  });

  test('a message that was not sent keeps its place when newer messages arrive', () => {
    const failed: Outgoing = {
      id: 'o',
      text: 'not sent',
      status: 'failed',
      createdAt: '2026-11-15T08:02:00.000Z',
    };
    const rows = timeline(
      [message('a', '2026-11-15T08:01:00.000Z'), message('b', '2026-11-15T08:03:00.000Z')],
      [failed],
    );
    assert.deepEqual(
      rows.map((row) => row.key),
      ['a', 'o', 'b'],
    );
  });

  test('a new message goes after the latest one even when the phone clock is behind', () => {
    const messages = [message('a', '2026-11-15T08:05:00.000Z')];
    const createdAt = sendTime(new Date('2026-11-15T08:00:00.000Z'), messages);
    const rows = timeline(messages, [{ id: 'o', text: 'new', status: 'sending', createdAt }]);
    assert.deepEqual(
      rows.map((row) => row.key),
      ['a', 'o'],
    );
    assert.equal(
      sendTime(new Date('2026-11-15T08:09:00.000Z'), messages),
      '2026-11-15T08:09:00.000Z',
    );
  });

  test('a sent message leaves the outgoing list once the server has it', () => {
    const outgoing: Outgoing[] = [
      { id: 'x', text: 'hi', status: 'sending', createdAt: '2026-11-13T08:03:00.000Z' },
      { id: 'y', text: 'there', status: 'failed', createdAt: '2026-11-13T08:04:00.000Z' },
    ];
    assert.deepEqual(
      unsent(outgoing, [message('x', '2026-11-13T08:03:00.000Z')]).map((item) => item.id),
      ['y'],
    );
  });

  test('a voice message resent under a new ID leaves the outgoing list once that ID arrives', () => {
    const voice: Outgoing = {
      id: 'first',
      sendId: 'second',
      text: '',
      status: 'sending',
      createdAt: '2026-11-14T12:30:00.000Z',
    };
    assert.equal(unsent([voice], [message('first', '2026-11-14T12:30:01.000Z')]).length, 1);
    assert.equal(unsent([voice], [message('second', '2026-11-14T12:30:05.000Z')]).length, 0);
  });

  test('an unreachable server renews the connection once, then makes a message wait', () => {
    assert.equal(nextStep({ status: 0 }, undefined, { voice: false, attempts: 0 }), 'recover');
    assert.equal(nextStep({ status: 0 }, false, { voice: true, attempts: 9 }), 'recover');
    assert.equal(
      nextStep({ status: 0 }, undefined, { voice: false, attempts: 0, recovered: true }),
      'wait',
    );
    assert.equal(
      nextStep({ status: 0 }, false, { voice: true, attempts: 9, recovered: true }),
      'wait',
    );
  });

  test('a busy server is tried three more times, then the message is not sent', () => {
    for (const status of [429, 500, 503])
      assert.equal(nextStep({ status }, undefined, { voice: false, attempts: 0 }), 'retry');
    assert.equal(nextStep({ status: 503 }, false, { voice: true, attempts: 2 }), 'retry');
    assert.equal(nextStep({ status: 503 }, false, { voice: true, attempts: 3 }), 'fail');
    assert.equal(
      nextStep(
        { status: 409, reason: 'Work is stopping. Send the recording again when it finishes.' },
        false,
        {
          voice: true,
          attempts: 0,
        },
      ),
      'retry',
    );
  });

  test('a message already in the conversation is never sent again', () => {
    assert.equal(nextStep({ status: 0 }, true, { voice: true, attempts: 0 }), 'done');
    assert.equal(
      nextStep({ status: 409, reason: claimed }, true, { voice: true, attempts: 0 }),
      'done',
    );
    assert.equal(
      nextStep({ status: 409, reason: 'This message ID is already in use.' }, true, {
        voice: false,
        attempts: 0,
      }),
      'done',
    );
  });

  test('a voice message gets a new ID only when the server holds a dead claim and it is not in the chat', () => {
    assert.equal(
      nextStep({ status: 409, reason: claimed }, false, { voice: true, attempts: 0 }),
      'renew',
    );
    assert.equal(
      nextStep({ status: 409, reason: claimed }, undefined, { voice: true, attempts: 0 }),
      'retry',
    );
  });

  test('a recording with no speech is dropped', () => {
    const silent = {
      status: 400,
      retryable: true,
      reason: 'No speech was detected. Please record again.',
    };
    assert.equal(nextStep(silent, false, { voice: true, attempts: 0 }), 'drop');
    assert.equal(nextStep(silent, undefined, { voice: true, attempts: 0 }), 'drop');
  });

  test('a refusal is not sent again by itself, even when the server calls it retryable', () => {
    const refusals = [
      { status: 409, retryable: false, reason: 'This voice message was cancelled.' },
      {
        status: 409,
        retryable: true,
        reason: 'This conversation has been reset. Reload it before continuing.',
      },
      { status: 400, retryable: true, reason: 'Choose an audio recording.' },
      { status: 400, reason: 'Send a shorter voice message.' },
      { status: 404, reason: 'The reply is unavailable in this conversation.' },
      { status: 413 },
    ];
    for (const failure of refusals) {
      assert.equal(nextStep(failure, false, { voice: true, attempts: 0 }), 'fail');
      assert.equal(nextStep(failure, false, { voice: false, attempts: 0 }), 'fail');
    }
  });

  test('a message is in the tail only while nothing in the chat comes after it', () => {
    const item: Outgoing = {
      id: 'o',
      text: 'hi',
      status: 'queued',
      createdAt: '2026-11-18T09:00:00.000Z',
    };
    assert.equal(inTail(item, [message('a', '2026-11-18T08:59:00.000Z')]), true);
    assert.equal(inTail(item, [message('b', '2026-11-18T09:05:00.000Z')]), false);
  });
});

describe('chat requests', () => {
  let fake: Awaited<ReturnType<typeof startFakeServer>>;
  let connection: { origin: string; token: string; owner: string };

  before(async () => {
    fake = await startFakeServer();
    connection = { origin: fake.origin, token: fake.token, owner: 'owner' };
  });

  after(() => fake.stop());

  test('a refused token surfaces its status', async () => {
    await assert.rejects(
      getState({ ...connection, token: 'a'.repeat(64) }),
      (error) => error instanceof ApiError && error.status === 401,
    );
  });

  test('a page that is not JSON fails with its status instead of an empty result', async () => {
    await assert.rejects(
      read(new Response('<html>Sign in to the Wi-Fi</html>', { status: 200 })),
      (error) =>
        error instanceof ApiError &&
        error.status === 200 &&
        error.message.includes('did not answer with JSON (HTTP 200)'),
    );
  });
});

describe('answering Nod', () => {
  let fake: Awaited<ReturnType<typeof startFakeServer>>;
  let connection: { origin: string; token: string; owner: string };

  before(async () => {
    fake = await startFakeServer();
    connection = { origin: fake.origin, token: fake.token, owner: 'owner' };
    await fake.control('/fixture/parity/seed', {});
  });

  after(() => fake.stop());

  test('a chosen option reaches the server once', async () => {
    const state = await getState(connection);
    const question = state.messages.find((item) =>
      state.pendingAnswerChoiceMessageIds?.includes(item.id),
    )!;
    const option = question.answerChoices!.options[0];
    const answer = {
      id: randomUUID(),
      text: choiceAnswerText([option]),
      threadId: state.threadId,
      replyToMessageId: question.id,
      questionAnswer: { choiceIds: [option.id] },
    };
    await sendText(connection, answer);
    const inspected = await fake.control('/fixture/parity/inspect', {});
    assert.equal(((await inspected.json()) as { dispatches: number }).dispatches, 1);
  });
});
