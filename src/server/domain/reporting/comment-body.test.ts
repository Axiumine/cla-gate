// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { COMMENT_MARKER, disabledCommentBody } from './comment-body.ts';

// E09-S06: the comment of a repository whose enforcement is off is the marker line and the one-line notice, and nothing else.

test('the marker is the fixed line that names the check and the version', () => {
  expect(COMMENT_MARKER).toBe('<!-- cla-platform:license/cla:v1 -->');
});

test('the disabled body is the marker line, then the one-line notice, and holds the marker once', () => {
  const body = disabledCommentBody();
  expect(body).toBe('<!-- cla-platform:license/cla:v1 -->\nCLA enforcement is disabled for this repository.');
  expect(body.split(COMMENT_MARKER)).toHaveLength(2);
  expect(body.split('\n')).toHaveLength(2);
});
