// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { envelope } from '../../api/test-support.ts';
import { messages } from '../../i18n/index.ts';
import { expectNoA11yViolations } from '../../test-support/a11y.ts';
import { unreachableByTab } from '../../test-support/route-checks.ts';
import {
  address,
  comparison,
  diffList,
  HISTORY,
  historyVersion,
  openHistory,
  pageOf,
  V1_0,
  V1_1,
  versionsTable,
} from './test-support.ts';

// E18-S11: "Compare" takes two versions from two selects (default: the active against the one before it) and shows a line diff of their
// texts, computed in the browser. The pair is in the address.

const COMPARE_ROUTE = '/installations/5/documents/11?tab=history&compare=true';
const from = () => screen.getByRole<HTMLSelectElement>('combobox', { name: messages['history.compare.from'] });
const to = () => screen.getByRole<HTMLSelectElement>('combobox', { name: messages['history.compare.to'] });
const compareButton = () => screen.getByRole('button', { name: messages['history.compare'] });

/** The lines of the diff as `mark word text`, the mark and the word being what a sighted user and a screen reader get. */
function linesOf(list: HTMLElement): string[] {
  return within(list)
    .getAllByRole('listitem')
    .map((item) => {
      const mark = item.querySelector('[aria-hidden="true"]')?.textContent ?? '';
      const word = item.querySelector('.sr-only')?.textContent ?? '';
      return [mark, word, item.lastElementChild?.textContent ?? ''].join('|');
    });
}

/** `count` lines of text that both versions share. */
const shared = (count: number) =>
  Array.from({ length: count }, (_, index) => `Zzzz shared ${String(index + 1)}\n`).join('');

/** A history whose two newest versions differ in their last line only, with `count` lines between the heading and it. */
const around = (count: number) => ({
  versions: [
    historyVersion({ contentMd: `# Head\n${shared(count)}New ending\n` }),
    { ...V1_1, contentMd: `# Head\n${shared(count)}Old ending\n` },
    V1_0,
  ],
});

test('"Compare versions" opens the comparison on the active version against the one before it, and puts that in no more than the address', async () => {
  const { user } = await openHistory();
  await user.click(compareButton());
  const region = await comparison();
  expect(address()).toBe('/installations/5/documents/11?tab=history&compare=true');
  await within(region).findByRole('list');
  expect(from().value).toBe(String(V1_1.id));
  expect(to().value).toBe('303');
  expect(Array.from(from().options).map((option) => option.textContent)).toEqual([
    'Version 2.0 (active)',
    'Version 1.1',
    'Version 1.0',
  ]);
});

test('added and removed lines carry + or - and a visually hidden word, and unchanged lines carry neither', async () => {
  await openHistory({ route: COMPARE_ROUTE });
  const list = await diffList('1.1', '2.0');
  expect(linesOf(list)).toEqual(['||# Zzzz agreement', '||', '-|Removed:|One point one.', '+|Added:|Two point oh.']);
});

test('the comparison reads the text of the two versions of this document and tenant, and asks for nothing else of the history', async () => {
  const { served } = await openHistory({ route: COMPARE_ROUTE });
  await diffList('1.1', '2.0');
  const reads = served.read.map((seen) => new URL(seen.url).pathname);
  expect(reads).toContain('/api/installations/5/documents/11/versions/302');
  expect(reads).toContain('/api/installations/5/documents/11/versions/303');
  expect(reads).not.toContain('/api/installations/5/documents/11/versions/301');
  const lists = served.list.map((seen) => new URL(seen.url).searchParams.get('limit'));
  expect(lists).toContain('100');
});

test('choosing another version changes the address and the diff, and keeps the other side', async () => {
  const { user } = await openHistory({ route: COMPARE_ROUTE });
  await diffList('1.1', '2.0');
  await user.selectOptions(from(), String(V1_0.id));
  const list = await diffList('1.0', '2.0');
  expect(address()).toBe(`/installations/5/documents/11?tab=history&compare=true&from=301&to=303`);
  expect(linesOf(list)).toContain('-|Removed:|One point oh.');
  expect(to().value).toBe('303');
  await user.selectOptions(to(), '302');
  await diffList('1.0', '1.1');
  expect(address()).toBe(`/installations/5/documents/11?tab=history&compare=true&from=301&to=302`);
});

test('a pair in the address is the pair compared, whatever the default would be', async () => {
  await openHistory({ route: `${COMPARE_ROUTE}&from=301&to=302` });
  await diffList('1.0', '1.1');
  expect(from().value).toBe('301');
  expect(to().value).toBe('302');
});

test.each([
  ['a from that is text', 'from=abc&to=301'],
  ['a to that is zero', 'from=301&to=0'],
  ['a to that is negative', 'from=301&to=-5'],
  ['a from alone', 'from=301'],
  ['a to alone', 'to=301'],
])('%s falls back to the default pair', async (_what, params) => {
  await openHistory({ route: `${COMPARE_ROUTE}&${params}` });
  await diffList('1.1', '2.0');
  expect(from().value).toBe('302');
  expect(to().value).toBe('303');
});

test('the same version on both sides shows "No differences"', async () => {
  await openHistory({ route: `${COMPARE_ROUTE}&from=302&to=302` });
  expect(await screen.findByText(messages['history.compare.same'])).toBeInTheDocument();
  expect(screen.queryByRole('list', { name: /Lines that differ/ })).toBeNull();
});

test('two versions with the same text show "No differences"', async () => {
  const same = { ...V1_1, contentMd: historyVersion().contentMd };
  await openHistory({ route: COMPARE_ROUTE, history: { versions: [historyVersion(), same, V1_0] } });
  expect(await screen.findByText(messages['history.compare.same'])).toBeInTheDocument();
});

test('unchanged lines in a run of seven fold into a group that opens and closes, and a run of six stays', async () => {
  const { user } = await openHistory({ route: COMPARE_ROUTE, history: around(7) });
  const list = await diffList('1.1', '2.0');
  const toggle = within(list).getByRole('button', { name: 'Show 8 unchanged lines' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(within(list).queryByText('Zzzz shared 3')).toBeNull();
  await user.click(toggle);
  const open = within(list).getByRole('button', { name: 'Hide 8 unchanged lines' });
  expect(open).toHaveAttribute('aria-expanded', 'true');
  expect(open.getAttribute('aria-controls')).toBe(within(list).getByText('Zzzz shared 3').closest('ul')?.id);
  await user.click(open);
  expect(within(list).queryByText('Zzzz shared 3')).toBeNull();
});

test('a run of six unchanged lines is shown as lines, with no group', async () => {
  await openHistory({ route: COMPARE_ROUTE, history: around(5) });
  const list = await diffList('1.1', '2.0');
  expect(within(list).queryByRole('button')).toBeNull();
  expect(within(list).getByText('Zzzz shared 5')).toBeInTheDocument();
});

test('a group of one unchanged line says "line", and the page passes axe with the group closed and open', async () => {
  const { user, container } = await openHistory({ route: COMPARE_ROUTE, history: around(7) });
  const list = await diffList('1.1', '2.0');
  await expectNoA11yViolations(container);
  await user.click(within(list).getByRole('button', { name: /Show/ }));
  await expectNoA11yViolations(container);
});

test('a document with one version has nothing to compare, and says so', async () => {
  await openHistory({ route: COMPARE_ROUTE, history: { versions: [V1_0] } });
  expect(await screen.findByText(messages['history.compare.needTwo'])).toBeInTheDocument();
  expect(screen.queryByRole('combobox')).toBeNull();
});

test('a version of another tenant in the address is the not-found state, with none of the diff, and the choices name it by its id', async () => {
  await openHistory({ route: `${COMPARE_ROUTE}&from=999&to=303` });
  expect(await screen.findByText(messages['errors.not_found'])).toBeInTheDocument();
  expect(screen.queryByRole('list', { name: /Lines that differ/ })).toBeNull();
  expect(Array.from(from().options).map((option) => option.textContent)).toContain('Version with id 999');
  expect(from().value).toBe('999');
});

test('a text that fails the integrity check of the server is the error state with the request id, and nothing of the other text', async () => {
  await openHistory({
    route: COMPARE_ROUTE,
    history: { read: new Map([[V1_1.id, () => envelope(500, 'internal_server_error')]]) },
  });
  expect(await screen.findByText(messages['errors.internal_server_error'])).toBeInTheDocument();
  expect(screen.getAllByText(/req-00000001/).length).toBeGreaterThan(0);
  expect(screen.queryByText('Two point oh.')).toBeNull();
});

test('a failed list of versions for the choices is the error state of the comparison, "Try again" asks again, and the list above stays', async () => {
  const { user } = await openHistory({
    route: COMPARE_ROUTE,
    history: { list: [pageOf(HISTORY), envelope(500, 'internal_server_error'), pageOf(HISTORY)] },
  });
  const region = await comparison();
  expect(await within(region).findByText(messages['errors.internal_server_error'])).toBeInTheDocument();
  expect(versionsTable()).toBeInTheDocument();
  await user.click(within(region).getByRole('button', { name: messages['states.retry'] }));
  await diffList('1.1', '2.0');
});

test('closing the comparison clears the address and puts focus on the heading of the list; opening it puts focus on its heading', async () => {
  const { user } = await openHistory();
  await user.click(compareButton());
  const region = await comparison();
  expect(within(region).getByRole('heading', { level: 3 })).toHaveFocus();
  await user.click(within(region).getByRole('button', { name: messages['history.compare.close'] }));
  expect(address()).toBe('/installations/5/documents/11?tab=history');
  expect(screen.getByRole('heading', { level: 2, name: messages['history.title'] })).toHaveFocus();
  expect(screen.queryByRole('region', { name: messages['history.compare.title'] })).toBeNull();
});

test('a version and a comparison in the same address open the version only', async () => {
  await openHistory({ route: `${COMPARE_ROUTE}&view=302` });
  expect(await screen.findByRole('region', { name: 'Version 1.1' })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: messages['history.compare.title'] })).toBeNull();
});

test('the comparison passes axe, and every control of it takes Tab, the two choices included', async () => {
  const { user, container } = await openHistory({ route: COMPARE_ROUTE });
  await diffList('1.1', '2.0');
  await expectNoA11yViolations(container);
  expect(await unreachableByTab(user, container)).toEqual([]);
});
