import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { imageArtifact, safeLink } from '../src/links.ts';

const origin = 'https://nod.example.com';
const id = '0b6f8c1e-2a3d-4e5f-8a9b-0c1d2e3f4a5b';

describe('links in replies', () => {
  test('only web links open, never other schemes or links with credentials', () => {
    assert.deepEqual(safeLink('https://shop.example.org/item?id=7', origin), {
      kind: 'external',
      url: 'https://shop.example.org/item?id=7',
    });
    for (const href of [
      'tel:+390000000',
      'sms:+390000000?body=hi',
      'intent://x#Intent;end',
      'nod://settings',
      'javascript:alert(1)',
      'https://user:pass@example.org/',
      'https://example.org/a b',
      '',
    ])
      assert.equal(safeLink(href, origin), null, href);
  });

  test('server paths stay on the configured server', () => {
    assert.deepEqual(safeLink('/apps?connect=x', origin), {
      kind: 'server',
      url: 'https://nod.example.com/apps?connect=x',
    });
    assert.deepEqual(safeLink(`/api/artifacts/${id}`, origin), {
      kind: 'artifact',
      path: `/api/artifacts/${id}`,
      id,
    });
  });

  test('images load only from the server’s own files', () => {
    assert.equal(imageArtifact(`/api/artifacts/${id}`, origin)?.id, id);
    assert.equal(imageArtifact(`${origin}/api/artifacts/${id}`, origin)?.id, id);
    assert.equal(imageArtifact('https://attacker.example/p.png?d=secret', origin), null);
    assert.equal(imageArtifact(`https://other.example/api/artifacts/${id}`, origin), null);
    assert.equal(imageArtifact('/logos/gmail.svg', origin), null);
  });
});
