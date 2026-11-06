// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { globex, summary, tenantOf } from '../../installations/test-support.ts';
import { historyVersion, openHistory, versionsTable } from '../history/test-support.ts';
import { detailOf, listedOf, versionOf } from '../test-support.ts';
import { invalidateButton, serveInvalidate } from './test-support.ts';

// E18-S14: who is offered the invalidation of a major. It follows the scope of the document, as the server's decision table does: an org
// admin may invalidate the signatures of any document, a repo admin only those of a document of a repository, and a role that is not known
// gets nothing. The server still decides on every request, and a suspended installation writes nothing.

/** The document of a repository `acme/widgets`, whose active version is 2.0 as the history says. */
const repositoryDocument = () =>
  detailOf(
    listedOf({
      scope: 'repository',
      repositoryId: 1,
      repositoryFullName: 'acme/widgets',
      activeVersion: versionOf({
        id: historyVersion().id,
        major: 2,
        minor: 0,
        contentSha256: 'c'.repeat(64),
        publishedAt: '2026-10-05T10:00:00.000Z',
      }),
    }),
  );

const buttons = () => within(versionsTable()).queryAllByRole('button', { name: /^Invalidate signatures/ });

test('an org admin is offered the invalidation on a document of the whole installation', async () => {
  await openHistory();
  expect(buttons()).toHaveLength(2);
  expect(invalidateButton(2)).toBeEnabled();
});

test('an org admin is offered it on the document of a repository too', async () => {
  await openHistory({ serve: { detail: [repositoryDocument()] } });
  expect(buttons()).toHaveLength(2);
});

test('a repo admin is offered it on the document of a repository', async () => {
  await openHistory({
    serve: {
      tenants: [tenantOf(summary({ role: 'repo_admin' }), 'acme/widgets')],
      detail: [repositoryDocument()],
    },
  });
  expect(buttons()).toHaveLength(2);
});

test('a repo admin is offered it on no document of the whole installation, whose signatures only an org admin may take out of force', async () => {
  await openHistory({ serve: { tenants: [tenantOf(summary({ role: 'repo_admin' }), 'acme/widgets')] } });
  expect(buttons()).toEqual([]);
  expect(within(versionsTable()).getAllByRole('button')).toHaveLength(3);
});

test('a person the list of installations does not know is offered nothing, though the history is there to read', async () => {
  await openHistory({ serve: { tenants: [tenantOf(globex(), 'globex/api')] } });
  expect(buttons()).toEqual([]);
  expect(within(versionsTable()).getAllByRole('button')).toHaveLength(3);
});

test('a suspended installation shows the button unavailable, and pressing it opens nothing', async () => {
  const { user } = await openHistory({
    serve: { tenants: [tenantOf(summary({ suspended: true }), 'acme/widgets')] },
  });
  const served = serveInvalidate();
  expect(invalidateButton(2)).toBeDisabled();
  await user.click(invalidateButton(2));
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(served.preview).toEqual([]);
});
