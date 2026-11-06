// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { RENDER_FAILED } from './render-protocol.ts';
import { answerRender } from './render-worker.ts';

// E18: a render that throws (a stack overflow, say) is the failure, and not an error that ends the worker silently.

vi.mock('../../../shared/cla-markdown.ts', () => ({
  renderClaTree: () => {
    throw new RangeError('Maximum call stack size exceeded');
  },
}));

test('a render that throws is answered with the failure', () => {
  expect(answerRender({ source: '# Terms' })).toBe(RENDER_FAILED);
});
