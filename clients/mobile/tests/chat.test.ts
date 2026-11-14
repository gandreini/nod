import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiError, getState, sendText } from '../src/api.ts';
import { choiceAnswerText } from '../src/contracts.ts';
import { mergeMessages, unsent, voiceStep, type Outgoing } from '../src/chat-state.ts';
import type { Message } from '../src/contracts.ts';
import { startFakeServer } from './fake-server.ts';

function message(id: string, createdAt: string, text = id): Message {
  return { id, role: 'user', text, turnId: null, createdAt, attachments: [] };
}

const claimed =
  'This recording may already be in the conversation. Check before sending a new recording.';

describe('chat state', () => {
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
});

describe('chat requests', () => {
  let fake: Awaited<ReturnType<typeof startFakeServer>>;
  let connection: { origin: string; token: string; owner: string };

  before(async () => {
    fake = await startFakeServer();
    connection = { origin: fake.origin, token: fake.token, owner: 'owner' };
  });

  after(() => fake.stop());

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

  test('a voice send that hits the network or a busy server retries under the same ID', () => {
    assert.equal(voiceStep({ status: 0 }, undefined), 'retry');
    assert.equal(voiceStep({ status: 503 }, undefined), 'retry');
    assert.equal(voiceStep({ status: 429 }, false), 'retry');
  });

  test('a voice message already in the conversation is never sent again', () => {
    assert.equal(voiceStep({ status: 0 }, true), 'done');
    assert.equal(voiceStep({ status: 409, reason: claimed }, true), 'done');
  });

  test('a new ID is used only when the server holds a dead claim and the message is not in the chat', () => {
    assert.equal(voiceStep({ status: 409, retryable: false, reason: claimed }, false), 'renew');
    assert.equal(voiceStep({ status: 409, retryable: false, reason: claimed }, undefined), 'retry');
  });

  test('a voice message the owner stopped, or that the server refused, is not sent again', () => {
    assert.equal(
      voiceStep(
        { status: 409, retryable: false, reason: 'This voice message was cancelled.' },
        false,
      ),
      'stop',
    );
    assert.equal(
      voiceStep(
        { status: 409, reason: 'This conversation has been reset. Reload it before continuing.' },
        false,
      ),
      'stop',
    );
    assert.equal(
      voiceStep({ status: 400, reason: 'Send a shorter voice message.' }, false),
      'stop',
    );
    assert.equal(voiceStep({ status: 413 }, false), 'stop');
    assert.equal(voiceStep({ status: 409, retryable: true, reason: 'Busy' }, false), 'retry');
  });

  test('a retried send leaves the message in the conversation once', async () => {
    const { threadId } = await getState(connection);
    const id = randomUUID();
    await sendText(connection, { id, text: 'Hello', threadId });
    await sendText(connection, { id, text: 'Hello', threadId });
    const { messages } = await getState(connection);
    assert.equal(messages.filter((item) => item.id === id).length, 1);
  });

  test('a refused token surfaces its status', async () => {
    await assert.rejects(
      getState({ ...connection, token: 'a'.repeat(64) }),
      (error) => error instanceof ApiError && error.status === 401,
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

  test('a chosen option reaches the server once and a second answer is refused', async () => {
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
    await assert.rejects(
      sendText(connection, { ...answer, id: randomUUID() }),
      (error) =>
        error instanceof ApiError && error.status === 409 && error.code === 'question_unavailable',
    );
  });
});
