// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ColumnType, Generated } from 'kysely';
import type { InstallationRowId } from './installation-row-id.ts';

// Hand-written to match migrations/*.sql; schema.test.ts compares the column names with the live schema, so a
// drift in either direction fails a test. GitHub ids and identity keys are bigint in Postgres and `number` here: the
// drivers parse int8 with parseInt8 (int8.ts), which throws instead of losing precision above 2^53.

/** A jsonb column: read as an object, written as a JSON string (the pg driver would turn an array into a PG array). */
type JsonObject<Default extends boolean = false> = ColumnType<
  Record<string, unknown>,
  Default extends true ? string | undefined : string,
  string
>;

/** A jsonb column that holds an array with a default: read as an array (parse its elements), written as a JSON string. */
type JsonArray = ColumnType<unknown[], string | undefined, string>;

interface UsersTable {
  id: Generated<number>;
  github_id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

interface SessionsTable {
  id: Generated<number>;
  session_hash: string;
  user_id: number;
  csrf_secret: string;
  created_at: Generated<Date>;
  last_seen_at: Generated<Date>;
  idle_expires_at: Date;
  absolute_expires_at: Date;
  /** The verified addresses of the person at login, `[{ email, primary }]`, at most 20; personal data, gone with the row (migration 005, E10-S01). */
  verified_emails: JsonArray;
  /** The distinct domains of those addresses in the stored form (lower case, punycode), never an address; gone with the row (migration 021, E21-S04). */
  verified_email_domains: ColumnType<string[], string[] | undefined, string[]>;
}

interface InstallationsTable {
  id: Generated<InstallationRowId>;
  github_installation_id: number;
  account_id: number;
  account_login: string;
  /** `Other` is an account that is neither: an enterprise. It is stored, rejected and never served (migration 004). */
  account_type: 'Organization' | 'User' | 'Other';
  suspended_at: Date | null;
  /** The default is `rejected`: a row without a decision is never evaluated (migration 003, E05-S06). */
  admission_status: Generated<'admitted' | 'rejected'>;
  admission_reason: 'account_not_allowed' | 'policy_changed' | null;
  admission_decided_at: Date | null;
  deleted_at: Date | null;
  last_synced_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

interface RepositoriesTable {
  id: Generated<number>;
  installation_id: InstallationRowId;
  github_repo_id: number;
  full_name: string;
  enabled: Generated<boolean>;
  /** Whether the maintainers opted in to the public signature check (migration 019, E22-S02); off until an admin turns it on. */
  public_verification: Generated<boolean>;
  cla_document_id: number | null;
  /** The corporate CLA document of the repository (migration 020, E21-S01); null means individual signatures only. */
  corporate_document_id: number | null;
  /** Set when GitHub no longer lists the repository for the installation; the row itself stays (E05-S06). */
  removed_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

interface ClaDocumentsTable {
  id: Generated<number>;
  installation_id: number;
  repository_id: number | null;
  name: string;
  kind: 'individual' | 'corporate';
  active_version_id: number | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

interface ClaVersionsTable {
  id: Generated<number>;
  document_id: number;
  major: number;
  minor: number;
  content_md: string;
  content_sha256: string;
  published_by: number;
  rationale: string;
  published_at: Generated<Date>;
}

interface SignaturesTable {
  id: Generated<number>;
  installation_id: number;
  user_id: number;
  document_id: number;
  version_id: number;
  major: number;
  content_sha256: string;
  consent_text_id: string;
  signer_type: 'individual' | 'corporate';
  signed_at: Generated<Date>;
  source_repository_id: number | null;
  source_pr_number: number | null;
  revoked_at: Date | null;
  revoked_by: number | null;
  revoke_reason: 'signer_request' | 'maintainer_decision' | 'legal_request' | 'other' | null;
}

interface SignerPiiTable {
  signature_id: number;
  user_id: number;
  name: string;
  email: string;
  login: string;
  created_at: Generated<Date>;
  /** The address the signing request came from (E13-S05), only when `RECORD_NETWORK_METADATA` is on; `inet` reads back as text. */
  ip_address: string | null;
  /** The `User-Agent` of the signing request (E13-S05), at most 512 characters, only when `RECORD_NETWORK_METADATA` is on. */
  user_agent: string | null;
}

interface CommitOverridesTable {
  id: Generated<number>;
  installation_id: number;
  repository_id: number;
  commit_sha: string;
  created_by: number;
  reason: string;
  created_at: Generated<Date>;
}

interface AllowlistEntriesTable {
  id: Generated<number>;
  installation_id: number;
  repository_id: number | null;
  kind: 'user' | 'bot' | 'org_members';
  github_id: number;
  /** The login GitHub gave the account when the entry was made, to be shown and never matched on (migration 012); null after an erasure. */
  login_snapshot: string | null;
  created_by: number;
  created_at: Generated<Date>;
}

/** The state of a pull request as `pr_evaluations.pr_state` holds it: a merged pull request is `closed` (E15-S01). */
export type PullRequestState = 'open' | 'closed';

interface PrEvaluationsTable {
  id: Generated<number>;
  installation_id: number;
  repository_id: number;
  pr_number: number;
  head_sha: string;
  result: 'in_progress' | 'success' | 'failure' | 'cancelled';
  /** Whether the pull request is open or closed (merged counts as closed): the lifecycle flag of migration 016 (E15-S01), `open` by default. */
  pr_state: Generated<PullRequestState>;
  details: JsonObject<true>;
  check_run_id: number | null;
  comment_id: number | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/** The evaluation of a merge queue's group (migration 018, E22-S01): one row per head SHA of a repository, `destroyed_at` set when GitHub took the group down. */
interface MergeGroupEvaluationsTable {
  id: Generated<number>;
  installation_id: number;
  repository_id: number;
  head_sha: string;
  base_sha: string;
  result: Generated<'in_progress' | 'success' | 'failure'>;
  details: JsonObject<true>;
  check_run_id: number | null;
  destroyed_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

interface WebhookDeliveriesTable {
  delivery_id: string;
  event: string;
  action: string | null;
  received_at: Generated<Date>;
  processed_at: Date | null;
}

interface AuditLogTable {
  id: Generated<number>;
  occurred_at: Generated<Date>;
  installation_id: number | null;
  actor_github_id: number | null;
  action: string;
  subject_type: string | null;
  subject_id: number | null;
  metadata: JsonObject<true>;
}

/** The org admins a live lookup last saw, for a suspended or deleted installation (migration 007, E11-S07): numeric ids and a time. */
interface InstallationAdminSeenTable {
  installation_id: InstallationRowId;
  user_github_id: number;
  seen_at: Date;
}

/** The work in progress on the text of a CLA (migration 011, E12-S03): one mutable draft per document, `revision` raised by each save. */
interface ClaDraftsTable {
  document_id: number;
  installation_id: number;
  content_md: string;
  revision: Generated<number>;
  updated_by: number;
  updated_at: Generated<Date>;
}

/** One signed corporate CLA (migration 020, E21-S01): the consent of the signatory is the `signatures` row it points at. Insert-only. */
interface CorporateAgreementsTable {
  id: Generated<number>;
  installation_id: number;
  signature_id: number;
  document_id: number;
  major: number;
  created_at: Generated<Date>;
}

/** The erasable text of an agreement (migration 020, E21-S01): the company and the signatory's title. Deleted by `erase_signer_pii` only. */
interface CorporateAgreementPiiTable {
  agreement_id: number;
  company_name: string;
  signatory_title: string;
}

/** Who a corporate agreement covers (migration 020, E21-S01): a user or a GitHub org by numeric id, or an email domain. Only the `revoked_*` columns ever change. */
interface CorporateApprovalsTable {
  id: Generated<number>;
  installation_id: number;
  agreement_id: number;
  kind: 'user' | 'email_domain' | 'github_org';
  /** The numeric id of the user or org; null for an `email_domain`. */
  subject_github_id: number | null;
  /** The lower-case domain of an `email_domain`; null for the other kinds. */
  subject_domain: string | null;
  /** `manager` is the decision of the CLA manager; `rule` is a user approval derived from a domain or org approval. */
  source: 'manager' | 'rule';
  /** The manager (`users.id`) who approved; required exactly when `source` is `manager`. */
  approved_by: number | null;
  /** The domain or org approval a `rule` approval derives from; required exactly when `source` is `rule`. */
  derived_from_approval_id: number | null;
  approved_at: Generated<Date>;
  /** When a `rule` approval stops covering; required exactly when `source` is `rule`. */
  expires_at: Date | null;
  revoked_at: Date | null;
  revoked_by: number | null;
  /** Free text of at most 500 characters that is not erasable: never personal data. */
  revoke_reason: string | null;
}

/** The erasable login snapshot of an approved user or org (migration 020, E21-S01); display only. */
interface CorporateApprovalPiiTable {
  approval_id: number;
  login: string;
}

/** Every table created by the migrations except schema_migrations, which only the runner touches. */
export interface Database {
  users: UsersTable;
  sessions: SessionsTable;
  installations: InstallationsTable;
  repositories: RepositoriesTable;
  cla_documents: ClaDocumentsTable;
  cla_versions: ClaVersionsTable;
  signatures: SignaturesTable;
  signer_pii: SignerPiiTable;
  commit_overrides: CommitOverridesTable;
  allowlist_entries: AllowlistEntriesTable;
  pr_evaluations: PrEvaluationsTable;
  merge_group_evaluations: MergeGroupEvaluationsTable;
  webhook_deliveries: WebhookDeliveriesTable;
  audit_log: AuditLogTable;
  installation_admin_seen: InstallationAdminSeenTable;
  cla_drafts: ClaDraftsTable;
  corporate_agreements: CorporateAgreementsTable;
  corporate_agreement_pii: CorporateAgreementPiiTable;
  corporate_approvals: CorporateApprovalsTable;
  corporate_approval_pii: CorporateApprovalPiiTable;
}
