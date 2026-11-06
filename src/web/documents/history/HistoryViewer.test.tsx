// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { envelope } from '../../api/test-support.ts';
import { messages } from '../../i18n/index.ts';
import { expectNoA11yViolations } from '../../test-support/a11y.ts';
import { address, openHistory, V1_1, versionsTable, viewButton, viewer } from './test-support.ts';

// E18-S11: "View" loads one version and shows its text read-only, drawn by the same MarkdownView contributors read, with its whole hash.

const paths = (seen: readonly { readonly url: string }[]) => seen.map((one) => new URL(one.url).pathname);

test('"View" loads that version of that document of this tenant, and puts it in the address', async () => {
  const { user, served } = await openHistory();
  await user.click(viewButton('1.1'));
  await viewer('1.1');
  expect(paths(served.read).at(-1)).toBe('/api/installations/5/documents/11/versions/302');
  expect(address()).toBe('/installations/5/documents/11?tab=history&view=302');
});

test('the viewer shows the text through MarkdownView, with headings one level below its own, read-only', async () => {
  const { user } = await openHistory();
  await user.click(viewButton('1.1'));
  const region = await viewer('1.1');
  expect(within(region).getByRole('heading', { level: 3, name: 'Version 1.1' })).toBeInTheDocument();
  expect(within(region).getByRole('heading', { level: 4, name: 'Zzzz agreement' })).toBeInTheDocument();
  expect(within(region).getByText('One point one.')).toBeInTheDocument();
  expect(within(region).queryByRole('textbox')).toBeNull();
  expect(region.querySelector('textarea, input, [contenteditable]')).toBeNull();
});

test('the viewer shows the facts: time in UTC, who, why in full, how many signatures, and the whole hash in code', async () => {
  const { user } = await openHistory();
  await user.click(viewButton('1.1'));
  const region = await viewer('1.1');
  const facts = region.querySelector('dl');
  expect(facts).toHaveTextContent('2026-09-20 09:00 UTC');
  expect(facts).toHaveTextContent('hubot');
  expect(facts).toHaveTextContent('Fixed a typo');
  expect(facts).toHaveTextContent('12');
  const hash = within(region).getByText('b'.repeat(64));
  expect(hash.tagName).toBe('CODE');
});

test('the active version has its badge and no "Restore this text"; an old one has the button', async () => {
  const { user } = await openHistory();
  await user.click(viewButton('2.0'));
  const active = await viewer('2.0');
  expect(within(active).getByText(messages['status.active'])).toBeInTheDocument();
  expect(within(active).queryByRole('button', { name: messages['restore.action'] })).toBeNull();
  await user.click(viewButton('1.1'));
  const old = await viewer('1.1');
  expect(within(old).queryByText(messages['status.active'])).toBeNull();
  expect(within(old).getByRole('button', { name: messages['restore.action'] })).toBeInTheDocument();
});

test('opening a version moves focus to its heading, and choosing another replaces it', async () => {
  const { user } = await openHistory();
  await user.click(viewButton('1.1'));
  const first = await viewer('1.1');
  expect(within(first).getByRole('heading', { level: 3 })).toHaveFocus();
  await user.click(viewButton('1.0'));
  const second = await viewer('1.0');
  expect(screen.queryByRole('region', { name: 'Version 1.1' })).toBeNull();
  expect(within(second).getByRole('heading', { level: 3 })).toHaveFocus();
});

test('"Close the version" clears the address and puts focus on the heading of the list', async () => {
  const { user } = await openHistory();
  await user.click(viewButton('1.1'));
  const region = await viewer('1.1');
  await user.click(within(region).getByRole('button', { name: messages['history.viewer.close'] }));
  expect(screen.queryByRole('region', { name: 'Version 1.1' })).toBeNull();
  expect(address()).toBe('/installations/5/documents/11?tab=history');
  expect(screen.getByRole('heading', { level: 2, name: messages['history.title'] })).toHaveFocus();
});

test('an address with a version opens it, and the Back button of the browser closes it', async () => {
  const { user } = await openHistory({ route: '/installations/5/documents/11?tab=history&view=302' });
  const region = await viewer('1.1');
  expect(region).toHaveTextContent('One point one.');
  await user.click(within(region).getByRole('button', { name: messages['history.viewer.close'] }));
  expect(screen.queryByRole('region', { name: 'Version 1.1' })).toBeNull();
  window.history.back();
  expect(await viewer('1.1')).toBeInTheDocument();
});

test('a version that fails the integrity check of the server is the error state with the request id and none of the text', async () => {
  const { user } = await openHistory({
    history: { read: new Map([[V1_1.id, () => envelope(500, 'internal_server_error')]]) },
  });
  await user.click(viewButton('1.1'));
  expect(await screen.findByText(messages['errors.internal_server_error'])).toBeInTheDocument();
  expect(screen.getAllByText(/req-00000001/).length).toBeGreaterThan(0);
  expect(screen.queryByText('One point one.')).toBeNull();
  expect(screen.queryByRole('region', { name: 'Version 1.1' })).toBeNull();
  expect(versionsTable()).toBeInTheDocument();
});

test('the uniform 404 for a version of another tenant renders the not-found state, with no text and no hash', async () => {
  await openHistory({ route: '/installations/5/documents/11?tab=history&view=999' });
  expect(await screen.findByText(messages['errors.not_found'])).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: /Version/ })).toBeNull();
  expect(screen.queryByText(/^[0-9a-f]{64}$/)).toBeNull();
});

test('a 403 on a version is the forbidden state, and the list stays', async () => {
  const { user } = await openHistory({ history: { read: new Map([[V1_1.id, () => envelope(403, 'forbidden')]]) } });
  await user.click(viewButton('1.1'));
  expect(await screen.findByText(messages['states.forbidden.title'])).toBeInTheDocument();
  expect(versionsTable()).toBeInTheDocument();
});

test('the viewer passes axe, and every control in it takes Tab', async () => {
  const { user, container } = await openHistory();
  await user.click(viewButton('1.1'));
  await viewer('1.1');
  await expectNoA11yViolations(container);
});
