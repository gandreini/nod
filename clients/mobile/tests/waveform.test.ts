import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { wavBars } from '../src/voice/waveform.ts';

function wav(samples: number[], rate = 16000) {
  const data = new Int16Array(samples.map((value) => Math.round(value * 32767)));
  const bytes = new Uint8Array(44 + data.byteLength);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) =>
    [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + data.byteLength, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, data.byteLength, true);
  bytes.set(new Uint8Array(data.buffer), 44);
  return bytes;
}

describe('waveform from a recording', () => {
  test('loud parts of the recording give taller bars than quiet parts', () => {
    const quiet = Array(8000)
      .fill(0)
      .map((_, index) => 0.02 * Math.sin(index / 5));
    const loud = Array(8000)
      .fill(0)
      .map((_, index) => 0.8 * Math.sin(index / 5));
    const bars = wavBars(wav([...quiet, ...loud]), 10)!;
    assert.equal(bars.length, 10);
    assert.ok(bars[9] > bars[0] * 3, `expected loud end, got ${bars.join(', ')}`);
    assert.ok(bars.every((bar) => bar > 0 && bar <= 1));
  });

  test('a file that is not 16-bit PCM WAV gives no waveform', () => {
    assert.equal(wavBars(new TextEncoder().encode('not audio at all'), 10), null);
    assert.equal(wavBars(new Uint8Array(0), 10), null);
  });
});
