import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test } from 'node:test';
import {
  ApiError,
  getState,
  messageArrived,
  postAudio,
  postUpload,
  sendText,
} from '../src/connection/api.ts';
import { sendTime, type Outgoing } from '../src/chat/chat-state.ts';
import type { Connection } from '../src/connection/connection.ts';
import { createOutbox } from '../src/chat/outbox.ts';
import { startFakeServer } from './fake-server.ts';

const threadId = '00000000-0000-4000-8000-000000000001';
const recording = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4, 5, 6, 7, 8]);

async function harness(
  faults: string[] = [],
  later: (run: () => void, delay: number) => void = (run) => void setTimeout(run, 0),
) {
  const server = await startFakeServer();
  const connection: Connection = { origin: server.origin, token: server.token, owner: 'synthetic' };
  if (faults.length) await server.control('/fixture/audio-faults', { faults });
  const dropped: string[] = [];
  const net = {
    up: true,
    stale: false,
    suspect: true,
    slowSends: 0,
    loseAnswers: 0,
    deadSends: 0,
    steps: [] as string[],
  };
  const reachable = () => {
    if (!net.up) throw new ApiError(0, 'Could not reach the synthetic server: offline');
  };
  const outbox = createOutbox({
    thread: () => threadId,
    sendText: async (item, thread) => {
      reachable();
      net.steps.push('send');
      if (net.deadSends > 0) {
        net.deadSends -= 1;
        return new Promise(() => {});
      }
      if (net.slowSends > 0) await new Promise((resolve) => setTimeout(resolve, net.slowSends));
      const answer = await sendText(connection, {
        id: item.id,
        text: item.text,
        threadId: thread,
        attachmentIds: item.attachmentIds,
      });
      if (net.loseAnswers > 0) {
        net.loseAnswers -= 1;
        throw new ApiError(0, 'The synthetic answer was lost on the way back.');
      }
      return answer;
    },
    sendAudio: async (_item, thread, sendId) => {
      reachable();
      return postAudio(
        connection,
        { id: sendId, threadId: thread },
        new Blob([recording], { type: 'audio/wav' }),
        'voice.wav',
        300,
      );
    },
    arrived: (sendId) => messageArrived(connection, sendId),
    stale: () => net.stale,
    suspect: () => net.suspect,
    recover: async () => {
      net.stale = false;
      net.steps.push('recover');
    },
    hedgeAfter: 300,
    newId: randomUUID,
    later,
    onChange: () => {},
    onRefused: () => {},
    onDropped: (reason) => dropped.push(reason),
    onDelivered: () => void getState(connection).then((state) => outbox.settle(state.messages)),
  });
  outbox.setOnline(true);
  const settled = async () => {
    for (let round = 0; round < 300; round++) {
      const moving = (item: Outgoing) =>
        item.status === 'queued' ||
        item.status === 'sending' ||
        (item.status === 'waiting' && net.up);
      if (!outbox.items().some(moving)) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('The outbox did not settle.');
  };
  const messages = async () => (await getState(connection)).messages;
  const voices = async () =>
    (await messages()).filter((message) =>
      message.attachments?.some((file) => file.mimeType === 'audio/wav'),
    );
  return { server, connection, outbox, settled, messages, voices, dropped, net };
}

function voice(createdAt = new Date().toISOString()): Outgoing {
  return {
    id: randomUUID(),
    text: '',
    audio: {
      uri: 'file:///synthetic/voice.wav',
      mimeType: 'audio/wav',
      name: 'voice.wav',
      durationMillis: 1200,
    },
    status: 'queued',
    createdAt,
  };
}

function text(value: string, createdAt = new Date().toISOString()): Outgoing {
  return { id: randomUUID(), text: value, status: 'queued', createdAt };
}

describe('message delivery', () => {
  test('a voice message whose answer was lost on the way back is not sent twice', async () => {
    const { server, outbox, settled, voices } = await harness(['drop-response']);
    try {
      const item = voice();
      outbox.add(item);
      await settled();
      const arrived = await voices();
      assert.equal(arrived.length, 1);
      assert.equal(arrived[0].id, item.id);
    } finally {
      await server.stop();
    }
  });

  test('a voice message the server took but never finished arrives once under a new ID', async () => {
    const { server, outbox, settled, voices } = await harness(['abort-after-claim']);
    try {
      const item = voice();
      outbox.add(item);
      await settled();
      const arrived = await voices();
      assert.equal(arrived.length, 1);
      assert.notEqual(arrived[0].id, item.id);
    } finally {
      await server.stop();
    }
  });

  test('a busy server is retried with the same ID', async () => {
    const { server, outbox, settled, voices } = await harness(['busy']);
    try {
      const item = voice();
      outbox.add(item);
      await settled();
      assert.deepEqual(
        (await voices()).map((message) => message.id),
        [item.id],
      );
    } finally {
      await server.stop();
    }
  });

  test('a server that stays busy leaves the message not sent, with the reason', async () => {
    const { server, outbox, settled, voices } = await harness(['busy', 'busy', 'busy', 'busy']);
    try {
      outbox.add(voice());
      await settled();
      assert.equal((await voices()).length, 0);
      const [item] = outbox.items();
      assert.equal(item.status, 'failed');
      assert.match(item.error ?? '', /busy/i);
    } finally {
      await server.stop();
    }
  });

  test('a voice send the server never answers is sent again and arrives once', async () => {
    const { server, outbox, settled, voices } = await harness(['hang']);
    try {
      const item = voice();
      outbox.add(item);
      await settled();
      assert.deepEqual(
        (await voices()).map((message) => message.id),
        [item.id],
      );
    } finally {
      await server.stop();
    }
  });

  test('a voice message with no speech leaves the chat and says why', async () => {
    const { server, outbox, settled, voices, dropped } = await harness(['silent']);
    try {
      outbox.add(voice());
      await settled();
      assert.equal(outbox.items().length, 0);
      assert.equal((await voices()).length, 0);
      assert.equal(dropped.length, 1);
      assert.match(dropped[0], /no speech/i);
    } finally {
      await server.stop();
    }
  });

  test('a voice message the owner stopped is not sent again, even when the connection returns', async () => {
    const { server, outbox, settled, voices } = await harness(['cancel']);
    try {
      outbox.add(voice());
      await settled();
      outbox.setOnline(false);
      outbox.setOnline(true);
      await settled();
      assert.equal((await voices()).length, 0);
      const [item] = outbox.items();
      assert.equal(item.status, 'failed');
      assert.match(item.error ?? '', /cancelled/);
    } finally {
      await server.stop();
    }
  });

  test('a text whose answer is lost goes again at once on a fresh connection, without waiting for the live stream, and arrives once', async () => {
    const { server, outbox, settled, messages, net } = await harness();
    try {
      outbox.setOnline(false);
      net.loseAnswers = 1;
      const item = text('lost answer');
      outbox.add(item);
      await settled();
      assert.deepEqual(net.steps, ['send', 'recover', 'send']);
      assert.equal(outbox.items()[0]?.status ?? 'sent', 'sent');
      assert.deepEqual((await messages()).filter((message) => message.id === item.id).length, 1);
    } finally {
      await server.stop();
    }
  });

  test('a text stuck on a dead connection goes again on a fresh one within moments and arrives once', async () => {
    const { server, outbox, settled, messages, net } = await harness();
    try {
      net.deadSends = 1;
      const item = text('dead connection');
      const started = Date.now();
      outbox.add(item);
      await settled();
      assert.ok(Date.now() - started < 2000);
      assert.deepEqual(net.steps, ['send', 'recover', 'send']);
      assert.equal((await messages()).filter((message) => message.id === item.id).length, 1);
    } finally {
      await server.stop();
    }
  });

  test('a text stuck on a dead connection is not sent again after the outbox stops', async () => {
    const { server, outbox, net } = await harness();
    try {
      net.deadSends = 1;
      outbox.add(text('closed before the resend'));
      await new Promise((resolve) => setTimeout(resolve, 50));
      outbox.stop();
      await new Promise((resolve) => setTimeout(resolve, 600));
      assert.deepEqual(net.steps, ['send']);
    } finally {
      await server.stop();
    }
  });

  test('a slow server on a healthy connection gets the message once, with no resend', async () => {
    const { server, outbox, settled, messages, net } = await harness();
    try {
      net.suspect = false;
      net.slowSends = 700;
      const item = text('slow but alive');
      outbox.add(item);
      await settled();
      assert.deepEqual(net.steps, ['send']);
      assert.equal((await messages()).filter((message) => message.id === item.id).length, 1);
    } finally {
      await server.stop();
    }
  });

  test('a quiet live stream renews the connection before a message goes out', async () => {
    const { server, outbox, settled, messages, net } = await harness();
    try {
      net.stale = true;
      const item = text('after a quiet stream');
      outbox.add(item);
      await settled();
      assert.deepEqual(net.steps, ['recover', 'send']);
      assert.ok((await messages()).some((message) => message.id === item.id));
    } finally {
      await server.stop();
    }
  });

  test('offline, messages wait in order and go out when the connection returns', async () => {
    const { server, outbox, settled, messages, net } = await harness();
    try {
      net.up = false;
      outbox.setOnline(false);
      const first = text('first');
      const second = text('second', new Date(Date.now() + 1).toISOString());
      outbox.add(first);
      outbox.add(second);
      for (let round = 0; round < 100 && outbox.items()[0].status !== 'waiting'; round++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.deepEqual(
        outbox.items().map((item) => item.status),
        ['waiting', 'queued'],
      );
      net.up = true;
      outbox.setOnline(true);
      await settled();
      const sent = (await messages()).map((message) => message.id);
      assert.ok(sent.indexOf(first.id) >= 0 && sent.indexOf(first.id) < sent.indexOf(second.id));
    } finally {
      await server.stop();
    }
  });

  test('a message deleted while it waits for the connection is never sent', async () => {
    const { server, outbox, settled, messages, net } = await harness();
    try {
      net.up = false;
      outbox.setOnline(false);
      const item = text('never');
      outbox.add(item);
      await settled();
      assert.equal(outbox.items()[0].status, 'waiting');
      outbox.discard(item.id);
      net.up = true;
      outbox.setOnline(true);
      await settled();
      assert.equal(outbox.items().length, 0);
      assert.ok(!(await messages()).some((message) => message.id === item.id));
    } finally {
      await server.stop();
    }
  });

  test('a voice message deleted while it waits to be sent again is never sent', async () => {
    const queued: (() => void)[] = [];
    const { server, outbox, voices } = await harness(['busy'], (run) => void queued.push(run));
    try {
      const item = voice();
      outbox.add(item);
      for (let round = 0; round < 100 && !queued.length; round++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(outbox.items()[0].status, 'queued');
      outbox.discard(item.id);
      queued.splice(0).forEach((run) => run());
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.equal((await voices()).length, 0);
      assert.equal(outbox.items().length, 0);
    } finally {
      await server.stop();
    }
  });

  test('after a restart, only the last unsent message goes out by itself', async () => {
    const { server, outbox, settled, messages } = await harness();
    try {
      const history = await messages();
      const older = text('written before Nod answered', '2026-01-01T00:00:00.000Z');
      const last = text('written last', sendTime(new Date(), history));
      outbox.restore([older, last], history);
      await settled();
      const sent = (await messages()).map((message) => message.id);
      assert.ok(sent.includes(last.id));
      assert.ok(!sent.includes(older.id));
      const [left] = outbox.items();
      assert.equal(left.id, older.id);
      assert.equal(left.status, 'failed');
    } finally {
      await server.stop();
    }
  });

  test('after a restart, a saved voice message that already arrived is not sent again', async () => {
    const { server, outbox, settled, messages } = await harness(['drop-response']);
    try {
      const item = voice();
      outbox.add(item);
      await settled();
      const reopened = createOutbox({
        thread: () => threadId,
        sendText: () => Promise.reject(new Error('unexpected text send')),
        sendAudio: () => Promise.reject(new Error('unexpected voice send')),
        arrived: () => Promise.resolve(false),
        stale: () => false,
        suspect: () => false,
        recover: () => Promise.resolve(),
        newId: randomUUID,
        later: (run) => void setTimeout(run, 0),
        onChange: () => {},
        onRefused: () => {},
        onDropped: () => {},
        onDelivered: () => {},
      });
      reopened.setOnline(true);
      reopened.restore([{ ...item, status: 'sending' }], await messages());
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(reopened.items().length, 0);
    } finally {
      await server.stop();
    }
  });

  test('Try again moves the message to the end of the chat and sends it', async () => {
    const { server, outbox, settled, voices, messages } = await harness([
      'busy',
      'busy',
      'busy',
      'busy',
    ]);
    try {
      const item = voice('2026-01-01T00:00:00.000Z');
      outbox.add(item);
      await settled();
      assert.equal(outbox.items()[0].status, 'failed');
      const now = sendTime(new Date(), await messages());
      outbox.retry(item.id, now);
      assert.equal(outbox.items()[0].createdAt, now);
      await settled();
      assert.equal((await voices()).length, 1);
    } finally {
      await server.stop();
    }
  });

  test('a message with an attachment reaches the server with that file', async () => {
    const { server, connection, outbox, settled, messages } = await harness();
    try {
      const file = await postUpload(
        connection,
        new Blob([new Uint8Array([37, 80, 68, 70])], { type: 'application/pdf' }),
        'Synthetic quote.pdf',
      );
      const item: Outgoing = { ...text('Here is the quote'), attachmentIds: [file.id] };
      outbox.add(item);
      await settled();
      const sent = (await messages()).find((message) => message.id === item.id);
      assert.deepEqual(
        sent?.attachments?.map((attachment) => attachment.name),
        ['Synthetic quote.pdf'],
      );
    } finally {
      await server.stop();
    }
  });
});
