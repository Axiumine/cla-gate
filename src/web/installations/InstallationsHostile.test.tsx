// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { HOSTILE_CONTROL_NAMES, HOSTILE_NAMES } from '../../shared/hostile-names.ts';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { activeContent } from '../test-support/hostile.ts';
import { visibleText } from '../ui/user-text.ts';
import { renderInstallations, serveTenants, summary, tenantOf } from './test-support.ts';

// E18-S04: an account login is a display snapshot of text that GitHub holds and a person chose. It is drawn as text in the
// list, on the tenant's page, in the switcher and in the title of the tab, and nowhere as markup.

const NAMES = [...HOSTILE_NAMES, ...HOSTILE_CONTROL_NAMES];
/** What a browser makes of a title: runs of ASCII whitespace become one space, and the ends are trimmed (the HTML standard). */
const collapsed = (text: string): string => text.replace(/[\t\n\f\r ]+/gu, ' ').trim();

/** U+202E, the right-to-left override, from its code point: written out it would reorder the text around it in this file. */
const RLO = String.fromCodePoint(0x202e);
const OTHER = summary({ id: 6, accountLogin: 'globex', role: 'repo_admin' });

/** The tenants of a made-up server: the one with the hostile login, and a second so that the list is not skipped. */
const serveHostile = (name: string) =>
  serveTenants([tenantOf(summary({ accountLogin: name }), 'acme/widgets'), tenantOf(OTHER, 'globex/api')]);

test.each(NAMES.map((name) => [JSON.stringify(name).slice(0, 40), name] as const))(
  'the login %s is text in the list: no script, no image, no unsafe link, and it is in the cell as written',
  async (_label, name) => {
    serveHostile(name);
    renderInstallations('/installations');
    const table = await screen.findByRole('table', { name: messages['installations.caption'] });
    expect(activeContent(screen.getByRole('main'))).toEqual([]);
    const cell = within(table).getAllByRole('row')[1]?.querySelector('td');
    expect(cell?.textContent).toBe(visibleText(name));
    expect(table.querySelector('a[href="/installations/5"]')?.textContent).toBe(visibleText(name));
  },
);

test.each(NAMES.map((name) => [JSON.stringify(name).slice(0, 40), name] as const))(
  'the login %s is text in the h1, the switcher and the title of the tab, with the hidden characters written out',
  async (_label, name) => {
    serveHostile(name);
    const { user } = renderInstallations('/installations/5');
    const h1 = await screen.findByRole('heading', { level: 1 });
    await screen.findByRole('table');
    expect(h1.textContent).toBe(visibleText(name));
    await waitFor(() => {
      expect(document.title).toBe(`${messages['installation.title']}: ${collapsed(visibleText(name))} · CLA`);
    });
    expect(document.title).toBe(visibleText(document.title));
    await user.click(screen.getByRole('button', { name: /^Installation/ }));
    const link = within(screen.getByRole('navigation', { name: messages['tenant.switcher.label'] })).getAllByRole(
      'link',
    )[0];
    expect(link?.textContent).toBe(visibleText(name));
    expect(activeContent(screen.getByRole('main'))).toEqual([]);
    expect(activeContent(screen.getByRole('navigation', { name: messages['tenant.switcher.label'] }))).toEqual([]);
  },
);

test('a hostile login does not break the page: the list, the tenant page and the open switcher pass axe', async () => {
  const name = `<img src=x onerror=alert(1)> ${'n'.repeat(200)}`;
  serveHostile(name);
  const list = renderInstallations('/installations');
  await screen.findByRole('table');
  await expectNoA11yViolations(list.container);
  list.unmount();
  serveHostile(name);
  const tenant = renderInstallations('/installations/5');
  await screen.findByRole('table');
  await tenant.user.click(screen.getByRole('button', { name: /^Installation/ }));
  await expectNoA11yViolations(tenant.container);
});

test('the live region announces the page with the same visible text as the title', async () => {
  serveHostile(`evil${RLO}name`);
  renderInstallations('/installations/5');
  await screen.findByRole('table');
  const hostile = `evil${RLO}name`;
  const expected = `${messages['installation.title']}: ${visibleText(hostile)}`;
  expect(screen.getByText(expected, { selector: '[role="status"]' })).toBeInTheDocument();
  expect(expected).toContain('<U+202E>');
});
