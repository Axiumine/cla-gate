// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { AUDIT_ACTION_PATTERN, AUDIT_ACTIONS, AUDIT_METADATA_KEYS, INSTANCE_ACTIONS, SYSTEM_ACTIONS } from './audit.ts';

test.each(AUDIT_ACTIONS)('the action %s matches the database check on audit_log.action', (action) => {
  expect(action).toMatch(AUDIT_ACTION_PATTERN);
});

test.each([
  'Installation.rejected',
  'installation',
  'installation..rejected',
  '.rejected',
  'installation.',
  'installation-rejected',
  '1installation.rejected',
  'installation rejected',
  'installation.rejected\n',
  '',
])('the pattern refuses %j', (action) => {
  expect(AUDIT_ACTION_PATTERN.test(action)).toBe(action === 'installation');
});

test('the tuple starts with the nine actions E05 writes, in order', () => {
  expect(AUDIT_ACTIONS.slice(0, 9)).toEqual([
    'installation.rejected',
    'installation.deleted',
    'installation.suspended',
    'installation.unsuspended',
    'repository.added',
    'repository.removed',
    'repository.renamed',
    'repository.enabled',
    'repository.disabled',
  ]);
});

test('the tenth action is installation.admitted, added by E05-S07 next to installation.rejected', () => {
  expect(AUDIT_ACTIONS[9]).toBe('installation.admitted');
  expect(SYSTEM_ACTIONS.has('installation.admitted')).toBe(true);
  expect(INSTANCE_ACTIONS.has('installation.admitted')).toBe(false);
});

test('the eleventh action is installation.updated, added by E05-S08 for a refreshed account snapshot', () => {
  expect(AUDIT_ACTIONS[10]).toBe('installation.updated');
  expect(SYSTEM_ACTIONS.has('installation.updated')).toBe(true);
  expect(INSTANCE_ACTIONS.has('installation.updated')).toBe(false);
});

test('no action and no metadata key is listed twice', () => {
  expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
  expect(new Set(AUDIT_METADATA_KEYS).size).toBe(AUDIT_METADATA_KEYS.length);
});

test('system actions are those performed by webhooks and schedules, and are all audit actions', () => {
  expect([...SYSTEM_ACTIONS]).toEqual([
    'installation.rejected',
    'installation.admitted',
    'installation.updated',
    'installation.deleted',
    'installation.suspended',
    'installation.unsuspended',
    'repository.added',
    'repository.removed',
    'repository.renamed',
    'network_metadata.purged',
  ]);
  expect([...SYSTEM_ACTIONS].every((action) => AUDIT_ACTIONS.includes(action))).toBe(true);
});

test('instance actions are the two that belong to no tenant, and are all audit actions', () => {
  expect([...INSTANCE_ACTIONS]).toEqual(['data_export.created', 'network_metadata.purged']);
  expect([...INSTANCE_ACTIONS].every((action) => AUDIT_ACTIONS.includes(action))).toBe(true);
});

test('the metadata keys are the 12 of migration 001 followed by the 19 of migration 002', () => {
  expect(AUDIT_METADATA_KEYS).toHaveLength(31);
  expect(AUDIT_METADATA_KEYS.slice(0, 12)).toEqual([
    'count',
    'signer_pii_rows',
    'document_id',
    'version_id',
    'signature_id',
    'repository_id',
    'pr_number',
    'major',
    'minor',
    'reason_code',
    'kind',
    'enabled',
  ]);
  expect(AUDIT_METADATA_KEYS.slice(12)).toEqual([
    'account_id',
    'account_type',
    'scope',
    'github_id',
    'user_github_id',
    'previous_document_id',
    'source_repository_id',
    'source_pr_number',
    'revision',
    'bump',
    'affected_signatures',
    'rolled_back_from_version_id',
    'commit_sha',
    'state',
    'row_count',
    'rows',
    'signature_count',
    'webhook_deliveries',
    'sessions',
  ]);
});

test.each(['name', 'email', 'login', 'avatar_url', 'reason', 'message', 'title', 'text'])(
  'the personal-data or free-text key %s is never a metadata key',
  (key) => {
    expect(AUDIT_METADATA_KEYS.some((member) => member === key)).toBe(false);
  },
);

test.each(AUDIT_METADATA_KEYS)('the metadata key %s is lower snake case', (key) => {
  expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
});
