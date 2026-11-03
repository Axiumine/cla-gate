// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { VERSION_PATH, VERSIONS_PATH } from '../../../shared/cla.ts';
import { documentWorld, errorCodeOf, versionPath, versionsPath } from './document-fixture/test-support.ts';

// Published versions are immutable (E12-S05): no route changes or deletes one. The route table of the real application is
// held to that, so immutability is not a convention that the next route can forget.

const nameOf = (entry: { readonly method: string; readonly url: string }): string => `${entry.method} ${entry.url}`;

test('the version paths have a GET and a POST (the publish) on the versions of a document and a GET on one version, and no other method', async () => {
  const world = await documentWorld();
  await world.app.ready();
  const onVersions = world.app.routeAccess.filter((entry) => entry.url.startsWith(VERSIONS_PATH));
  expect(onVersions.map(nameOf).toSorted((a, b) => a.localeCompare(b))).toEqual(
    [`GET ${VERSION_PATH}`, `GET ${VERSIONS_PATH}`, `POST ${VERSIONS_PATH}`].toSorted((a, b) => a.localeCompare(b)),
  );
  expect(onVersions.filter((entry) => !['GET', 'POST'].includes(entry.method))).toEqual([]);
  expect(onVersions.filter((entry) => entry.url === VERSION_PATH).map((entry) => entry.method)).toEqual(['GET']);
});

test('every version route of the table is either the publish, which creates a version, or a read: nothing in the table updates or removes one', async () => {
  const world = await documentWorld();
  await world.app.ready();
  const mutating = world.app.routeAccess.filter((entry) => entry.url.includes('/versions') && entry.method !== 'GET');
  expect(mutating.map(nameOf)).toEqual([`POST ${VERSIONS_PATH}`]);
});

test.each(['PUT', 'PATCH', 'DELETE'] as const)(
  '%s on a version, and on the versions of a document, finds no route: 404, and the version is as it was',
  async (method) => {
    const world = await documentWorld();
    const { installationId, documentId, versionId } = { ...world.t1, documentId: world.t1.documentId };
    const before = await world.db.selectFrom('cla_versions').selectAll().orderBy('id').execute();
    const payload = { rationale: 'Rewritten', contentMd: 'Rewritten\n' };
    const one = await world.ask('admin1', { method, url: versionPath(installationId, documentId, versionId), payload });
    const many = await world.ask('admin1', { method, url: versionsPath(installationId, documentId), payload });
    expect([one.statusCode, many.statusCode]).toEqual([404, 404]);
    expect([errorCodeOf(one), errorCodeOf(many)]).toEqual(['not_found', 'not_found']);
    expect(await world.db.selectFrom('cla_versions').selectAll().orderBy('id').execute()).toEqual(before);
  },
);
