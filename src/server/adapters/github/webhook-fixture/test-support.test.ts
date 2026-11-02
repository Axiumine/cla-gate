// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  ABSENT,
  FIXTURE_IDS,
  FIXTURE_SHA,
  prototypeNames,
  sorted,
  webhookFixture,
  withRawJson,
  withValue,
} from './test-support.ts';

// The helpers every payload test builds its hostile inputs with: a helper that silently did nothing would turn a
// hostile row into a plain valid delivery, so what they do is pinned here.

test('withValue replaces the value at a nested path and leaves the original alone', () => {
  const original = webhookFixture('pull_request');
  const changed = withValue(original, 'pull_request.head.sha', 'abc');
  expect(changed).toMatchObject({ pull_request: { head: { sha: 'abc' } } });
  expect(original).toMatchObject({ pull_request: { head: { sha: FIXTURE_SHA } } });
});

test('withValue with ABSENT removes the key, and with undefined leaves a key holding undefined', () => {
  const fixture = webhookFixture('check_run');
  expect(withValue(fixture, 'check_run.name', ABSENT)).not.toHaveProperty('check_run.name');
  expect(withValue(fixture, 'check_run.name', undefined)).toHaveProperty('check_run.name', undefined);
});

test.each(['nope.deeper.x', 'action.x', 'repository.id.x', 'sender.login.x.y'])(
  'withValue refuses the path %s: it does not lead to an object',
  (path) => {
    expect(() => withValue(webhookFixture('pull_request'), path, 1)).toThrow(`the fixture has no object at ${path}`);
  },
);

test('withRawJson writes the text it is given as it is, so 1e400 and a 20-digit integer survive', () => {
  const fixture = webhookFixture('pull_request');
  expect(withRawJson(fixture, 'repository.id', '1e400')).toContain('"id":1e400');
  expect(withRawJson(fixture, 'installation.id', '12345678901234567890')).toContain('"id":12345678901234567890');
  expect(withRawJson(fixture, 'action', '"$&$1"')).toContain('"action":"$&$1"');
  expect(JSON.parse(withRawJson(fixture, 'number', '[1]'))).toMatchObject({ number: [1] });
});

test('the fixtures use the fictitious ids and nothing else names an account', () => {
  expect(webhookFixture('pull_request')).toMatchObject({ installation: { id: FIXTURE_IDS.installation } });
  expect(webhookFixture('github_app_authorization')).toMatchObject({ sender: { id: FIXTURE_IDS.sender } });
});

test('sorted orders by text and prototypeNames lists the names of Object.prototype', () => {
  expect(sorted(['b', 'a', 'C'])).toEqual(['a', 'b', 'C']);
  expect(prototypeNames()).toContain('hasOwnProperty');
  expect(prototypeNames()).toContain('__proto__');
});
