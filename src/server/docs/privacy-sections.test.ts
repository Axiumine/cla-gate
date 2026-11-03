// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { AUDIT_ACTIONS } from '../../shared/audit.ts';
import { DATA_EXPORT_AUDIT_LIMIT, DATA_EXPORT_PATH } from '../../shared/data-export.ts';
import { ERASURE_PREVIEW_PATH, ERASURES_PATH } from '../../shared/erasure.ts';
import { migratedTestDatabase } from '../adapters/db/test-support.ts';
import { HOUR_MS, RATE_LIMITS } from '../adapters/http/rate-limit.ts';
import { readPrivacyDoc } from './privacy-doc/test-support.ts';

// The sections of docs/privacy.md and the facts they state about the code (E16-S07): the paths and names an operator will
// type, the limits that are in force, and the points the story requires. A sentence that only repeats the story is held to
// its words; a sentence about the code is held to the code.

const SERVER = path.resolve(import.meta.dirname, '..');
const doc = readPrivacyDoc();

function sourceOf(file: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test: `file` is a literal path of this repository
  return fs.readFileSync(path.join(SERVER, file), 'utf8');
}

/** The text of the section that starts at the heading `title` and ends at the next heading of any level. */
function section(title: string): string {
  const start = doc.indexOf(`\n${title}\n`);
  const rest = doc.slice(start + title.length + 2);
  return rest.split(/\n#{2,3} /, 1)[0] ?? '';
}

test('the document opens by saying it is operational guidance and not legal advice, and who decides what', () => {
  const opening = doc.split('\n## ', 1)[0] ?? '';
  expect(opening).toContain('operational guidance for the people who run an instance');
  expect(opening).toContain('not legal advice');
  for (const decision of ['lawful basis', 'controller', 'processor', 'how long data is kept', 'with counsel']) {
    expect(opening, decision).toContain(decision);
  }
});

test('the document has the sections of the story, in order', () => {
  const headings = doc
    .split('\n')
    .filter((line) => /^#{1,3} /.test(line))
    .map((line) => line.trim());
  expect(headings).toEqual([
    '# Privacy notes for operators',
    '## What the instance holds about a person',
    '## What is never collected',
    '## Retention',
    '## Erasure runbook',
    '### What stays, and why',
    '## Answering an access request',
    '## The audit log',
    '## Backups',
    '## Several orgs on one instance',
  ]);
});

test('what is never collected names user tokens, request bodies, network metadata and the setting that limits it', () => {
  const text = section('## What is never collected');
  for (const needle of ['user token', 'Request bodies', 'IP address and user agent', 'RECORD_NETWORK_METADATA=true']) {
    expect(text, needle).toContain(needle);
  }
  for (const needle of [
    'legitimate interest',
    'short retention',
    'NETWORK_METADATA_RETENTION_DAYS',
    'from 1 to 90',
    '30 when unset',
  ]) {
    expect(text, needle).toContain(needle);
  }
});

test('the erasure runbook gives the two paths of the code, the function and the reason the core is kept', () => {
  const text = section('## Erasure runbook');
  expect(text).toContain(`GET ${ERASURE_PREVIEW_PATH}?githubUserId=<id>`);
  expect(text).toContain(`POST ${ERASURES_PATH}`);
  expect(text).toContain('x-csrf-token');
  expect(text).toContain('expectedRows');
  expect(text).toContain('erasedRows');
  expect(section('### What stays, and why')).toContain('GDPR Art. 17(3)(e)');
  expect(section('### What stays, and why')).toContain('Erasure is not revocation and not a ban');
});

test('the words the runbook quotes from the code are in the code', () => {
  const routes = sourceOf('adapters/http/erasure-routes.ts') + sourceOf('adapters/http/erasure-request.ts');
  for (const word of ['signer_erasure_done', 'count_changed']) {
    expect(routes, word).toContain(word);
    expect(section('## Erasure runbook'), word).toContain(word);
  }
});

test('the erasure function the runbook calls exists once, with the three arguments the runbook passes', async () => {
  const { db } = await migratedTestDatabase();
  const { rows } = await sql<{ args: number }>`
    select pronargs::int as args from pg_proc where proname = 'erase_signer_pii'`.execute(db);
  expect(rows).toEqual([{ args: 3 }]);
  expect(section('## Erasure runbook')).toContain(
    'erase_signer_pii(<github id>, <acting github id>, <installations.id>)',
  );
});

test('the access request section gives the path, the file name, the audit limit and the hourly budget of the code', () => {
  const text = section('## Answering an access request');
  expect(text).toContain(`GET ${DATA_EXPORT_PATH}`);
  expect(text).toContain('cla-data-<github id>.json');
  expect(text).toContain(`up to ${DATA_EXPORT_AUDIT_LIMIT.toLocaleString('en-US')} audit entries`);
  expect(HOUR_MS).toBe(3_600_000);
  expect(text).toContain(`${RATE_LIMITS.dataExport} requests an hour`);
});

test('the audit log section says it is append-only, numeric ids only, and never purged', () => {
  const text = section('## The audit log');
  for (const needle of [
    'append-only',
    'numeric ids',
    'never holds a name, an email, a login or an address',
    'nothing purges it',
  ]) {
    expect(text, needle).toContain(needle);
  }
});

test.each(['data_export.created', 'network_metadata.purged', 'signer_pii.erased'])(
  'the audit action %s that the document names is in the closed list of the code',
  (action) => {
    expect(doc).toContain(`\`${action}\``);
    expect(new Set<string>(AUDIT_ACTIONS).has(action)).toBe(true);
  },
);

test('the backups section states the three points of the story and the rule for the free-text field', () => {
  const text = section('## Backups');
  for (const needle of [
    'Erased data survives in backups until they expire',
    'brings the personal data back',
    'numeric ids only and no other data',
    'run the erasure again for every entry',
    'reason',
    'commit override',
    'must not contain personal data',
    'Revocation reasons are a fixed code set',
  ]) {
    expect(text, needle).toContain(needle);
  }
});

test('the several orgs section says erasure is per installation, what maintainers see, and who sees everything', () => {
  const text = section('## Several orgs on one instance');
  for (const needle of [
    'Erasure is per installation',
    'only their own audit log',
    'database access',
    'Tell the maintainers of each org',
  ]) {
    expect(text, needle).toContain(needle);
  }
});
