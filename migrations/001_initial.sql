-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 Giovanni Manzoni
--
-- 001_initial: the MVP schema. Forward-only: never edit this file once merged, add a new migration instead
-- (the runner refuses to start when an applied migration changed). corporate_agreements and corporate_approvals
-- are phase 2 and arrive in a later migration.
--
-- Conventions
--   * GitHub ids are bigint and are the identity. Logins, names and emails are display snapshots only.
--   * Timestamps are timestamptz (an absolute instant, stored as UTC).
--   * Tenant tables carry installation_id and tie it to their parent with a composite foreign key, so a row can never
--     point at another tenant's repository or document. Every application query filters by installation_id.
--   * Nothing cascades into an immutable table: foreign keys are ON DELETE RESTRICT unless the child is disposable.
--   * Immutability is enforced by triggers (below), not by convention. The migration owner owns the tables; the
--     runtime role (cla_app) does not, so it cannot drop or disable a trigger. See "Runtime role" at the end.
--   * Personal data of a signer lives in users (login, name, avatar_url: a display snapshot), signer_pii and sessions.
--     erase_signer_pii() scrubs or deletes exactly those. The immutable core (signatures, cla_versions, audit_log)
--     holds numeric ids and codes only. Two kinds of text are NOT signer data and are not touched by erasure:
--     installations.account_login and repositories.full_name (public GitHub names of the maintainers' accounts and
--     repositories) and commit_overrides.reason (a maintainer's note about a commit). pr_evaluations.details must hold
--     numeric ids and codes only; the slice that writes it enforces that.
--
-- The runner applies each migration in one transaction, which is what makes the set_config(..., true) below local.

-- Functions created below are pinned (SET search_path FROM CURRENT) to this schema, then pg_catalog, with pg_temp
-- last, so a session cannot shadow a table by creating a temporary one in front of a SECURITY DEFINER function.
select set_config('search_path', quote_ident(current_schema()) || ', pg_catalog, pg_temp', true);

-- ---------------------------------------------------------------------------------------------------- identity

create table users (
  id          bigint generated always as identity primary key,
  github_id   bigint not null unique check (github_id > 0),
  login       text not null,
  name        text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table sessions (
  id                   bigint generated always as identity primary key,
  session_hash         text not null unique check (session_hash ~ '^[0-9a-f]{64}$'),
  user_id              bigint not null references users (id) on delete cascade,
  csrf_secret          text not null,
  created_at           timestamptz not null default now(),
  last_seen_at         timestamptz not null default now(),
  idle_expires_at      timestamptz not null,
  absolute_expires_at  timestamptz not null,
  check (idle_expires_at <= absolute_expires_at)
);
create index sessions_user_id_idx on sessions (user_id);
create index sessions_absolute_expires_at_idx on sessions (absolute_expires_at);

-- ------------------------------------------------------------------------------------------------ tenancy

create table installations (
  id                      bigint generated always as identity primary key,
  github_installation_id  bigint not null unique check (github_installation_id > 0),
  account_id              bigint not null check (account_id > 0),
  account_login           text not null,
  account_type            text not null check (account_type in ('Organization', 'User')),
  suspended_at            timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create table repositories (
  id               bigint generated always as identity primary key,
  installation_id  bigint not null references installations (id) on delete restrict,
  github_repo_id   bigint not null unique check (github_repo_id > 0),
  full_name        text not null,
  enabled          boolean not null default false,
  cla_document_id  bigint,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, installation_id)
);
create index repositories_installation_id_idx on repositories (installation_id);

-- ------------------------------------------------------------------------------------------- CLA documents

create table cla_documents (
  id                 bigint generated always as identity primary key,
  installation_id    bigint not null references installations (id) on delete restrict,
  repository_id      bigint,
  name               text not null check (length(btrim(name)) > 0),
  kind               text not null check (kind in ('individual', 'corporate')),
  active_version_id  bigint,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, installation_id),
  unique (id, installation_id, kind),
  unique nulls not distinct (installation_id, repository_id, name),
  foreign key (repository_id, installation_id) references repositories (id, installation_id) on delete restrict
);
create index cla_documents_repository_id_idx on cla_documents (repository_id);

-- A published version never changes (trigger below). content_sha256 must be the SHA-256 of content_md, so the stored
-- hash can be trusted as "the exact text shown".
create table cla_versions (
  id              bigint generated always as identity primary key,
  document_id     bigint not null references cla_documents (id) on delete restrict,
  major           integer not null check (major >= 1),
  minor           integer not null check (minor >= 0),
  content_md      text not null check (length(content_md) > 0),
  content_sha256  text not null check (content_sha256 = encode(sha256(convert_to(content_md, 'UTF8')), 'hex')),
  published_by    bigint not null references users (id) on delete restrict,
  rationale       text not null,
  published_at    timestamptz not null default now(),
  unique (document_id, major, minor),
  unique (id, document_id),
  unique (id, document_id, major, content_sha256)
);

-- The document points at its active version; a rollback publishes a new version, it never reactivates an old one
-- (cla_documents_guard_active_version below enforces that).
alter table cla_documents
  add constraint cla_documents_active_version_fk
  foreign key (active_version_id, id) references cla_versions (id, document_id) on delete restrict;

alter table repositories
  add constraint repositories_cla_document_fk
  foreign key (cla_document_id, installation_id) references cla_documents (id, installation_id) on delete restrict;

-- ------------------------------------------------------------------------------------------- signatures

-- Immutable core. Only revoked_at, revoked_by and revoke_reason ever change, and only from "not revoked" to "revoked"
-- (trigger below). No name, email or login lives here: that is signer_pii. revoke_reason is a code from a fixed set,
-- never free text, because a revoked row can never be edited and so could never be scrubbed. The version, document,
-- major and hash are tied together by one composite foreign key, and the document's kind must equal signer_type.
create table signatures (
  id                    bigint generated always as identity primary key,
  installation_id       bigint not null,
  user_id               bigint not null references users (id) on delete restrict,
  document_id           bigint not null,
  version_id            bigint not null,
  major                 integer not null,
  content_sha256        text not null,
  consent_text_id       text not null check (length(consent_text_id) > 0),
  signer_type           text not null check (signer_type in ('individual', 'corporate')),
  signed_at             timestamptz not null default now(),
  source_repository_id  bigint,
  source_pr_number      integer check (source_pr_number > 0),
  revoked_at            timestamptz,
  revoked_by            bigint references users (id) on delete restrict,
  revoke_reason         text check (revoke_reason in ('signer_request', 'maintainer_decision', 'legal_request', 'other')),
  unique (id, user_id),
  check ((revoked_at is null) = (revoked_by is null)),
  check (revoke_reason is null or revoked_at is not null),
  check (revoked_at is null or revoked_at >= signed_at),
  foreign key (document_id, installation_id, signer_type)
    references cla_documents (id, installation_id, kind) on delete restrict,
  foreign key (version_id, document_id, major, content_sha256)
    references cla_versions (id, document_id, major, content_sha256) on delete restrict,
  foreign key (source_repository_id, installation_id) references repositories (id, installation_id) on delete restrict
);
-- One valid signature per person, document and major version.
create unique index signatures_active_unique on signatures (user_id, document_id, major) where revoked_at is null;
create index signatures_installation_signed_at_idx on signatures (installation_id, signed_at desc);
create index signatures_document_id_idx on signatures (document_id);
create index signatures_version_id_idx on signatures (version_id);

-- Erasable personal data, one row per signature. Deleted only by erase_signer_pii().
create table signer_pii (
  signature_id  bigint primary key,
  user_id       bigint not null,
  name          text not null,
  email         text not null,
  login         text not null,
  created_at    timestamptz not null default now(),
  foreign key (signature_id, user_id) references signatures (id, user_id) on delete restrict
);
create index signer_pii_user_id_idx on signer_pii (user_id);

-- ------------------------------------------------------------------------------------ PR evaluation inputs

create table commit_overrides (
  id               bigint generated always as identity primary key,
  installation_id  bigint not null,
  repository_id    bigint not null,
  commit_sha       text not null check (commit_sha ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
  created_by       bigint not null references users (id) on delete restrict,
  reason           text not null check (length(btrim(reason)) > 0),
  created_at       timestamptz not null default now(),
  unique (repository_id, commit_sha),
  foreign key (repository_id, installation_id) references repositories (id, installation_id) on delete restrict
);
create index commit_overrides_installation_id_idx on commit_overrides (installation_id);

-- github_id is a user id, a bot account id or an organisation id depending on kind; never a login string.
create table allowlist_entries (
  id               bigint generated always as identity primary key,
  installation_id  bigint not null,
  repository_id    bigint,
  kind             text not null check (kind in ('user', 'bot', 'org_members')),
  github_id        bigint not null check (github_id > 0),
  created_by       bigint not null references users (id) on delete restrict,
  created_at       timestamptz not null default now(),
  unique nulls not distinct (installation_id, repository_id, kind, github_id),
  foreign key (repository_id, installation_id) references repositories (id, installation_id) on delete restrict
);

create table pr_evaluations (
  id               bigint generated always as identity primary key,
  installation_id  bigint not null,
  repository_id    bigint not null,
  pr_number        integer not null check (pr_number > 0),
  head_sha         text not null check (head_sha ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
  result           text not null check (result in ('in_progress', 'success', 'failure')),
  details          jsonb not null default '{}' check (jsonb_typeof(details) = 'object'),
  check_run_id     bigint,
  comment_id       bigint,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (repository_id, pr_number, head_sha),
  foreign key (repository_id, installation_id) references repositories (id, installation_id) on delete restrict
);
create index pr_evaluations_installation_result_idx on pr_evaluations (installation_id, result, updated_at desc);

-- ------------------------------------------------------------------------------------- webhooks and audit

-- GitHub reuses delivery_id on redelivery, so it is the idempotency key. No payload is stored: jobs re-fetch state.
create table webhook_deliveries (
  delivery_id   text primary key check (length(delivery_id) between 1 and 128),
  event         text not null,
  action        text,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz
);
create index webhook_deliveries_unprocessed_idx on webhook_deliveries (received_at) where processed_at is null;

create function audit_metadata_is_clean(metadata jsonb) returns boolean
language sql immutable parallel safe as $$
  select case when jsonb_typeof(metadata) = 'object' then not exists (
    select 1 from jsonb_each(metadata) as entry (key, value)
    where entry.key <> all (array[
            'count', 'signer_pii_rows', 'document_id', 'version_id', 'signature_id', 'repository_id', 'pr_number',
            'major', 'minor', 'reason_code', 'kind', 'enabled'
          ])
       or not (jsonb_typeof(entry.value) in ('number', 'boolean', 'null')
               or (jsonb_typeof(entry.value) = 'string' and (entry.value #>> '{}') ~ '^[a-z][a-z0-9_]{0,63}$'))
  ) else false end
$$;

-- Append-only (trigger below). Numeric ids and codes only: metadata is a flat object whose keys come from a fixed list
-- and whose values are numbers, booleans, null or lower-case codes (audit_metadata_is_clean). A new key needs a new
-- migration that replaces that function, which is the point: somebody decides that it cannot hold personal data.
create table audit_log (
  id               bigint generated always as identity primary key,
  occurred_at      timestamptz not null default now(),
  installation_id  bigint references installations (id) on delete restrict,
  actor_github_id  bigint check (actor_github_id > 0),
  action           text not null check (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'),
  subject_type     text,
  subject_id       bigint,
  metadata         jsonb not null default '{}' check (audit_metadata_is_clean(metadata)),
  check ((subject_type is null) = (subject_id is null))
);
create index audit_log_installation_occurred_at_idx on audit_log (installation_id, occurred_at desc);
create index audit_log_actor_occurred_at_idx on audit_log (actor_github_id, occurred_at desc);

-- -------------------------------------------------------------------------------------------- immutability

create function forbid_modification() returns trigger
language plpgsql as $$
begin
  raise exception '% is immutable: % is not allowed', tg_table_name, tg_op
    using errcode = 'restrict_violation',
          hint = 'Rows in this table are never updated or deleted; insert a new row instead.';
end;
$$;

-- CLA versions: fully immutable.
create trigger cla_versions_immutable before update or delete on cla_versions
  for each row execute function forbid_modification();
create trigger cla_versions_no_truncate before truncate on cla_versions
  for each statement execute function forbid_modification();

-- Audit log: append-only.
create trigger audit_log_immutable before update or delete on audit_log
  for each row execute function forbid_modification();
create trigger audit_log_no_truncate before truncate on audit_log
  for each statement execute function forbid_modification();

-- Signatures: never deleted, and the only possible UPDATE is revoking a signature that is not revoked yet. The core is
-- compared as a whole (to_jsonb minus the revocation columns), so a column added later is immutable by default.
create function signatures_guard_update() returns trigger
language plpgsql as $$
begin
  if to_jsonb(new) - 'revoked_at' - 'revoked_by' - 'revoke_reason'
     is distinct from to_jsonb(old) - 'revoked_at' - 'revoked_by' - 'revoke_reason' then
    raise exception 'signatures is immutable: only revoked_at, revoked_by and revoke_reason may be set'
      using errcode = 'restrict_violation';
  end if;
  if old.revoked_at is not null then
    raise exception 'signatures is immutable: a revoked signature cannot be changed or un-revoked'
      using errcode = 'restrict_violation';
  end if;
  if new.revoked_at is null then
    raise exception 'signatures is immutable: UPDATE is only allowed to revoke'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger signatures_guard_update before update on signatures
  for each row execute function signatures_guard_update();
create trigger signatures_no_delete before delete on signatures
  for each row execute function forbid_modification();
create trigger signatures_no_truncate before truncate on signatures
  for each statement execute function forbid_modification();

-- Identity columns. The runtime role may UPDATE users, installations, repositories and cla_documents (display fields,
-- flags, pointers), but the key a row is known by never changes: if users.github_id could, every signature of that user
-- would silently follow the new owner. Re-parenting a repository (a transfer) is a deliberate operation of its own.
-- The column names come from the trigger arguments.
create function forbid_identity_change() returns trigger
language plpgsql as $$
declare
  v_column text;
begin
  foreach v_column in array tg_argv loop
    if to_jsonb(new) -> v_column is distinct from to_jsonb(old) -> v_column then
      raise exception '%.% is immutable: it identifies the row', tg_table_name, v_column
        using errcode = 'restrict_violation',
              hint = 'Insert a new row instead of re-pointing an existing one.';
    end if;
  end loop;
  return new;
end;
$$;

create trigger users_identity_immutable before update on users
  for each row execute function forbid_identity_change('github_id');
create trigger installations_identity_immutable before update on installations
  for each row execute function forbid_identity_change('github_installation_id', 'account_id');
create trigger repositories_identity_immutable before update on repositories
  for each row execute function forbid_identity_change('github_repo_id', 'installation_id');
create trigger cla_documents_identity_immutable before update on cla_documents
  for each row execute function forbid_identity_change('installation_id', 'kind');

-- The active version of a document only moves forward: it must be the highest (major, minor) published for that
-- document. A rollback is a new version carrying the old text, never a pointer back to an old version, which would make
-- signatures of the old major count again. Pinned search_path: a temporary table cannot shadow cla_versions.
create function cla_documents_guard_active_version() returns trigger
language plpgsql
set search_path from current
as $$
begin
  if exists (
    select 1
    from cla_versions as chosen
    join cla_versions as newer on newer.document_id = chosen.document_id
                              and (newer.major, newer.minor) > (chosen.major, chosen.minor)
    where chosen.id = new.active_version_id and chosen.document_id = new.id
  ) then
    raise exception 'cla_documents.active_version_id must point at the highest published version of the document'
      using errcode = 'restrict_violation',
            hint = 'To roll back, publish a new version with the old text and activate that.';
  end if;
  return new;
end;
$$;

create trigger cla_documents_guard_active_version before update of active_version_id on cla_documents
  for each row execute function cla_documents_guard_active_version();

-- Evidence timestamps are the database clock's, not the caller's: signed_at and published_at must be within five
-- minutes of now() when the row is inserted (the default is now()). The column name is the trigger argument.
create function require_current_timestamp() returns trigger
language plpgsql as $$
begin
  if abs(extract(epoch from (now() - (to_jsonb(new) ->> tg_argv[0])::timestamptz))) > 300 then
    raise exception '%.% must be within five minutes of the database clock', tg_table_name, tg_argv[0]
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger cla_versions_current_timestamp before insert on cla_versions
  for each row execute function require_current_timestamp('published_at');
create trigger signatures_current_timestamp before insert on signatures
  for each row execute function require_current_timestamp('signed_at');

-- ------------------------------------------------------------------------------------------------ erasure

-- The only way to delete signer_pii (the runtime role has no DELETE on it). Removes the personal data of one person:
-- signer_pii rows and sessions are deleted, the display snapshot in users is scrubbed. It keeps the signature core (GDPR
-- Art. 17(3)(e), legal claims) and appends a PII-free audit row. SECURITY DEFINER: it runs as the table owner on behalf
-- of the runtime role. The actor is required, but it is the caller's attribution (the application passes the GitHub id of
-- the authenticated administrator): the database cannot verify it. The audit row is append-only (trigger), not chained.
create function erase_signer_pii(p_github_id bigint, p_actor_github_id bigint) returns integer
language plpgsql
security definer
set search_path from current
as $$
declare
  v_user_id bigint;
  v_deleted integer;
begin
  if p_actor_github_id is null or p_actor_github_id <= 0 then
    raise exception 'erase_signer_pii: the acting administrator is required' using errcode = 'invalid_parameter_value';
  end if;
  select id into v_user_id from users where github_id = p_github_id for update;
  if not found then
    raise exception 'erase_signer_pii: no user with that GitHub id' using errcode = 'no_data_found';
  end if;

  delete from signer_pii where user_id = v_user_id;
  get diagnostics v_deleted = row_count;

  delete from sessions where user_id = v_user_id;

  update users
     set login = 'erased-' || github_id::text, name = null, avatar_url = null, updated_at = now()
   where id = v_user_id;

  insert into audit_log (actor_github_id, action, subject_type, subject_id, metadata)
  values (p_actor_github_id, 'signer_pii.erased', 'user', p_github_id, jsonb_build_object('signer_pii_rows', v_deleted));

  return v_deleted;
end;
$$;

revoke all on function erase_signer_pii(bigint, bigint) from public;

-- Personal data cannot come back after an erasure: a signer_pii row for a signature that predates the person's erasure
-- is refused. Without this, a signing request that was in flight while the person was erased would write the name and
-- email again, after the audit row said they were gone. A signature made after the erasure (a new consent) may have its
-- own row. Pinned search_path, as above.
create function signer_pii_guard_insert() returns trigger
language plpgsql
set search_path from current
as $$
begin
  if exists (
    select 1
    from signatures as s
    join users as u on u.id = s.user_id
    join audit_log as a on a.action = 'signer_pii.erased' and a.subject_type = 'user' and a.subject_id = u.github_id
    where s.id = new.signature_id and a.occurred_at >= s.signed_at
  ) then
    raise exception 'signer_pii: the person of this signature was erased; their personal data is not stored again'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger signer_pii_guard_insert before insert on signer_pii
  for each row execute function signer_pii_guard_insert();

-- ---------------------------------------------------------------------------------------------- runtime role

-- The application connects as cla_app, which owns nothing. Grants are minimal, and only made when the role exists (see
-- docker/postgres-init.sql), so a plain install or PGlite works without it. Deliberately absent: DELETE on
-- signer_pii, signatures, cla_versions and audit_log; UPDATE on cla_versions, signer_pii and audit_log; TRUNCATE
-- anywhere; schema_migrations.
do $$
declare
  s text := quote_ident(current_schema());
begin
  if not exists (select 1 from pg_roles where rolname = 'cla_app') then
    raise notice 'role cla_app does not exist: runtime grants skipped';
    return;
  end if;
  execute format('grant usage on schema %s to cla_app', s);
  execute format('grant select, insert, update on %1$s.users, %1$s.installations, %1$s.repositories, %1$s.cla_documents, %1$s.pr_evaluations to cla_app', s);
  execute format('grant select, insert, update, delete on %1$s.sessions, %1$s.webhook_deliveries, %1$s.allowlist_entries to cla_app', s);
  execute format('grant select, insert, delete on %1$s.commit_overrides to cla_app', s);
  execute format('grant select, insert on %1$s.cla_versions, %1$s.signatures, %1$s.signer_pii, %1$s.audit_log to cla_app', s);
  execute format('grant update (revoked_at, revoked_by, revoke_reason) on %1$s.signatures to cla_app', s);
  execute format('grant execute on function %1$s.erase_signer_pii(bigint, bigint) to cla_app', s);
end;
$$;
