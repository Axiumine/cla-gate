// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { envelope } from '../../api/test-support.ts';
import { messages } from '../../i18n/index.ts';
import { expectNoA11yViolations } from '../../test-support/a11y.ts';
import { address, HISTORY, openHistory, pageOf, rowOf, V1_0, V1_1, versionsTable } from './test-support.ts';

// E18-S11: the list of versions of the History tab: newest first, what each row shows, that nothing on a version edits or deletes it,
// and the pager.

const numbers = () =>
  within(versionsTable())
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.querySelector('td')?.textContent);

test('the History tab lists the versions newest first, and asks for that list of this tenant and this document, 50 to a page', async () => {
  const { served } = await openHistory();
  expect(numbers()).toEqual(['2.0', '1.1', '1.0']);
  expect(served.list.map((seen) => new URL(seen.url).pathname + new URL(seen.url).search)).toEqual([
    '/api/installations/5/documents/11/versions?limit=50',
  ]);
  expect(screen.getByRole('tab', { name: messages['document.tabs.history'] })).toHaveAttribute('aria-selected', 'true');
});

test('a row shows the number, the time in UTC, who published it, why, the first 12 characters of the hash, the signatures and no badge', async () => {
  await openHistory();
  const cells = Array.from(rowOf('1.1').querySelectorAll('td'));
  expect(cells[0]).toHaveTextContent('1.1');
  expect(cells[1]).toHaveTextContent('2026-09-20 09:00 UTC');
  expect(cells[1]?.querySelector('time')).toHaveAttribute('datetime', '2026-09-20T09:00:00.000Z');
  expect(cells[2]).toHaveTextContent('hubot');
  expect(cells[3]).toHaveTextContent('Fixed a typo');
  expect(cells[4]?.querySelector('code')?.textContent).toBe('b'.repeat(12));
  expect(cells[5]).toHaveTextContent('12');
  expect(cells[6]?.textContent).toBe('');
});

test('only the active version has the Active badge', async () => {
  await openHistory();
  const badges = within(versionsTable()).getAllByText(messages['status.active']);
  expect(badges).toHaveLength(1);
  expect(rowOf('2.0')).toContainElement(badges[0] ?? null);
});

test('the id of who published is in code, and a screen reader is told what the number is', async () => {
  await openHistory();
  const by = rowOf('2.0').querySelectorAll('td')[2];
  expect(by?.querySelector('code')?.textContent).toBe('4711');
  expect(by?.textContent).toBe(`octocat ${messages['history.publishedBy.id']} 4711`);
});

test('a row has one control, "View", which names its version, and nothing on a version edits or deletes it', async () => {
  await openHistory();
  const controls = within(versionsTable()).getAllByRole('button');
  expect(controls.map((control) => control.getAttribute('aria-label'))).toEqual([
    'View version 2.0',
    'View version 1.1',
    'View version 1.0',
  ]);
  const others = ['textbox', 'checkbox', 'combobox', 'link', 'switch', 'radio'].flatMap((role) =>
    within(versionsTable()).queryAllByRole(role),
  );
  expect(others).toEqual([]);
  expect(screen.queryByRole('button', { name: /edit|delete|remove|rename|revoke/i })).toBeNull();
});

test('a document with no version yet says so, and tells what to do', async () => {
  await openHistory({
    history: { versions: [], list: [pageOf([])] },
    ready: () => screen.findByText(messages['history.empty.title']),
  });
  expect(screen.queryByRole('table', { name: messages['history.caption'] })).toBeNull();
  expect(screen.getByText(messages['history.empty.description'])).toBeInTheDocument();
});

test('a failed first load is the error state with the request id, and "Try again" asks again', async () => {
  const { user, served } = await openHistory({
    history: { list: [envelope(500, 'internal_server_error'), pageOf(HISTORY)] },
    ready: () => screen.findByText(messages['errors.internal_server_error']),
  });
  expect(screen.getByText(/req-00000001/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: messages['states.retry'] }));
  expect(await screen.findByRole('table', { name: messages['history.caption'] })).toBeInTheDocument();
  expect(served.list).toHaveLength(2);
});

test('a 403 is the forbidden state, with no retry and none of the list', async () => {
  await openHistory({
    history: { list: [envelope(403, 'forbidden')] },
    ready: () => screen.findByText(messages['states.forbidden.title']),
  });
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByRole('button', { name: messages['states.retry'] })).toBeNull();
});

test('the uniform 404 of a document of another tenant is the error state, and not an empty list', async () => {
  await openHistory({
    history: { list: [envelope(404, 'not_found')] },
    ready: () => screen.findByText(messages['errors.not_found']),
  });
  expect(screen.queryByText(messages['history.empty.title'])).toBeNull();
});

test('Next puts the cursor of the server in the address and asks for that page; Previous goes back', async () => {
  const { user, served } = await openHistory({
    history: { list: [pageOf([HISTORY[0] ?? V1_1], 'c2'), pageOf([V1_0])] },
  });
  expect(numbers()).toEqual(['2.0']);
  await user.click(screen.getByRole('button', { name: messages['pager.next'] }));
  await waitFor(() => {
    expect(numbers()).toEqual(['1.0']);
  });
  expect(address()).toBe('/installations/5/documents/11?tab=history&cursor=c2');
  expect(new URL(served.list.at(-1)?.url ?? '').searchParams.get('cursor')).toBe('c2');
  expect(screen.getByRole('button', { name: messages['pager.next'] })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: messages['pager.previous'] }));
  await waitFor(() => {
    expect(address()).toBe('/installations/5/documents/11?tab=history');
  });
});

test('a cursor in the address that the server refuses is answered with the first page, and the address is cleaned', async () => {
  await openHistory({
    route: '/installations/5/documents/11?tab=history&cursor=tampered',
    history: { list: [envelope(400, 'bad_request'), pageOf(HISTORY)] },
  });
  expect(numbers()).toEqual(['2.0', '1.1', '1.0']);
  expect(address()).toBe('/installations/5/documents/11?tab=history');
});

test('the History tab passes axe', async () => {
  const { container } = await openHistory();
  await expectNoA11yViolations(container);
});
