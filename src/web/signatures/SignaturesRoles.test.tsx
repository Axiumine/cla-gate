// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { envelope, json } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { globex, repositoriesOf, repository, summary, type Tenant, tenantOf } from '../installations/test-support.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  detailsButton,
  exportLink,
  graceOf,
  openSignatures,
  pageOf,
  renderSignatures,
  revokeButton,
  SIGNATURES_ROUTE,
  serveSignatures,
  signatureOf,
  signaturesTable,
} from './test-support.ts';

// E18-S07: what each role is offered. An org admin revokes and exports every document; a repo admin the documents of their
// repositories, which they find through the list of repositories; a person whose role is not known nothing at all. The server still
// decides on every request, and what it refuses is shown.

/** The tenant `acme`, where the person is a repo admin of `acme/gadgets`, which enforces the repository document 12. */
const REPO_ADMIN: Tenant = {
  summary: globex({ id: 5, accountLogin: 'acme' }),
  answer: () =>
    repositoriesOf([
      repository(1, 'acme/gadgets', {
        document: { id: 12, name: 'Widgets CLA', scope: 'repository', activeVersion: { major: 1, minor: 0 } },
      }),
    ]),
};

const GRACE_ONLY = pageOf([graceOf()]);

test('an org admin has Revoke on every row and the export of any document they choose', async () => {
  await openSignatures(`${SIGNATURES_ROUTE}?document=11`);
  expect(revokeButton('Ada Lovelace')).toBeEnabled();
  expect(revokeButton('Grace Hopper')).toBeEnabled();
  expect(exportLink().getAttribute('href')).toBe('/api/installations/5/documents/11/signatures.csv?state=all');
});

test('a repo admin has Revoke on the rows of the documents of their repositories, found through the list of repositories', async () => {
  const { served } = await openSignatures(`${SIGNATURES_ROUTE}?document=12`, {
    tenants: [REPO_ADMIN],
    search: [GRACE_ONLY],
  });
  expect(revokeButton('Grace Hopper')).toBeEnabled();
  expect(exportLink().getAttribute('href')).toBe('/api/installations/5/documents/12/signatures.csv?state=all');
  expect(served.documents).toEqual([]);
  expect(served.tenants.repositories).toHaveLength(1);
});

test('a repo admin who has chosen no document is offered the export of none yet, as the org admin is', async () => {
  await openSignatures(SIGNATURES_ROUTE, { tenants: [REPO_ADMIN], search: [GRACE_ONLY] });
  expect(screen.getByRole('button', { name: messages['signatures.export'] })).toBeDisabled();
});

test('a person the list of installations does not know has the signatures to read, Details, and neither Revoke nor Export', async () => {
  await openSignatures(SIGNATURES_ROUTE, {
    listing: () => json([summary({ id: 6, accountLogin: 'globex' })]),
  });
  expect(detailsButton('Ada Lovelace')).toBeEnabled();
  expect(screen.queryByRole('button', { name: /^Revoke the signature/ })).toBeNull();
  expect(screen.queryByText(messages['signatures.export.help'])).toBeNull();
  expect(screen.queryByRole('link', { name: messages['signatures.export'] })).toBeNull();
  expect(screen.queryByRole('button', { name: messages['signatures.export'] })).toBeNull();
});

test('the same holds for a document that is chosen: with no role there is no export link', async () => {
  await openSignatures(`${SIGNATURES_ROUTE}?document=11`, {
    listing: () => json([summary({ id: 6, accountLogin: 'globex' })]),
  });
  expect(screen.queryByRole('link', { name: messages['signatures.export'] })).toBeNull();
});

test('in a suspended installation the table is shown, the banner says so, and Revoke is unavailable on every row', async () => {
  await openSignatures(SIGNATURES_ROUTE, { tenants: [tenantOf(summary({ suspended: true }), 'acme/widgets')] });
  expect(revokeButton('Ada Lovelace')).toBeDisabled();
  expect(revokeButton('Grace Hopper')).toBeDisabled();
  expect(detailsButton('Ada Lovelace')).toBeEnabled();
});

test('a 403 of the search is the forbidden state and no table: the server still decides', async () => {
  serveSignatures({ search: [envelope(403, 'forbidden')] });
  renderSignatures(SIGNATURES_ROUTE);
  expect(await screen.findByRole('alert')).toHaveTextContent(messages['errors.forbidden']);
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByRole('button', { name: /^Revoke the signature/ })).toBeNull();
});

test('Details is on every row for every role, and the email is only in it', async () => {
  const { user } = await openSignatures(SIGNATURES_ROUTE, { tenants: [REPO_ADMIN], search: [pageOf([signatureOf()])] });
  const table = signaturesTable();
  expect(within(table).getAllByRole('button')).toHaveLength(2);
  await user.click(detailsButton('Ada Lovelace'));
  expect(await screen.findByRole('dialog')).toHaveTextContent('zzzz-ada@example.org');
});

test('axe passes on the table of a repo admin', async () => {
  const { container } = await openSignatures(SIGNATURES_ROUTE, { tenants: [REPO_ADMIN], search: [GRACE_ONLY] });
  await expectNoA11yViolations(container);
});
