import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { conversationFiles, fileView } from '../src/files/files.ts';

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const file = (n: number, name: string, mimeType: string, size = 100) => ({
  id: id(n),
  name,
  mimeType,
  size,
  url: `/api/artifacts/${id(n)}`,
});

describe('file viewer', () => {
  test('HTML, SVG and XML are only ever shown as source text', () => {
    assert.equal(fileView(file(1, 'page.html', 'text/html')), 'text');
    assert.equal(fileView(file(2, 'logo.svg', 'image/svg+xml')), 'text');
    assert.equal(fileView(file(3, 'feed', 'application/xml')), 'text');
    assert.equal(fileView(file(4, 'page.htm', 'text/plain')), 'text');
    assert.equal(fileView(file(5, 'huge.html', 'text/html', 50_000_000)), 'outside');
  });

  test('the list keeps conversation order, once per file, without voice clips or outside links', () => {
    const notes = file(1, 'notes.md', 'text/markdown');
    const photo = file(2, 'photo.jpg', 'image/jpeg');
    const voice = file(3, 'voice.wav', 'audio/wav');
    const outside = { ...file(4, 'x.png', 'image/png'), url: 'https://example.com/x.png' };
    const files = conversationFiles([
      { attachments: [notes, voice] },
      { attachments: [photo, outside] },
      { attachments: [notes] },
    ]);
    assert.deepEqual(
      files.map((item) => item.name),
      ['notes.md', 'photo.jpg'],
    );
  });
});
