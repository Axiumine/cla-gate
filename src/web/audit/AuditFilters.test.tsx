// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { act, screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { AUDIT_ACTIONS } from '../../shared/audit.ts';
import { createTranslator, messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { watchDefault } from '../test-support/default-prevented.ts';
import {
  AUDIT_ROUTE,
  actionSelect,
  actorField,
  applyButton,
  auditTable,
  clearButton,
  eventOf,
  fromField,
  openAudit,
  pageOf,
  paramsOf,
  rowsOf,
  subjectIdField,
  subjectTypeField,
  toField,
} from './test-support.ts';

const t = createTranslator(messages, 'en');

// E18-S09: the filters of the audit log: one action, the numeric id of the actor, the kind and the id of the subject, and a range in UTC.
// They are applied together, they live in the address, and a value that is not one is an error on its field and asks for nothing.

const FILTERED =
  '?action=signature.revoked&actorGithubId=4711&subjectType=signature&subjectId=9&from=2026-11-01&to=2026-11-02';

test('the filters are a search landmark with the action, the actor, the subject type, the subject id, and the two ends of the range', async () => {
  const { container } = await openAudit();
  const search = container.querySelector('search');
  expect(search).toHaveAttribute('aria-label', messages['audit.filter.label']);
  if (search === null) {
    throw new Error('the filters are not in a search landmark');
  }
  expect(within(search).getAllByRole('combobox')).toEqual([actionSelect()]);
  expect(within(search).getAllByRole('textbox')).toEqual([
    actorField(),
    subjectTypeField(),
    subjectIdField(),
    fromField(),
    toField(),
  ]);
  expect(
    within(search)
      .getAllByRole('button')
      .map((button) => button.textContent),
  ).toEqual([messages['audit.filter.apply']]);
});

test('the action select has "All actions", then the label of every action of the catalogue, sorted by label', async () => {
  await openAudit();
  const options = within(actionSelect()).getAllByRole('option');
  expect(options[0]).toHaveTextContent(messages['audit.filter.action.all']);
  expect(options[0]).toHaveValue('');
  const labels = options.slice(1).map((option) => option.textContent);
  expect(labels).toHaveLength(AUDIT_ACTIONS.length);
  expect(labels).toEqual(labels.toSorted((a, b) => a.localeCompare(b)));
  expect(options.slice(1).map((option) => option.getAttribute('value'))).toEqual(
    expect.arrayContaining([...AUDIT_ACTIONS]),
  );
});

test('every field shows its help, so the format is known before it is wrong', async () => {
  await openAudit();
  for (const help of [
    'audit.filter.actor.help',
    'audit.filter.subjectType.help',
    'audit.filter.subjectId.help',
    'audit.filter.from.help',
    'audit.filter.to.help',
  ] as const) {
    expect(screen.getByText(t(help))).toBeInTheDocument();
  }
  expect(actorField()).toHaveAccessibleDescription(messages['audit.filter.actor.help']);
});

test('choosing an action and applying puts it in the address and asks for it, from the first page', async () => {
  const watch = watchDefault('submit');
  const { served, user } = await openAudit();
  await user.selectOptions(actionSelect(), 'signature.revoked');
  expect(served.log).toHaveLength(1);
  await user.click(applyButton());
  await waitFor(() => {
    expect(served.log).toHaveLength(2);
  });
  expect(paramsOf(served.log[1])).toEqual({ limit: '50', action: 'signature.revoked' });
  expect(window.location.search).toBe('?action=signature.revoked');
  expect(watch.prevented).toEqual([true]);
});

test('every filter at once is asked for as one request, the ids as numbers and the range as UTC instants', async () => {
  const { served, user } = await openAudit();
  await user.selectOptions(actionSelect(), 'signature.revoked');
  await user.type(actorField(), '4711');
  await user.type(subjectTypeField(), 'signature');
  await user.type(subjectIdField(), '9');
  await user.type(fromField(), '2026-11-01');
  await user.type(toField(), '2026-11-02T09:30:00Z');
  await user.click(applyButton());
  await waitFor(() => {
    expect(served.log).toHaveLength(2);
  });
  expect(paramsOf(served.log[1])).toEqual({
    limit: '50',
    action: 'signature.revoked',
    actorGithubId: '4711',
    subjectType: 'signature',
    subjectId: '9',
    from: '2026-11-01T00:00:00.000Z',
    to: '2026-11-02T09:30:00.000Z',
  });
  expect(window.location.search).toBe(
    '?action=signature.revoked&actorGithubId=4711&subjectType=signature&subjectId=9&from=2026-11-01T00%3A00%3A00.000Z&to=2026-11-02T09%3A30%3A00.000Z',
  );
});

test('Enter in a field applies the filters, with no button pressed', async () => {
  const { served, user } = await openAudit();
  await user.type(actorField(), '4711{Enter}');
  await waitFor(() => {
    expect(served.log).toHaveLength(2);
  });
  expect(paramsOf(served.log[1])).toEqual({ limit: '50', actorGithubId: '4711' });
});

test('blanks around a value are ignored, and a field left empty is no filter', async () => {
  const { served, user } = await openAudit();
  await user.type(actorField(), '  4711  ');
  await user.type(subjectTypeField(), '   ');
  await user.click(applyButton());
  await waitFor(() => {
    expect(served.log).toHaveLength(2);
  });
  expect(paramsOf(served.log[1])).toEqual({ limit: '50', actorGithubId: '4711' });
});

test('the address fills the fields, and the first request carries the same filters', async () => {
  const { served } = await openAudit(`${AUDIT_ROUTE}${FILTERED}`);
  expect(actionSelect()).toHaveValue('signature.revoked');
  expect(actorField()).toHaveValue('4711');
  expect(subjectTypeField()).toHaveValue('signature');
  expect(subjectIdField()).toHaveValue('9');
  expect(fromField()).toHaveValue('2026-11-01');
  expect(toField()).toHaveValue('2026-11-02');
  expect(served.log).toHaveLength(1);
  expect(paramsOf(served.log[0])).toEqual({
    limit: '50',
    action: 'signature.revoked',
    actorGithubId: '4711',
    subjectType: 'signature',
    subjectId: '9',
    from: '2026-11-01T00:00:00.000Z',
    to: '2026-11-02T00:00:00.000Z',
  });
});

test.each([
  ['an action nobody has', 'action=signature.exploded'],
  ['an actor that is a login', 'actorGithubId=octocat'],
  ['an actor of zero', 'actorGithubId=0'],
  ['a subject type in capitals', 'subjectType=Signature'],
  ['a subject id with a decimal', 'subjectId=1.5'],
  ['a start with an offset', 'from=2026-11-01T09:30:00%2B02:00'],
  ['an end that is not a date', 'to=tomorrow'],
])('an address with %s is read as if it had no such filter', async (_what, query) => {
  const { served } = await openAudit(`${AUDIT_ROUTE}?${query}`);
  expect(paramsOf(served.log[0])).toEqual({ limit: '50' });
  expect(actorField()).toHaveValue('');
  expect(screen.queryByRole('button', { name: messages['audit.filter.clear'] })).toBeNull();
});

test('a range that ends before it starts in the address keeps its start and drops its end', async () => {
  const { served } = await openAudit(`${AUDIT_ROUTE}?from=2026-11-02&to=2026-11-01`);
  expect(paramsOf(served.log[0])).toEqual({ limit: '50', from: '2026-11-02T00:00:00.000Z' });
  expect(toField()).toHaveValue('');
});

test('an end earlier than the start is an error on the end field, asks for nothing, and keeps what was typed', async () => {
  const { served, user } = await openAudit();
  await user.type(fromField(), '2026-11-02');
  await user.type(toField(), '2026-11-01');
  await user.click(applyButton());
  const error = await screen.findByText(messages['audit.filter.to.beforeFrom']);
  expect(error).toHaveAttribute('role', 'alert');
  expect(toField()).toHaveAccessibleDescription(expect.stringContaining(messages['audit.filter.to.beforeFrom']));
  expect(toField()).toBeInvalid();
  expect(fromField()).toBeValid();
  expect(toField()).toHaveValue('2026-11-01');
  expect(fromField()).toHaveValue('2026-11-02');
  expect(served.log).toHaveLength(1);
  expect(window.location.search).toBe('');
});

test.each([
  ['an actor that is a login', actorField, 'octocat', 'audit.filter.actor.invalid'],
  ['an actor with a leading zero', actorField, '04711', 'audit.filter.actor.invalid'],
  ['a subject type in capitals', subjectTypeField, 'Signature', 'audit.filter.subjectType.invalid'],
  ['a subject id of zero', subjectIdField, '0', 'audit.filter.subjectId.invalid'],
  ['a start with an offset', fromField, '2026-11-01T09:30:00+02:00', 'audit.filter.instant.invalid'],
  ['a start that is not a date', fromField, 'yesterday', 'audit.filter.instant.invalid'],
  ['an end that is not a date', toField, '2026-02-30', 'audit.filter.instant.invalid'],
] as const)('%s is an error on its field and asks for nothing', async (_what, field, text, message) => {
  const { served, user } = await openAudit();
  await user.type(field(), text);
  await user.click(applyButton());
  expect(await screen.findByText(t(message))).toHaveAttribute('role', 'alert');
  expect(field()).toBeInvalid();
  expect(field()).toHaveValue(text);
  expect(served.log).toHaveLength(1);
});

test('fixing the field and applying again clears the error and asks', async () => {
  const { served, user } = await openAudit();
  await user.type(actorField(), 'octocat');
  await user.click(applyButton());
  await screen.findByText(messages['audit.filter.actor.invalid']);
  await user.clear(actorField());
  await user.type(actorField(), '4711');
  await user.click(applyButton());
  await waitFor(() => {
    expect(served.log).toHaveLength(2);
  });
  expect(screen.queryByText(messages['audit.filter.actor.invalid'])).toBeNull();
  expect(paramsOf(served.log[1])).toEqual({ limit: '50', actorGithubId: '4711' });
});

test('every bad field is reported at once', async () => {
  const { user } = await openAudit();
  await user.type(actorField(), 'x');
  await user.type(subjectIdField(), 'y');
  await user.type(fromField(), 'z');
  await user.click(applyButton());
  expect(await screen.findAllByRole('alert')).toHaveLength(3);
});

test('"Clear filters" is there only while a filter is applied, and clears the address, the fields and the request', async () => {
  const { served, user } = await openAudit(`${AUDIT_ROUTE}${FILTERED}`);
  await user.click(clearButton());
  await waitFor(() => {
    expect(served.log).toHaveLength(2);
  });
  expect(paramsOf(served.log[1])).toEqual({ limit: '50' });
  expect(window.location.search).toBe('');
  expect(actionSelect()).toHaveValue('');
  expect(actorField()).toHaveValue('');
  expect(toField()).toHaveValue('');
  expect(screen.queryByRole('button', { name: messages['audit.filter.clear'] })).toBeNull();
});

test('the Back button of the browser returns to the filters of the address before, in the fields and in the list', async () => {
  const { served, user } = await openAudit();
  await user.type(actorField(), '4711{Enter}');
  await waitFor(() => {
    expect(served.log).toHaveLength(2);
  });
  expect(actorField()).toHaveValue('4711');
  act(() => {
    window.history.back();
  });
  await waitFor(() => {
    expect(actorField()).toHaveValue('');
  });
  expect(window.location.search).toBe('');
  expect(paramsOf(served.log.at(-1))).toEqual({ limit: '50' });
});

test('a filter that finds nothing says so, and not that nothing was recorded', async () => {
  const { user } = await openAudit(AUDIT_ROUTE, { log: [pageOf([eventOf()]), pageOf([])] });
  await user.type(actorField(), '9999{Enter}');
  expect(
    await screen.findByRole('heading', { level: 3, name: messages['audit.empty.filtered.title'] }),
  ).toBeInTheDocument();
  expect(screen.getByText('No audit events match these filters')).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.getByText(messages['audit.empty.filtered.description'])).toBeInTheDocument();
});

test('applying new filters on a later page asks for the first page of the new filters', async () => {
  const pages = new Map<string | null, () => Response>([
    [null, () => pageOf([eventOf({ id: 3 })], 'c2')],
    ['c2', () => pageOf([eventOf({ id: 2 })])],
  ]);
  const { served, user } = await openAudit(`${AUDIT_ROUTE}?cursor=c2`, { pages });
  expect(served.log).toHaveLength(1);
  await user.type(actorField(), '4711{Enter}');
  await waitFor(() => {
    expect(served.log).toHaveLength(2);
  });
  expect(paramsOf(served.log[1])).toEqual({ limit: '50', actorGithubId: '4711' });
  expect(window.location.search).toBe('?actorGithubId=4711');
  expect(rowsOf(auditTable()).map((cells) => cells[0]?.slice(-1))).toEqual(['3']);
});

test('the keyboard reaches the fields in order, then Apply', async () => {
  const { user } = await openAudit();
  await user.click(actionSelect());
  expect(actionSelect()).toHaveFocus();
  for (const field of [actorField(), subjectTypeField(), subjectIdField(), fromField(), toField(), applyButton()]) {
    await user.tab();
    expect(field).toHaveFocus();
  }
});

test('the filters pass axe, with every field in error as well', async () => {
  const { user, container } = await openAudit(`${AUDIT_ROUTE}${FILTERED}`);
  await expectNoA11yViolations(container);
  await user.clear(actorField());
  await user.type(actorField(), 'x');
  await user.clear(subjectIdField());
  await user.type(subjectIdField(), 'y');
  await user.clear(toField());
  await user.type(toField(), '2020-01-01');
  await user.click(applyButton());
  await screen.findAllByRole('alert');
  await expectNoA11yViolations(container);
});
