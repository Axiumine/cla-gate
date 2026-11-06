// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, expect, test, vi } from 'vitest';
import { CORPORATE_DOCUMENT_PATH } from '../../shared/corporate.ts';
import { messages } from '../i18n/index.ts';
import { AppRouter } from '../router.tsx';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { activeContent } from '../test-support/hostile.ts';
import { spyOnPageNavigation } from '../test-support/location.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { server } from '../test-support/server.ts';
import { ALICE, CSRF_TOKEN } from '../test-support/session.ts';
import { answerDocument, answerSigning, DOCUMENT, REPO_ID } from './test-support.ts';

// E21-S02: the page at /corporate/sign/:githubRepoId in the shell of the app.

const ROUTE = `/corporate/sign/${REPO_ID}`;

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The box that says the signatory may bind the company; its name ends in "(required)". */
const authorityBox = () =>
  screen.getByRole('checkbox', { name: (name) => name.startsWith(messages['corporate.sign.authority']) });

/** The field whose label starts with `label`; the label ends in "(required)". */
const fieldOf = (label: string) => screen.getByLabelText(label, { exact: false });

/** Types the three texts the form asks for. */
async function fillIn(user: ReturnType<typeof renderWithProviders>['user']): Promise<void> {
  await user.type(fieldOf(messages['corporate.sign.company']), 'Acme Corp');
  await user.type(fieldOf(messages['corporate.sign.titleField']), 'General Counsel');
  await user.type(fieldOf(messages['corporate.sign.typedName']), 'Ada Lovelace');
}

test('the page shows the corporate CLA of the repository in the main landmark of the shell, above the form, and passes axe', async () => {
  answerDocument(DOCUMENT);
  const { container } = renderWithProviders(<AppRouter />, { route: ROUTE, session: ALICE });
  const heading = await screen.findByRole('heading', { level: 1, name: messages['corporate.sign.title'] });
  expect(screen.getByRole('main')).toContainElement(heading);
  expect(await screen.findByRole('heading', { level: 2, name: 'Corporate terms' })).toBeInTheDocument();
  expect(screen.getByText('acme/widgets')).toBeInTheDocument();
  expect(screen.getByText('Version 1.0, published 2026-10-01 09:00 UTC')).toBeInTheDocument();
  expect(screen.getByText(DOCUMENT.consent.text)).toBeInTheDocument();
  expect(document.title).toBe(`${messages['corporate.sign.title']} · CLA`);
  await expectNoA11yViolations(container);
});

test('a visitor without a session is sent to the login with the page as return_to, and the page is not shown', async () => {
  answerDocument(DOCUMENT);
  const assign = spyOnPageNavigation();
  renderWithProviders(<AppRouter />, { route: ROUTE });
  await vi.waitFor(() => {
    expect(assign).toHaveBeenCalledExactlyOnceWith(`/api/auth/login?return_to=${encodeURIComponent(ROUTE)}`);
  });
  expect(screen.queryByRole('heading', { name: messages['corporate.sign.title'] })).toBeNull();
});

test('signing sends the version and the hash on screen with the typed texts and the CSRF token, and then points at the list', async () => {
  answerDocument(DOCUMENT);
  const posted = answerSigning();
  const { user } = renderWithProviders(<AppRouter />, { route: ROUTE, session: ALICE });
  await screen.findByText(DOCUMENT.consent.text);
  await fillIn(user);
  await user.click(authorityBox());
  await user.click(screen.getByRole('button', { name: messages['corporate.sign.submit'] }));
  expect(await screen.findByText(messages['corporate.sign.done'])).toBeInTheDocument();
  expect(posted).toEqual([
    {
      csrf: CSRF_TOKEN,
      body: {
        githubRepoId: REPO_ID,
        versionId: DOCUMENT.versionId,
        contentSha256: DOCUMENT.contentSha256,
        companyName: 'Acme Corp',
        signatoryTitle: 'General Counsel',
        typedName: 'Ada Lovelace',
        authorityConfirmed: true,
      },
    },
  ]);
  expect(screen.getByRole('link', { name: messages['corporate.sign.doneLink'] })).toHaveAttribute(
    'href',
    '/corporate/agreements',
  );
  expect(screen.queryByRole('button', { name: messages['corporate.sign.submit'] })).toBeNull();
});

test('a form left empty names what is missing, asks the server nothing and keeps the box unticked', async () => {
  answerDocument(DOCUMENT);
  const posted = answerSigning();
  const { user } = renderWithProviders(<AppRouter />, { route: ROUTE, session: ALICE });
  await screen.findByText(DOCUMENT.consent.text);
  await user.click(screen.getByRole('button', { name: messages['corporate.sign.submit'] }));
  expect(await screen.findAllByText(messages['corporate.sign.fieldRequired'])).toHaveLength(3);
  expect(screen.getByText(messages['corporate.sign.authorityRequired'])).toBeInTheDocument();
  expect(posted).toEqual([]);
});

test('the box alone missing is named, and nothing is sent', async () => {
  answerDocument(DOCUMENT);
  const posted = answerSigning();
  const { user } = renderWithProviders(<AppRouter />, { route: ROUTE, session: ALICE });
  await screen.findByText(DOCUMENT.consent.text);
  await fillIn(user);
  await user.click(screen.getByRole('button', { name: messages['corporate.sign.submit'] }));
  expect(await screen.findByText(messages['corporate.sign.authorityRequired'])).toBeInTheDocument();
  expect(screen.queryByText(messages['corporate.sign.fieldRequired'])).toBeNull();
  expect(posted).toEqual([]);
});

test.each([
  [409, 'agreement_exists', messages['corporate.error.agreement_exists']],
  [409, 'agreement_revoked', messages['corporate.error.agreement_revoked']],
  [409, 'installation_suspended', messages['corporate.error.installation_suspended']],
  [422, 'validation_failed', messages['corporate.error.validation_failed']],
  [422, 'invalid_name', messages['corporate.error.invalid_name']],
  [422, 'no_verified_email', messages['corporate.error.no_verified_email']],
  [422, 'email_not_verified', messages['corporate.error.email_not_verified']],
] as const)(
  'a %i %s answer to the signing is told in the words of the catalog, with no way to reload',
  async (status, code, words) => {
    answerDocument(DOCUMENT);
    answerSigning({ status, code });
    const { user } = renderWithProviders(<AppRouter />, { route: ROUTE, session: ALICE });
    await screen.findByText(DOCUMENT.consent.text);
    await fillIn(user);
    await user.click(authorityBox());
    await user.click(screen.getByRole('button', { name: messages['corporate.sign.submit'] }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(words)).toBeInTheDocument();
    expect(within(alert).queryByRole('button')).toBeNull();
    expect(screen.getByRole('button', { name: messages['corporate.sign.submit'] })).toBeInTheDocument();
  },
);

test.each([
  [409, 'version_outdated', messages['corporate.error.version_outdated']],
  [422, 'hash_mismatch', messages['corporate.error.hash_mismatch']],
] as const)(
  'a %i %s answer offers the current text, and loading it asks for the document again',
  async (status, code, words) => {
    let reads = 0;
    server.use(
      http.get(CORPORATE_DOCUMENT_PATH, () => {
        reads += 1;
        return HttpResponse.json(DOCUMENT);
      }),
    );
    answerSigning({ status, code });
    const { user } = renderWithProviders(<AppRouter />, { route: ROUTE, session: ALICE });
    await screen.findByText(DOCUMENT.consent.text);
    await fillIn(user);
    await user.click(authorityBox());
    await user.click(screen.getByRole('button', { name: messages['corporate.sign.submit'] }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(words)).toBeInTheDocument();
    expect(reads).toBe(1);
    await user.click(within(alert).getByRole('button', { name: messages['corporate.sign.reload'] }));
    await screen.findByRole('heading', { level: 2, name: 'Corporate terms' });
    expect(reads).toBe(2);
  },
);

test('a failure with no corporate code is shown by the generic state, with its request ID', async () => {
  answerDocument(DOCUMENT);
  answerSigning({ status: 500, code: 'internal_server_error' });
  const { user } = renderWithProviders(<AppRouter />, { route: ROUTE, session: ALICE });
  await screen.findByText(DOCUMENT.consent.text);
  await fillIn(user);
  await user.click(authorityBox());
  await user.click(screen.getByRole('button', { name: messages['corporate.sign.submit'] }));
  expect(await screen.findByText(messages['errors.internal_server_error'])).toBeInTheDocument();
  expect(screen.getByText('req-sign')).toBeInTheDocument();
});

test('a repository with no corporate CLA in force is told so, and a repository that is not found is the generic not-found state', async () => {
  answerDocument({ status: 404, code: 'corporate_cla_not_configured' });
  const configured = renderWithProviders(<AppRouter />, { route: ROUTE, session: ALICE });
  expect(await screen.findByText(messages['corporate.error.corporate_cla_not_configured'])).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: messages['corporate.sign.submit'] })).toBeNull();
  configured.unmount();
  answerDocument({ status: 404, code: 'not_found' });
  renderWithProviders(<AppRouter />, { route: ROUTE, session: ALICE });
  expect(await screen.findByText(messages['errors.not_found'])).toBeInTheDocument();
});

test.each(['abc', '0', '012', '1.5', '99999999999999999'])(
  'the address /corporate/sign/%s is the not-found page',
  async (id) => {
    renderWithProviders(<AppRouter />, { route: `/corporate/sign/${id}`, session: ALICE });
    expect(
      await screen.findByRole('heading', { level: 1, name: messages['states.notFound.title'] }),
    ).toBeInTheDocument();
  },
);

test('the names of the repository and the document are text, whatever they hold', async () => {
  answerDocument({
    ...DOCUMENT,
    repository: { githubRepoId: REPO_ID, fullName: '<img src=x onerror=alert(1)>/=HYPERLINK("http://x","y")' },
    document: { id: 11, name: '<script>alert(1)</script>' },
  });
  const { container } = renderWithProviders(<AppRouter />, { route: ROUTE, session: ALICE });
  await screen.findByText(DOCUMENT.consent.text);
  // The shell has the avatar of the signed-in person; the page is the main landmark.
  const page = screen.getByRole('main');
  expect(page.querySelector('img')).toBeNull();
  expect(page.querySelector('script')).toBeNull();
  expect(container.textContent).toContain('<img src=x onerror=alert(1)>/=HYPERLINK("http://x","y")');
  expect(container.textContent).toContain('<script>alert(1)</script>');
});

test('the text of the corporate CLA is drawn by the markdown view: raw HTML, an image and a script link stay inert text, and its h1 is the h2 of the page', async () => {
  answerDocument({
    ...DOCUMENT,
    contentMd: '# Terms\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))\n',
  });
  renderWithProviders(<AppRouter />, { route: ROUTE, session: ALICE });
  await screen.findByRole('heading', { level: 2, name: 'Terms' });
  // The shell has the avatar of the signed-in person; the page is the main landmark.
  const page = screen.getByRole('main');
  expect(activeContent(page)).toEqual([]);
  expect(page.textContent).toContain('<script>alert(1)</script>');
  expect(page.textContent).toContain('<img src=x onerror=alert(1)>');
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
});
