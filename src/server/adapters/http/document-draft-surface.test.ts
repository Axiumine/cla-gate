// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { serverSources } from '../db/tenant-scan/test-support.ts';
import { publishVersion } from '../db/test-support.ts';
import { auditRows, documentsPath, documentWorld, saveDraftAs } from './document-fixture/test-support.ts';

// Where a draft can be seen (E12-S03). A draft is the work in progress of the admins of a scope, and it is not part of any
// document a contributor can reach: the document carries the flag `hasDraft` and nothing else, and only the draft routes
// read the text. The guard is twofold: every route that answers is swept for the text of a draft, and the files that may read
// the table are listed, so the route that is added next cannot read a draft without this list changing in the open. The sign
// context (E13-S02), the one contributor-facing route that serves a document, is swept here too and has its own case next to
// the route (sign-context-drafts.test.ts).

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
  ids: {
    readonly installationId: number;
    readonly documentId: number;
    readonly repositoryId: number;
    readonly githubRepoId: number;
    readonly versionId: number;
  },
): string {
  return route.replaceAll(/:(\w+)/g, (_match, name: string) => {
    switch (name) {
      case 'installationId':
        return String(ids.installationId);
      case 'documentId':
        return String(ids.documentId);
      case 'repositoryId':
        return String(ids.repositoryId);
      case 'githubRepoId':
        return String(ids.githubRepoId);
      case 'versionId':
        return String(ids.versionId);
      default:
        throw new Error(
          `the sweep for draft text cannot fill :${name} of ${route}: teach urlFor which resource it names`,
        );
    }
  });
}

/**
 * The sign context (E13-S02) serves the document a repository enforces: the scoped repository of tenant 1 is made to enforce the
 * document that has the drafts, whose active version is `versionId`.
 */
async function enforceScopedDocument(
  world: Awaited<ReturnType<typeof documentWorld>>,
  versionId: number,
): Promise<void> {
  const documentId = world.t1.scoped.documentId;
  await world.db
    .updateTable('cla_documents')
    .set({ active_version_id: versionId })
    .where('id', '=', documentId)
    .execute();
  await world.db
    .updateTable('repositories')
    .set({ cla_document_id: documentId })
    .where('id', '=', world.t1.scoped.repositoryId)
    .execute();
}

/** Creates a document and renames the one with the drafts: the other mutations of a document, with the answers they gave. */
async function createAndRename(
  world: Awaited<ReturnType<typeof documentWorld>>,
  documentId: number,
): Promise<{ statuses: number[]; body: string }> {
  const created = await world.ask('admin1', {
    method: 'POST',
    url: documentsPath(world.t1.installationId),
    payload: { name: 'Another', kind: 'individual' },
  });
  const renamed = await world.ask('admin1', {
    method: 'PATCH',
    url: `${documentsPath(world.t1.installationId)}/${documentId}`,
    payload: { name: 'Renamed' },
  });
  return { statuses: [created.statusCode, renamed.statusCode], body: created.body + renamed.body };
}

test('the text of a draft is in the answer of no route that answers today but the read of the draft: every GET is swept, and the other mutations of a document', async () => {
  const world = await documentWorld();
  const wide = { installationId: world.t1.installationId, documentId: world.t1.documentId };
  const scoped = { installationId: world.t1.installationId, documentId: world.t1.scoped.documentId };
  await saveDraftAs(world, 'admin1', wide, { contentMd: `${MARKER} wide\n`, expectedRevision: null });
  await saveDraftAs(world, 'repoAdmin1', scoped, { contentMd: `${MARKER} scoped\n`, expectedRevision: 1 });
  // A version of the same document, so that the routes of the history answer with a version and not with a 404 in this sweep.
  const published = await publishVersion(world.db, scoped.documentId, world.t1.publisherId, {
    major: 1,
    minor: 0,
    text: 'Published wording\n',
  });
  await enforceScopedDocument(world, published.id);
  await world.app.ready();
  const ids = {
    ...wide,
    documentId: scoped.documentId,
    repositoryId: world.t1.scoped.repositoryId,
    githubRepoId: world.t1.scoped.githubRepoId,
    versionId: published.id,
  };
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
  // The sign context answered with the published version of the document that has the draft: the sweep covered a real answer.
  expect(answers.find((answer) => answer.route === '/api/sign/:githubRepoId')?.body).toContain('Published wording');
  const mutated = await createAndRename(world, scoped.documentId);
  expect(mutated.statuses).toEqual([201, 200]);
  expect(mutated.body).not.toContain(MARKER);
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

test('only the statements of the drafts name the table, and only the draft service, the draft routes and the publish, which turns a draft into a version, read the text of a draft', () => {
  expect(filesWith(/\bcla_drafts\b/)).toEqual([
    'adapters/db/schema.ts',
    'services/cla-draft-queries.ts',
    'services/cla-draft-writes.ts',
  ]);
  expect(filesWith(/from '[^']*\/cla-draft-queries\.ts'/)).toEqual([
    'adapters/http/document-presenters.ts',
    'services/cla-documents.ts',
    'services/cla-drafts.ts',
    'services/cla-publish-source.ts',
  ]);
  expect(filesWith(/from '[^']*\/cla-draft-writes\.ts'/)).toEqual([
    'adapters/http/document-presenters.ts',
    'services/cla-drafts.ts',
    'services/cla-publish.ts',
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
