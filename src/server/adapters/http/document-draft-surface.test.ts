// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { serverSources } from '../db/tenant-scan/test-support.ts';
import { auditRows, documentsPath, documentWorld, saveDraftAs } from './document-fixture/test-support.ts';

// Where a draft can be seen (E12-S03). A draft is the work in progress of the admins of a scope, and it is not part of any
// document a contributor can reach: the document carries the flag `hasDraft` and nothing else, and only the draft routes
// read the text. Contributor-facing routes (the sign context and the list of one's own signatures, E13) do not exist yet,
// so the guard is twofold: every route that answers today is swept for the text of a draft, and the files that may read
// the table are listed, so the route that is added next cannot read a draft without this list changing in the open.
// E13 adds its own case for the sign context of a repository that has a draft.

const MARKER = 'DRAFT-ONLY-WORDING-7f3a91';

const SERVER = path.resolve(import.meta.dirname, '../..');

function read(file: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test: `file` comes from the listing of the server's own source directory
  return fs.readFileSync(path.join(SERVER, file), 'utf8');
}

const sources = serverSources(SERVER);

/** The URL of a `GET` route filled with the ids of tenant 1's repository-scoped document, or a refusal to guess an id this sweep does not know. */
function urlFor(
  route: string,
  ids: { readonly installationId: number; readonly documentId: number; readonly repositoryId: number },
): string {
  return route.replaceAll(/:(\w+)/g, (_match, name: string) => {
    switch (name) {
      case 'installationId':
        return String(ids.installationId);
      case 'documentId':
        return String(ids.documentId);
      case 'repositoryId':
        return String(ids.repositoryId);
      default:
        throw new Error(
          `the sweep for draft text cannot fill :${name} of ${route}: teach urlFor which resource it names`,
        );
    }
  });
}

test('the text of a draft is in the answer of no route that answers today but the read of the draft: every GET is swept, and the other mutations of a document', async () => {
  const world = await documentWorld();
  const wide = { installationId: world.t1.installationId, documentId: world.t1.documentId };
  const scoped = { installationId: world.t1.installationId, documentId: world.t1.scoped.documentId };
  await saveDraftAs(world, 'admin1', wide, { contentMd: `${MARKER} wide\n`, expectedRevision: null });
  await saveDraftAs(world, 'repoAdmin1', scoped, { contentMd: `${MARKER} scoped\n`, expectedRevision: 1 });
  await world.app.ready();
  const ids = { ...wide, documentId: scoped.documentId, repositoryId: world.t1.scoped.repositoryId };
  const reads = world.app.routeAccess.filter(
    (entry) => entry.method === 'GET' && !entry.url.endsWith('/documents/:documentId/draft'),
  );
  expect(reads.length).toBeGreaterThan(5);
  const answers = await Promise.all(
    reads.map(async (entry) => ({
      route: entry.url,
      body: (await world.ask('admin1', { method: 'GET', url: urlFor(entry.url, ids) })).body,
    })),
  );
  expect(answers.filter((answer) => answer.body.includes(MARKER)).map((answer) => answer.route)).toEqual([]);
  const created = await world.ask('admin1', {
    method: 'POST',
    url: documentsPath(world.t1.installationId),
    payload: { name: 'Another', kind: 'individual' },
  });
  const renamed = await world.ask('admin1', {
    method: 'PATCH',
    url: `${documentsPath(world.t1.installationId)}/${scoped.documentId}`,
    payload: { name: 'Renamed' },
  });
  expect([created.statusCode, renamed.statusCode]).toEqual([201, 200]);
  expect(created.body + renamed.body).not.toContain(MARKER);
  const read = await world.ask('admin1', {
    method: 'GET',
    url: `${documentsPath(world.t1.installationId)}/${scoped.documentId}/draft`,
  });
  expect(read.body).toContain(MARKER);
});

test('a draft is not in the audit log, in the log lines of the requests, or in the answer of a save', async () => {
  const world = await documentWorld();
  const target = { installationId: world.t1.installationId, documentId: world.t1.documentId };
  const saved = await saveDraftAs(world, 'admin1', target, { contentMd: `${MARKER}\n`, expectedRevision: null });
  expect(saved.body).not.toContain(MARKER);
  expect(JSON.stringify(await auditRows(world, 'cla_draft.saved'))).not.toContain(MARKER);
  expect(world.logs.text()).not.toContain(MARKER);
});

/** The files of the server that contain `needle`, relative to `src/server`. */
const filesWith = (needle: RegExp): string[] => sources.filter((file) => needle.test(read(file)));

test('only the statements of the drafts name the table, and only the draft service and the draft routes read the text of a draft', () => {
  expect(filesWith(/\bcla_drafts\b/)).toEqual([
    'adapters/db/schema.ts',
    'services/cla-draft-queries.ts',
    'services/cla-draft-writes.ts',
  ]);
  expect(filesWith(/from '[^']*\/cla-draft-queries\.ts'/)).toEqual([
    'adapters/http/document-presenters.ts',
    'services/cla-documents.ts',
    'services/cla-drafts.ts',
  ]);
  expect(filesWith(/from '[^']*\/cla-draft-writes\.ts'/)).toEqual([
    'adapters/http/document-presenters.ts',
    'services/cla-drafts.ts',
  ]);
  expect(filesWith(/from '[^']*\/cla-drafts\.ts'/)).toEqual(['adapters/http/document-draft-routes.ts']);
});

test('the document read takes the number of the revision from the draft and never the text, and the presenters hold the type of a draft only', () => {
  const documents = read('services/cla-documents.ts');
  expect(documents).toContain('findDraftRevision');
  expect(documents).not.toMatch(/\bfindDraft\b/);
  const presenters = read('adapters/http/document-presenters.ts');
  expect(presenters).toMatch(/import type \{ StoredDraft \}/);
  expect(presenters).toMatch(/import type \{ SavedDraft \}/);
});
