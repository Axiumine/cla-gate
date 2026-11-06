// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { versionSummarySchema } from '../../../shared/cla-history.ts';
import { createTranslator } from '../../i18n/index.ts';
import { messages } from '../../i18n/messages.ts';
import { choiceOptions, defaultPair } from './compare-pair.ts';
import { HISTORY, V1_0, V1_1 } from './test-support.ts';

// E18-S11: what the comparison opens on, and what its two choices offer.

const t = createTranslator(messages, 'en');
const list = HISTORY.map((version) => versionSummarySchema.parse(version));
const [newest, middle, oldest] = list;

test('the default pair is the version before the active one against the active one', () => {
  expect(defaultPair(list)).toEqual({ from: V1_1.id, to: newest?.id });
});

test('when the active version is not the newest in the list, the pair is the one before it and it', () => {
  const moved = list.map((version) => ({ ...version, active: version.id === V1_1.id }));
  expect(defaultPair(moved)).toEqual({ from: V1_0.id, to: V1_1.id });
});

test('with no active version in the list the newest one stands for it', () => {
  expect(defaultPair(list.map((version) => ({ ...version, active: false })))).toEqual({
    from: V1_1.id,
    to: newest?.id,
  });
});

test.each([
  ['no version', []],
  ['one version', list.slice(0, 1)],
  ['the oldest version active and nothing older', list.slice(2).map((version) => ({ ...version, active: true }))],
])('with %s there is nothing to compare', (_what, versions) => {
  expect(defaultPair(versions)).toBeUndefined();
});

test('the options are the versions by number, the active one marked, in the order of the list', () => {
  expect(choiceOptions(list, [], t)).toEqual([
    { value: String(newest?.id), label: 'Version 2.0 (active)' },
    { value: String(middle?.id), label: 'Version 1.1' },
    { value: String(oldest?.id), label: 'Version 1.0' },
  ]);
});

test('a chosen version the list does not hold is offered by its id, once, after the others', () => {
  const options = choiceOptions(list, [999, middle?.id ?? 0, 999], t);
  expect(options).toHaveLength(4);
  expect(options.at(-1)).toEqual({ value: '999', label: 'Version with id 999' });
});
