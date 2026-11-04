// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import type { Database } from './schema.ts';
import { migratedTestDatabase } from './test-support.ts';

// Adding a column to schema.ts without listing it here is a compile error (Record needs every key), and a column in
// this list that the migration does not create, or a migration column missing from here, fails the test below.
const COLUMNS = {
  users: { id: true, github_id: true, login: true, name: true, avatar_url: true, created_at: true, updated_at: true },
  sessions: {
    id: true,
    session_hash: true,
    user_id: true,
    csrf_secret: true,
    created_at: true,
    last_seen_at: true,
    idle_expires_at: true,
    absolute_expires_at: true,
    verified_emails: true,
  },
  installations: {
    id: true,
    github_installation_id: true,
    account_id: true,
    account_login: true,
    account_type: true,
    suspended_at: true,
    admission_status: true,
    admission_reason: true,
    admission_decided_at: true,
    deleted_at: true,
    last_synced_at: true,
    created_at: true,
    updated_at: true,
  },
  repositories: {
    id: true,
    installation_id: true,
    github_repo_id: true,
    full_name: true,
    enabled: true,
    cla_document_id: true,
    removed_at: true,
    created_at: true,
    updated_at: true,
  },
  cla_documents: {
    id: true,
    installation_id: true,
    repository_id: true,
    name: true,
    kind: true,
    active_version_id: true,
    created_at: true,
    updated_at: true,
  },
  cla_versions: {
    id: true,
    document_id: true,
    major: true,
    minor: true,
    content_md: true,
    content_sha256: true,
    published_by: true,
    rationale: true,
    published_at: true,
  },
  signatures: {
    id: true,
    installation_id: true,
    user_id: true,
    document_id: true,
    version_id: true,
    major: true,
    content_sha256: true,
    consent_text_id: true,
    signer_type: true,
    signed_at: true,
    source_repository_id: true,
    source_pr_number: true,
    revoked_at: true,
    revoked_by: true,
    revoke_reason: true,
  },
  signer_pii: { signature_id: true, user_id: true, name: true, email: true, login: true, created_at: true },
  commit_overrides: {
    id: true,
    installation_id: true,
    repository_id: true,
    commit_sha: true,
    created_by: true,
    reason: true,
    created_at: true,
  },
  allowlist_entries: {
    id: true,
    installation_id: true,
    repository_id: true,
    kind: true,
    github_id: true,
    login_snapshot: true,
    created_by: true,
    created_at: true,
  },
  pr_evaluations: {
    id: true,
    installation_id: true,
    repository_id: true,
    pr_number: true,
    head_sha: true,
    result: true,
    details: true,
    check_run_id: true,
    comment_id: true,
    created_at: true,
    updated_at: true,
  },
  webhook_deliveries: { delivery_id: true, event: true, action: true, received_at: true, processed_at: true },
  audit_log: {
    id: true,
    occurred_at: true,
    installation_id: true,
    actor_github_id: true,
    action: true,
    subject_type: true,
    subject_id: true,
    metadata: true,
  },
  installation_admin_seen: { installation_id: true, user_github_id: true, seen_at: true },
  cla_drafts: {
    document_id: true,
    installation_id: true,
    content_md: true,
    revision: true,
    updated_by: true,
    updated_at: true,
  },
} satisfies { [Table in keyof Database]: Record<keyof Database[Table], true> };

const BY_NAME = (a: string, b: string): number => a.localeCompare(b);

test('the Database interface lists exactly the tables the migrations create', async () => {
  const { db } = await migratedTestDatabase();
  const { rows } = await sql<{ table_name: string }>`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> 'schema_migrations'`.execute(db);
  expect(rows.map((row) => row.table_name).toSorted(BY_NAME)).toEqual(Object.keys(COLUMNS).toSorted(BY_NAME));
});

test.each(Object.entries(COLUMNS))('the %s table has exactly the columns of its interface', async (table, columns) => {
  const { db } = await migratedTestDatabase();
  const { rows } = await sql<{ column_name: string }>`
    select column_name from information_schema.columns where table_schema = 'public' and table_name = ${table}`.execute(
    db,
  );
  expect(rows.map((row) => row.column_name).toSorted(BY_NAME)).toEqual(Object.keys(columns).toSorted(BY_NAME));
});

test('values come back typed as the interface says: ids as numbers, timestamps as dates, jsonb as objects', async () => {
  const { db } = await migratedTestDatabase();
  await db
    .insertInto('audit_log')
    .values({ action: 'cla.checked', actor_github_id: 41_898_282, metadata: '{"count":1}' })
    .execute();
  const row = await db.selectFrom('audit_log').selectAll().executeTakeFirstOrThrow();
  const anyNumber: unknown = expect.any(Number);
  const anyDate: unknown = expect.any(Date);
  expect(row).toEqual({
    id: anyNumber,
    occurred_at: anyDate,
    installation_id: null,
    actor_github_id: 41_898_282,
    action: 'cla.checked',
    subject_type: null,
    subject_id: null,
    metadata: { count: 1 },
  });
});
