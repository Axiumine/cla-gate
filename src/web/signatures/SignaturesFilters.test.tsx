// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { envelope } from '../api/test-support.ts';
import { listedOf, listOf } from '../documents/test-support.ts';
import { messages } from '../i18n/index.ts';
import { globex, repositoriesOf, repository, summary, tenantOf } from '../installations/test-support.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  documentSelect,
  graceOf,
  openSignatures,
  pageOf,
  paramsOf,
  renderSignatures,
  SIGNATURES_ROUTE,
  serveSignatures,
  signatureOf,
  stateSelect,
} from './test-support.ts';

// E18-S07: the status and the document are filters of the endpoint and of the address; the document choices are the ones the viewer may
// read, and a document that is only in the address is still a choice.

const optionsOf = (select: HTMLElement) =>
  within(select)
    .getAllByRole('option')
    .map((option) => option.textContent);

test('the status filter has all, active, outdated and revoked, and starts on all', async () => {
  await openSignatures();
  expect(optionsOf(stateSelect())).toEqual([
    messages['signatures.filter.state.all'],
    messages['status.active'],
    messages['status.outdated'],
    messages['status.revoked'],
  ]);
  expect(stateSelect()).toHaveValue('');
});

test('choosing a status asks for it as `state`, puts it in the address, and choosing all takes it away again', async () => {
  const { served, user } = await openSignatures(SIGNATURES_ROUTE, {
    search: [pageOf([signatureOf(), graceOf()]), pageOf([signatureOf()]), pageOf([signatureOf(), graceOf()])],
  });
  await user.selectOptions(stateSelect(), 'outdated');
  await waitFor(() => {
    expect(served.search).toHaveLength(2);
  });
  expect(paramsOf(served.search[1])).toEqual({ limit: '50', state: 'outdated' });
  expect(window.location.search).toBe('?state=outdated');
  await screen.findByText('1 signature on this page');
  await user.selectOptions(stateSelect(), '');
  await waitFor(() => {
    expect(served.search).toHaveLength(3);
  });
  expect(paramsOf(served.search[2])).toEqual({ limit: '50' });
  expect(window.location.search).toBe('');
});

test('the document filter lists the documents of the installation, and a repository document says which repository it is of', async () => {
  await openSignatures();
  expect(optionsOf(documentSelect())).toEqual([
    messages['signatures.filter.document.all'],
    'Individual CLA',
    'Widgets CLA (acme/widgets)',
  ]);
});

test('choosing a document asks for it as `documentId` and puts it in the address, and the status and the search stay', async () => {
  const { served, user } = await openSignatures(`${SIGNATURES_ROUTE}?state=active`, {
    search: [pageOf([signatureOf()]), pageOf([graceOf()])],
  });
  await user.selectOptions(documentSelect(), 'Widgets CLA (acme/widgets)');
  await waitFor(() => {
    expect(served.search).toHaveLength(2);
  });
  expect(paramsOf(served.search[1])).toEqual({ limit: '50', state: 'active', documentId: '12' });
  expect(window.location.search).toBe('?state=active&document=12');
  expect(documentSelect()).toHaveValue('12');
});

test('a filter changed on a later page starts again from the first: the cursor leaves the address and the request', async () => {
  const { served, user } = await openSignatures(`${SIGNATURES_ROUTE}?cursor=c2`, {
    search: [pageOf([signatureOf()]), pageOf([graceOf()])],
  });
  expect(paramsOf(served.search[0])).toEqual({ limit: '50', cursor: 'c2' });
  await user.selectOptions(stateSelect(), 'revoked');
  await waitFor(() => {
    expect(served.search).toHaveLength(2);
  });
  expect(paramsOf(served.search[1])).toEqual({ limit: '50', state: 'revoked' });
  expect(window.location.search).toBe('?state=revoked');
});

test('a reload on a filtered address shows the filters and asks for them in one request', async () => {
  const { served } = await openSignatures(`${SIGNATURES_ROUTE}?q=octocat&state=revoked&document=11`);
  expect(served.search).toHaveLength(1);
  expect(paramsOf(served.search[0])).toEqual({ limit: '50', login: 'octocat', state: 'revoked', documentId: '11' });
  expect(stateSelect()).toHaveValue('revoked');
  expect(documentSelect()).toHaveValue('11');
});

test.each([
  ['a state nobody has', 'state=expired'],
  ['all as a state, which is no state', 'state=all'],
  ['a document that is not a number', 'document=abc'],
  ['a document that is zero', 'document=0'],
  ['a document that has a decimal', 'document=1.5'],
])('%s in the address is dropped, and nothing of it is asked for', async (_what, query) => {
  const { served } = await openSignatures(`${SIGNATURES_ROUTE}?${query}`);
  expect(paramsOf(served.search[0])).toEqual({ limit: '50' });
  expect(stateSelect()).toHaveValue('');
  expect(documentSelect()).toHaveValue('');
});

test('a document that is only in the address is a choice named by its id, and the server decides about it', async () => {
  const { served } = await openSignatures(`${SIGNATURES_ROUTE}?document=99`);
  expect(optionsOf(documentSelect())).toEqual([
    messages['signatures.filter.document.all'],
    'Document 99',
    'Individual CLA',
    'Widgets CLA (acme/widgets)',
  ]);
  expect(documentSelect()).toHaveValue('99');
  expect(paramsOf(served.search[0])).toEqual({ limit: '50', documentId: '99' });
});

test('a document the server says is not in the installation is the not-found state, not a list', async () => {
  serveSignatures({ search: [envelope(404, 'not_found')] });
  renderSignatures(`${SIGNATURES_ROUTE}?document=99`);
  expect(await screen.findByRole('alert')).toHaveTextContent(messages['errors.not_found']);
  expect(screen.queryByRole('table')).toBeNull();
});

test('the list of documents is asked for once, for the installation in the address, and the search does not wait for it', async () => {
  const { served } = await openSignatures();
  expect(served.documents).toHaveLength(1);
  expect(new URL(served.documents[0]?.url ?? '').pathname).toBe('/api/installations/5/documents');
});

test('a list of documents that cannot be read leaves the choices at all documents, and the search works', async () => {
  const { served } = await openSignatures(SIGNATURES_ROUTE, { documents: [envelope(500, 'internal_server_error')] });
  expect(optionsOf(documentSelect())).toEqual([messages['signatures.filter.document.all']]);
  expect(served.search).toHaveLength(1);
});

test('a repo admin has no list of documents: the choices are the repository documents of the repositories they administer', async () => {
  const tenant = {
    summary: globex({ id: 5, accountLogin: 'acme' }),
    answer: () =>
      repositoriesOf([
        repository(1, 'acme/widgets', {
          document: { id: 21, name: 'Widgets CLA', scope: 'repository', activeVersion: { major: 1, minor: 0 } },
        }),
        repository(2, 'acme/other', {
          canAdminister: false,
          document: { id: 22, name: 'Not mine', scope: 'repository', activeVersion: null },
        }),
        repository(3, 'acme/shared', {
          document: { id: 11, name: 'Whole installation', scope: 'installation', activeVersion: null },
        }),
        repository(4, 'acme/bare'),
      ]),
  };
  const { served } = await openSignatures(SIGNATURES_ROUTE, { tenants: [tenant] });
  expect(optionsOf(documentSelect())).toEqual([
    messages['signatures.filter.document.all'],
    'Widgets CLA (acme/widgets)',
  ]);
  expect(served.documents).toEqual([]);
});

test('an org admin does not ask for the repositories to fill the filter, only for the documents', async () => {
  const { served } = await openSignatures(SIGNATURES_ROUTE, { tenants: [tenantOf(summary(), 'acme/widgets')] });
  expect(served.tenants.repositories).toEqual([]);
  expect(served.documents).toHaveLength(1);
});

test('the choices of a list with no document are only all documents', async () => {
  await openSignatures(SIGNATURES_ROUTE, { documents: [listOf()] });
  expect(optionsOf(documentSelect())).toEqual([messages['signatures.filter.document.all']]);
});

test('an installation-scoped document has no repository to name: its option is its name', async () => {
  await openSignatures(SIGNATURES_ROUTE, { documents: [listOf(listedOf({ id: 11, name: 'Whole CLA' }))] });
  expect(optionsOf(documentSelect())).toEqual([messages['signatures.filter.document.all'], 'Whole CLA']);
});

test('axe passes on the filters with a document chosen', async () => {
  await openSignatures(`${SIGNATURES_ROUTE}?document=11&state=revoked`);
  await expectNoA11yViolations(document.body);
});
