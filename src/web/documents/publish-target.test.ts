// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { forcedMajorOf, type PublishFrom, sourceOf } from './publish-target.ts';
import { versionOf } from './test-support.ts';

// E18-S05, E18-S11: what a publish is made from, and when the kind of change is not a choice.

const DRAFT: PublishFrom = { type: 'draft', revision: 3 };
const FIRST_MAJOR = versionOf({ major: 1, minor: 2 });

test('a document with no version can only be published as a major one, whatever the text comes from', () => {
  expect(forcedMajorOf({ from: DRAFT, active: null })).toBe('first');
  expect(forcedMajorOf({ from: { type: 'version', versionId: 5, major: 1 }, active: null })).toBe('first');
});

test('a draft over an active version is a free choice', () => {
  expect(forcedMajorOf({ from: DRAFT, active: FIRST_MAJOR })).toBeUndefined();
});

test('a copy of a version of the active major is a free choice', () => {
  expect(forcedMajorOf({ from: { type: 'version', versionId: 5, major: 1 }, active: FIRST_MAJOR })).toBeUndefined();
});

test('a copy of a version of another major than the active one can only be a major one', () => {
  expect(forcedMajorOf({ from: { type: 'version', versionId: 5, major: 2 }, active: FIRST_MAJOR })).toBe('rollback');
  expect(forcedMajorOf({ from: { type: 'version', versionId: 5, major: 1 }, active: versionOf({ major: 2 }) })).toBe(
    'rollback',
  );
});

test('the source of the request names the revision of a draft or the id of a version, and never the major the screen knows', () => {
  expect(sourceOf(DRAFT)).toEqual({ type: 'draft', revision: 3 });
  expect(sourceOf({ type: 'version', versionId: 5, major: 2 })).toEqual({ type: 'version', versionId: 5 });
});
