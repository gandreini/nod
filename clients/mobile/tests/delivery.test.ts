import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test } from 'node:test';
import { getState, postAudio, postUpload, sendText } from '../src/connection/api.ts';
import type { Outgoing } from '../src/chat/chat-state.ts';
import type { Connection } from '../src/connection/connection.ts';
import { createOutbox } from '../src/chat/outbox.ts';
import { startFakeServer } from './fake-server.ts';

const threadId = '00000000-0000-4000-8000-000000000001';
const recording = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4, 5, 6, 7, 8]);

async function harness(faults: string[] = []) {
  const server = await startFakeServer();
  const connection: Connection = { origin: server.origin, token: server.token, owner: 'synthetic' };
  if (faults.length) await server.control('/fixture/audio-faults', { faults });
  const outbox = createOutbox({
    thread: () => threadId,
    sendText: (item, thread) =>
      sendText(connection, {
        id: item.id,
        text: item.text,
        threadId: thread,
        attachmentIds: item.attachmentIds,
      }),
    sendAudio: (_item, thread, sendId) =>
      postAudio(
        connection,
        { id: sendId, threadId: thread },
        new Blob([recording], { type: 'audio/wav' }),
        'voice.wav',
      ),
    arrived: (sendId) =>
      getState(connection).then((state) => state.messages.some((message) => message.id === sendId)),
    newId: randomUUID,
    later: (run) => void setTimeout(run, 0),
    onChange: () => {},
    onRefused: () => {},
    onDelivered: () => void getState(connection).then((state) => outbox.settle(state.messages)),
  });
  const settled = async () => {
    for (let round = 0; round < 200; round++) {
      if (!outbox.items().some((item) => item.status === 'sending')) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('The outbox did not settle.');
  };
  const voices = async () =>
    (await getState(connection)).messages.filter((message) =>
      message.attachments?.some((file) => file.mimeType === 'audio/wav'),
    );
  return { server, connection, outbox, settled, voices };
}

function voice(): Outgoing {
  return {
    id: randomUUID(),
    text: '',
    audio: {
      uri: 'file:///synthetic/voice.wav',
      mimeType: 'audio/wav',
      name: 'voice.wav',
      durationMillis: 1200,
    },
    status: 'sending',
    createdAt: new Date().toISOString(),
  };
}

describe('message delivery', () => {
  test('a voice message whose answer was lost on the way back is not sent twice', async () => {
    const { server, outbox, settled, voices } = await harness(['drop-response']);
    try {
      const item = voice();
      await outbox.add(item);
      await settled();
      const arrived = await voices();
      assert.equal(arrived.length, 1);
      assert.equal(arrived[0].id, item.id);
      assert.ok(outbox.items().every((entry) => entry.status === 'sent'));
    } finally {
      await server.stop();
    }
  });

  test('a voice message the server took but never finished arrives once under a new ID', async () => {
    const { server, outbox, settled, voices } = await harness(['abort-after-claim']);
    try {
      const item = voice();
      await outbox.add(item);
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
      await outbox.add(item);
      await settled();
      const arrived = await voices();
      assert.deepEqual(
        arrived.map((message) => message.id),
        [item.id],
      );
    } finally {
      await server.stop();
    }
  });

  test('a voice message the owner stopped is not sent again, even when the app comes back', async () => {
    const { server, outbox, settled, voices } = await harness(['cancel']);
    try {
      await outbox.add(voice());
      await settled();
      await outbox.revive();
      await settled();
      assert.equal((await voices()).length, 0);
      const [item] = outbox.items();
      assert.equal(item.status, 'failed');
      assert.equal(item.final, true);
      assert.match(item.error ?? '', /cancelled/);
    } finally {
      await server.stop();
    }
  });

  test('after a restart, a saved voice message that already arrived is not sent again', async () => {
    const { server, connection, outbox, settled, voices } = await harness(['drop-response']);
    try {
      const item = voice();
      await outbox.add(item);
      await settled();
      const saved: Outgoing = { ...item, status: 'sending' };
      const reopened = createOutbox({
        thread: () => threadId,
        sendText: () => Promise.reject(new Error('unexpected text send')),
        sendAudio: () => Promise.reject(new Error('unexpected voice send')),
        arrived: () => Promise.resolve(false),
        newId: randomUUID,
        later: (run) => void setTimeout(run, 0),
        onChange: () => {},
        onRefused: () => {},
        onDelivered: () => {},
      });
      const arrived = new Set((await getState(connection)).messages.map((message) => message.id));
      await reopened.restore([saved], arrived);
      assert.equal(reopened.items().length, 0);
      assert.equal((await voices()).length, 1);
    } finally {
      await server.stop();
    }
  });

  test('a message with an attachment reaches the server with that file', async () => {
    const { server, connection, outbox, settled } = await harness();
    try {
      const file = await postUpload(
        connection,
        new Blob([new Uint8Array([37, 80, 68, 70])], { type: 'application/pdf' }),
        'Synthetic quote.pdf',
      );
      const item: Outgoing = {
        id: randomUUID(),
        text: 'Here is the quote',
        attachmentIds: [file.id],
        status: 'sending',
        createdAt: new Date().toISOString(),
      };
      await outbox.add(item);
      await settled();
      const sent = (await getState(connection)).messages.find((message) => message.id === item.id);
      assert.deepEqual(
        sent?.attachments?.map((attachment) => attachment.name),
        ['Synthetic quote.pdf'],
      );
    } finally {
      await server.stop();
    }
  });
});
