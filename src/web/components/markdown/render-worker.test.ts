// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { renderClaTree } from '../../../shared/cla-markdown.ts';
import { RENDER_FAILED } from './render-protocol.ts';
import { answerRender } from './render-worker.ts';

// E18: the worker that renders a long CLA text. Importing the module registers its listener on `self`, which in jsdom is the window.

test('the answer to a text is the tree that renderClaTree makes of it', () => {
  expect(answerRender({ source: '# Terms\n\nThe *grant*.' })).toEqual({
    tree: renderClaTree('# Terms\n\nThe *grant*.'),
  });
});

test('a hostile text is answered with a tree that holds no script', () => {
  const answer = answerRender({ source: '<script>alert(1)</script>\n\n[x](javascript:alert(1))' });
  expect(JSON.stringify(answer)).not.toContain('"tagName":"script"');
  expect(JSON.stringify(answer)).not.toContain('javascript:');
});

test.each([
  ['a text that is not a request', '# Terms'],
  ['a request with no source', {}],
  ['a source that is not text', { source: 42 }],
  ['nothing', undefined],
])('%s is answered with the failure', (_what, message) => {
  expect(answerRender(message)).toBe(RENDER_FAILED);
});

test('a message to the worker is answered by a message from it', () => {
  const post = vi.spyOn(self, 'postMessage').mockImplementation(() => undefined);
  self.dispatchEvent(new MessageEvent('message', { data: { source: 'Plain text' } }));
  self.dispatchEvent(new MessageEvent('message', { data: 'not a request' }));
  expect(post).toHaveBeenCalledTimes(2);
  expect(post).toHaveBeenNthCalledWith(1, { tree: renderClaTree('Plain text') });
  expect(post).toHaveBeenNthCalledWith(2, RENDER_FAILED);
  post.mockRestore();
});
