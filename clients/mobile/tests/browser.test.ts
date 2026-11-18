import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { frameReader, maxFrameBytes, toBase64 } from '../src/browser/frames.ts';
import {
  clampZoom,
  pinchZoom,
  pointAt,
  queueInput,
  textEdits,
  unzoom,
  type HandoffInput,
} from '../src/browser/input.ts';

function framed(...frames: Uint8Array[]) {
  const parts = frames.flatMap((frame) => {
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, frame.length);
    return [header, frame];
  });
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function parse(chunks: Uint8Array[]) {
  const frames: number[][] = [];
  const read = frameReader((bytes) => frames.push([...bytes]));
  for (const chunk of chunks) read(chunk);
  return frames;
}

describe('browser frames', () => {
  const first = Uint8Array.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
  const second = Uint8Array.from({ length: 300 }, (_, index) => index % 256);
  const stream = framed(first, second, first);
  const expected = [[...first], [...second], [...first]];

  test('reads the same frames however the stream is split', () => {
    assert.deepEqual(parse([stream]), expected);
    for (const size of [1, 2, 3, 5, 7, 64])
      assert.deepEqual(
        parse(
          Array.from({ length: Math.ceil(stream.length / size) }, (_, index) =>
            stream.subarray(index * size, index * size + size),
          ),
        ),
        expected,
        `chunks of ${size}`,
      );
  });

  test('keeps a partial frame until the rest arrives', () => {
    const frames: Uint8Array[] = [];
    const read = frameReader((bytes) => frames.push(bytes));
    read(stream.subarray(0, 6));
    assert.equal(frames.length, 0);
    read(stream.subarray(6, 11));
    assert.equal(frames.length, 1);
  });

  test('refuses an empty or oversized frame', () => {
    const empty = new Uint8Array(4);
    assert.throws(() => frameReader(() => {})(empty), /Invalid browser frame/);
    const huge = new Uint8Array(4);
    new DataView(huge.buffer).setUint32(0, maxFrameBytes + 1);
    assert.throws(() => frameReader(() => {})(huge), /Invalid browser frame/);
    const largest = new Uint8Array(4);
    new DataView(largest.buffer).setUint32(0, maxFrameBytes);
    assert.doesNotThrow(() => frameReader(() => {})(largest));
  });

  test('encodes frames larger than one chunk as base64', () => {
    const bytes = Uint8Array.from({ length: 20_000 }, (_, index) => (index * 7) % 256);
    assert.equal(toBase64(bytes), Buffer.from(bytes).toString('base64'));
  });
});

describe('browser input', () => {
  test('keeps the latest move, sums scrolling and joins typing', () => {
    const queue: HandoffInput[] = [];
    queueInput(queue, { type: 'mouse', event: 'move', x: 0.1, y: 0.1 });
    queueInput(queue, { type: 'mouse', event: 'move', x: 0.2, y: 0.3 });
    queueInput(queue, { type: 'mouse', event: 'down', x: 0.2, y: 0.3, button: 'left' });
    queueInput(queue, { type: 'wheel', deltaX: 0, deltaY: 40 });
    queueInput(queue, { type: 'wheel', deltaX: -5, deltaY: 60 });
    queueInput(queue, { type: 'text', text: 'he' });
    queueInput(queue, { type: 'text', text: 'llo' });
    queueInput(queue, { type: 'key', key: 'Enter' });
    queueInput(queue, { type: 'mouse', event: 'move', x: 0.5, y: 0.5 });
    assert.deepEqual(queue, [
      { type: 'mouse', event: 'move', x: 0.2, y: 0.3 },
      { type: 'mouse', event: 'down', x: 0.2, y: 0.3, button: 'left' },
      { type: 'wheel', deltaX: -5, deltaY: 100 },
      { type: 'text', text: 'hello' },
      { type: 'key', key: 'Enter' },
      { type: 'mouse', event: 'move', x: 0.5, y: 0.5 },
    ]);
  });

  test('starts a new text input past 2000 characters', () => {
    const queue: HandoffInput[] = [];
    queueInput(queue, { type: 'text', text: 'a'.repeat(1990) });
    queueInput(queue, { type: 'text', text: 'b'.repeat(20) });
    assert.equal(queue.length, 2);
  });

  test('maps a tap to the page and ignores the letterbox', () => {
    const box = { width: 400, height: 600 };
    const page = { width: 1280, height: 800 };
    assert.deepEqual(pointAt({ x: 200, y: 300 }, box, page), { x: 0.5, y: 0.5 });
    assert.deepEqual(pointAt({ x: 0, y: 175 }, box, page), { x: 0, y: 0 });
    assert.deepEqual(pointAt({ x: 400, y: 425 }, box, page), { x: 1, y: 1 });
    assert.equal(pointAt({ x: 200, y: 100 }, box, page), null);
    assert.equal(pointAt({ x: 200, y: 500 }, box, page), null);
    const tall = { width: 400, height: 1600 };
    assert.deepEqual(pointAt({ x: 125, y: 300 }, box, tall), { x: 0, y: 0.5 });
    assert.equal(pointAt({ x: 50, y: 300 }, box, tall), null);
    assert.equal(pointAt({ x: 200, y: 300 }, box, { width: 0, height: 0 }), null);
  });

  test('a tap on the zoomed page clicks the spot under the finger', () => {
    const box = { width: 400, height: 600 };
    const page = { width: 1280, height: 800 };
    const zoomed = { scale: 2, x: 0, y: 0 };
    assert.deepEqual(pointAt(unzoom({ x: 200, y: 300 }, box, zoomed), box, page), {
      x: 0.5,
      y: 0.5,
    });
    assert.deepEqual(pointAt(unzoom({ x: 0, y: 300 }, box, zoomed), box, page), {
      x: 0.25,
      y: 0.5,
    });
    const moved = { scale: 2, x: 200, y: 0 };
    assert.deepEqual(pointAt(unzoom({ x: 200, y: 300 }, box, moved), box, page), {
      x: 0.25,
      y: 0.5,
    });
  });

  test('zoom stays between the whole page and four times, and the page never leaves the panel', () => {
    const box = { width: 400, height: 600 };
    const page = { width: 1280, height: 800 };
    assert.deepEqual(clampZoom({ scale: 0.5, x: 30, y: 30 }, box, page), { scale: 1, x: 0, y: 0 });
    assert.equal(clampZoom({ scale: 9, x: 0, y: 0 }, box, page).scale, 4);
    assert.deepEqual(clampZoom({ scale: 2, x: 999, y: 999 }, box, page), {
      scale: 2,
      x: 200,
      y: 0,
    });
  });

  test('a pinch zooms around the point between the fingers', () => {
    const box = { width: 400, height: 600 };
    const page = { width: 1280, height: 800 };
    const start = { scale: 1, x: 0, y: 0 };
    const view = pinchZoom(start, { x: 100, y: 300 }, 100, { x: 100, y: 300 }, 200, box, page);
    assert.equal(view.scale, 2);
    assert.deepEqual(
      pointAt(unzoom({ x: 100, y: 300 }, box, view), box, page),
      pointAt({ x: 100, y: 300 }, box, page),
    );
  });

  test('turns edits in the text bar into typing and backspaces', () => {
    assert.deepEqual(textEdits('he', 'hel'), [{ type: 'text', text: 'l' }]);
    assert.deepEqual(textEdits('hello', 'hel'), [
      { type: 'key', key: 'Backspace' },
      { type: 'key', key: 'Backspace' },
    ]);
    assert.deepEqual(textEdits('teh ', 'the '), [
      { type: 'key', key: 'Backspace' },
      { type: 'key', key: 'Backspace' },
      { type: 'key', key: 'Backspace' },
      { type: 'text', text: 'he ' },
    ]);
    assert.deepEqual(textEdits('a😀', 'a😁'), [
      { type: 'key', key: 'Backspace' },
      { type: 'text', text: '😁' },
    ]);
    assert.deepEqual(textEdits('same', 'same'), []);
  });
});
