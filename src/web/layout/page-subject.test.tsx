// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Link } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { expect, test } from 'vitest';
import { messages } from '../i18n/index.ts';
import { TestAppRoutes } from '../test-support/app-routes.tsx';
import { renderWithProviders } from '../test-support/render.tsx';
import { usePageSubject } from './page-subject.ts';

// E18-S04: a page that has a subject of its own (the account of an installation) adds it to the title of the tab and to the
// announcement of the page, as text, and takes it away when it goes.

function WithSubject() {
  const [subject, setSubject] = useState<string | undefined>('acme');
  usePageSubject(subject);
  return (
    <>
      <h1>The page</h1>
      <button
        type="button"
        onClick={() => {
          setSubject('globex');
        }}
      >
        Change subject
      </button>
      <button
        type="button"
        onClick={() => {
          setSubject(undefined);
        }}
      >
        Remove subject
      </button>
      <Link to="/login/failed">Next page</Link>
    </>
  );
}

/** U+202E, the right-to-left override, from its code point: written out it would reorder the text around it in this file. */
const RLO = String.fromCodePoint(0x202e);

function HostileSubject() {
  usePageSubject(`evil${RLO}name`);
  return <h1>The page</h1>;
}

function WithoutSubject() {
  return (
    <p>
      <Link to="/">Back</Link>
    </p>
  );
}

const pages = [
  { path: '/', access: 'public', component: WithSubject, title: 'landing.title' },
  { path: '/login/failed', access: 'public', component: WithoutSubject, title: 'login.failed.title' },
  { path: '/hostile', access: 'public', component: HostileSubject, title: 'nav.menu' },
] as const;

const titleOf = (title: string, subject: string) => `${title}: ${subject} · CLA`;

test('the subject follows the page title in the title of the tab and in the live region, as "<title>: <subject>"', async () => {
  renderWithProviders(<TestAppRoutes route="/" pages={pages} />);
  await waitFor(() => {
    expect(document.title).toBe(titleOf(messages['landing.title'], 'acme'));
  });
  expect(screen.getByText(`${messages['landing.title']}: acme`, { selector: '[role="status"]' })).toBeInTheDocument();
});

test('a subject that changes replaces the old one, and one that is removed leaves the page title alone', async () => {
  const { user } = renderWithProviders(<TestAppRoutes route="/" pages={pages} />);
  await user.click(await screen.findByRole('button', { name: 'Change subject' }));
  await waitFor(() => {
    expect(document.title).toBe(titleOf(messages['landing.title'], 'globex'));
  });
  await user.click(screen.getByRole('button', { name: 'Remove subject' }));
  await waitFor(() => {
    expect(document.title).toBe(`${messages['landing.title']} · CLA`);
  });
});

test('the subject goes with its page: the next page has none of it', async () => {
  const { user } = renderWithProviders(<TestAppRoutes route="/" pages={pages} />);
  await waitFor(() => {
    expect(document.title).toContain('acme');
  });
  await user.click(screen.getByRole('link', { name: 'Next page' }));
  await waitFor(() => {
    expect(document.title).toBe(`${messages['login.failed.title']} · CLA`);
  });
  expect(screen.queryByText(/acme/)).toBeNull();
});

test('a subject is text: a right-to-left override in it is written out in the title and the live region', async () => {
  renderWithProviders(<TestAppRoutes route="/hostile" pages={pages} />);
  await waitFor(() => {
    expect(document.title).toBe(titleOf(messages['nav.menu'], 'evil<U+202E>name'));
  });
  expect(document.title).not.toContain(RLO);
  expect(
    screen.getByText(`${messages['nav.menu']}: evil<U+202E>name`, { selector: '[role="status"]' }),
  ).toBeInTheDocument();
});

test('outside a shell the hook sets nothing and breaks nothing', () => {
  document.title = 'untouched';
  renderWithProviders(<HostileSubject />);
  expect(screen.getByRole('heading', { level: 1, name: 'The page' })).toBeInTheDocument();
  expect(document.title).toBe('untouched');
});
