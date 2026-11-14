import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { fileBytes } from '../../../src/shared/files.ts';
import { attachmentIds, checkSize, sendable, type Draft } from '../src/attachments.ts';

function draft(id: string, state: Draft['state']): Draft {
  return {
    id,
    uri: `file:///cache/${id}.jpg`,
    name: `${id}.jpg`,
    mimeType: 'image/jpeg',
    size: 1000,
    state,
    ...(state === 'ready'
      ? {
          artifact: {
            id: `artifact-${id}`,
            name: `${id}.jpg`,
            mimeType: 'image/jpeg',
            size: 1000,
            url: `/api/artifacts/${id}`,
          },
        }
      : {}),
  };
}

describe('attachments', () => {
  test('a file over the server limit is refused before upload, naming the file and the limit', () => {
    assert.equal(checkSize({ name: 'small.pdf', size: fileBytes }), undefined);
    assert.equal(checkSize({ name: 'unknown.pdf' }), undefined);
    const problem = checkSize({ name: 'huge.mov', size: fileBytes + 1 });
    assert.match(problem ?? '', /huge\.mov/);
    assert.match(problem ?? '', /90 MB/);
  });

  test('a message waits for every attachment to finish uploading', () => {
    assert.equal(sendable('', []), false);
    assert.equal(sendable('hello', []), true);
    assert.equal(sendable('', [draft('a', 'ready')]), true);
    assert.equal(sendable('hello', [draft('a', 'ready'), draft('b', 'uploading')]), false);
    assert.equal(sendable('hello', [draft('a', 'failed')]), false);
  });

  test('only uploaded attachments are sent, in the order they were added', () => {
    assert.deepEqual(attachmentIds([draft('a', 'ready'), draft('b', 'ready')]), [
      'artifact-a',
      'artifact-b',
    ]);
  });
});
