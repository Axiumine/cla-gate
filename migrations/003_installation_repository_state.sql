-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 Giovanni Manzoni
--
-- 003_installation_repository_state (E05-S06): what the installation lifecycle needs to remember. Forward-only: never
-- edit this file once merged, add a new migration instead.
--
--   * installations gain the admission decision (is this account one the instance serves), the time of the last
--     decision, the uninstall time and the time of the last sync. Nothing is ever deleted: an uninstall sets deleted_at
--     and the signatures, documents and audit rows of that tenant stay where they are.
--   * repositories gain removed_at (access lost, uninstalled or transferred away). The global unique (github_repo_id)
--     becomes unique (installation_id, github_repo_id) plus a partial unique index over the repositories that are not
--     removed: a repository is active under at most one installation, and a transfer inserts a new row under the new
--     tenant without touching the old tenant's row, its documents or its signatures.
--
-- admission_status defaults to 'rejected': a row inserted without a decision (and every row that existed before this
-- migration) can never be evaluated, so a missing decision fails closed. Nothing here weakens migration 001: no trigger,
-- foreign key or grant is dropped, and the only constraint relaxed is the global uniqueness above, which the partial
-- index narrows instead of dropping.

alter table installations
  add column admission_status text not null default 'rejected'
    check (admission_status in ('admitted', 'rejected')),
  add column admission_reason text
    check (admission_reason is null or admission_reason in ('account_not_allowed', 'policy_changed')),
  add column admission_decided_at timestamptz,
  add column deleted_at timestamptz,
  add column last_synced_at timestamptz;

alter table repositories
  add column removed_at timestamptz;

-- The global uniqueness of migration 001 (named by Postgres after the table and column) is replaced by the pair below.
alter table repositories drop constraint repositories_github_repo_id_key;
alter table repositories
  add constraint repositories_installation_id_github_repo_id_key unique (installation_id, github_repo_id);
create unique index repositories_active_github_repo_id_key on repositories (github_repo_id) where removed_at is null;

-- The runtime role (cla_app) holds select, insert and update on both tables from migration 001 and no delete or truncate;
-- a table-level grant covers the new columns, so nothing needs granting here. The revoke below restates the rule this
-- story depends on ("nothing is deleted": an uninstall sets deleted_at, a removal sets removed_at) in the migration
-- itself. It only takes privileges away, and only when the role exists (a plain install or PGlite has none).
do $$
declare
  s text := quote_ident(current_schema());
begin
  if not exists (select 1 from pg_roles where rolname = 'cla_app') then
    raise notice 'role cla_app does not exist: runtime grants skipped';
    return;
  end if;
  execute format('revoke delete, truncate on %1$s.installations, %1$s.repositories from cla_app', s);
end;
$$;
