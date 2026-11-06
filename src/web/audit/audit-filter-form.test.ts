// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { type FilterFormValues, parseFilterForm, valuesOf } from './audit-filter-form.ts';
import { NO_FILTERS } from './audit-filters.ts';

// E18-S09: the text of the audit filter form read into filters by zod. A field left empty is no filter, a field that holds something
// that is not a value is an error on that field, and a range that ends before it starts is an error on `to`.

const EMPTY: FilterFormValues = { action: '', actorGithubId: '', subjectType: '', subjectId: '', from: '', to: '' };

test('a form with nothing in it reads as the whole log', () => {
  expect(parseFilterForm(EMPTY)).toEqual({ ok: true, filters: NO_FILTERS });
});

test('every field is read: ids as numbers, dates and instants as canonical text, blanks around a value ignored', () => {
  const values = {
    action: ' signature.revoked ',
    actorGithubId: ' 4711 ',
    subjectType: ' signature ',
    subjectId: '9',
    from: '2026-11-01',
    to: '2026-11-02T09:30:00Z',
  };
  expect(parseFilterForm(values)).toEqual({
    ok: true,
    filters: {
      action: 'signature.revoked',
      actorGithubId: 4711,
      subjectType: 'signature',
      subjectId: 9,
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-11-02T09:30:00.000Z',
    },
  });
});

test.each([
  ['an action nobody has', { action: 'signature.exploded' }, 'action'],
  ['an actor that is a login', { actorGithubId: 'octocat' }, 'actorGithubId'],
  ['an actor of zero', { actorGithubId: '0' }, 'actorGithubId'],
  ['an actor with a leading zero', { actorGithubId: '04711' }, 'actorGithubId'],
  ['an actor with a sign', { actorGithubId: '+4711' }, 'actorGithubId'],
  ['an actor beyond a safe integer', { actorGithubId: '99999999999999999999' }, 'actorGithubId'],
  ['a subject type in capitals', { subjectType: 'Signature' }, 'subjectType'],
  ['a subject id with a decimal', { subjectId: '1.5' }, 'subjectId'],
  ['a start with an offset', { from: '2026-11-01T09:30:00+02:00' }, 'from'],
  ['an end that is not a date', { to: 'tomorrow' }, 'to'],
])('%s is an error on its field, and on no other', (_what, change, field) => {
  expect(parseFilterForm({ ...EMPTY, ...change })).toEqual({ ok: false, errors: new Map([[field, 'invalid']]) });
});

test.each([
  ['1', 1],
  ['2', 2],
  ['9', 9],
  ['10', 10],
  ['1234', 1234],
  ['19', 19],
  ['9007199254740991', Number.MAX_SAFE_INTEGER],
])('the id %s is read as a number in the actor and in the subject, whatever its first digit', (text, id) => {
  expect(parseFilterForm({ ...EMPTY, actorGithubId: text })).toEqual({
    ok: true,
    filters: { ...NO_FILTERS, actorGithubId: id },
  });
  expect(parseFilterForm({ ...EMPTY, subjectId: text })).toEqual({
    ok: true,
    filters: { ...NO_FILTERS, subjectId: id },
  });
});

test('an end earlier than the start is an error on the end', () => {
  expect(parseFilterForm({ ...EMPTY, from: '2026-11-02', to: '2026-11-01' })).toEqual({
    ok: false,
    errors: new Map([['to', 'before_from']]),
  });
});

test('an end the same as the start is accepted: the range is empty, not backwards', () => {
  expect(parseFilterForm({ ...EMPTY, from: '2026-11-01', to: '2026-11-01' }).ok).toBe(true);
});

test('an end that is not a date is the problem of the end alone, and the range is not judged', () => {
  expect(parseFilterForm({ ...EMPTY, from: '2026-11-02', to: 'tomorrow' })).toEqual({
    ok: false,
    errors: new Map([['to', 'invalid']]),
  });
});

test('every field with a problem is reported at once', () => {
  const parsed = parseFilterForm({ ...EMPTY, actorGithubId: 'x', subjectId: 'y', from: 'z' });
  expect(parsed).toEqual({
    ok: false,
    errors: new Map([
      ['actorGithubId', 'invalid'],
      ['subjectId', 'invalid'],
      ['from', 'invalid'],
    ]),
  });
});

test('the filters of an address are the text of the fields, each value in the shortest form that is read back as it was', () => {
  const filters = {
    action: 'signature.revoked',
    actorGithubId: 4711,
    subjectType: 'signature',
    subjectId: 9,
    from: '2026-11-01T00:00:00.000Z',
    to: '2026-11-02T09:30:00.000Z',
  } as const;
  const values = valuesOf(filters);
  expect(values).toEqual({
    action: 'signature.revoked',
    actorGithubId: '4711',
    subjectType: 'signature',
    subjectId: '9',
    from: '2026-11-01',
    to: '2026-11-02T09:30:00Z',
  });
  expect(parseFilterForm(values)).toEqual({ ok: true, filters });
});

test('no filter is empty fields', () => {
  expect(valuesOf(NO_FILTERS)).toEqual(EMPTY);
});
