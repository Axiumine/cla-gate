-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 Giovanni Manzoni
--
-- 018_merge_group_evaluations (E22-S01): the evaluation of a merge queue's group. Forward-only: never edit this file once merged,
-- add a new migration instead.
--
-- With a merge queue and a required `license/cla` check, GitHub waits for the check on the head SHA of the merge group. One row
-- per group (the head SHA is unique per repository) holds what the job concluded: `in_progress` while it runs, then `success`
-- (every pull request of the group is covered) or `failure`, with `details` (numeric pull request numbers, outcomes and codes of a
-- closed set, never a name, login or email) and the id of the Check Run written on the head SHA. `destroyed_at` is set when
-- GitHub took the group down (merged, invalidated or dequeued): a job that finds it writes nothing, and a run that was waiting
-- behind the deletion of the group never reports on a commit nobody looks at. The `destroyed` delivery creates the row when no job
-- has yet (a tombstone: `in_progress`, no details), so a job that runs after the group was taken down finds it and ends.
--
-- A tenant table: it carries the installation id and ties it to the repository with a composite foreign key (E04-S06), so a row
-- can never pair one tenant's repository with another tenant's installation. The pair (repository, head SHA) is the idempotency
-- key of the whole job: two deliveries for one SHA leave one row. Deleting a repository that a row points at is refused (on
-- delete restrict). Nothing here touches the tables of migration 001: no trigger, foreign key or grant of any other table changes,
-- and the row holds no personal data, so erasure does not touch it.

create table merge_group_evaluations (
  id               bigint generated always as identity primary key,
  installation_id  bigint not null,
  repository_id    bigint not null,
  head_sha         text not null check (head_sha ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
  base_sha         text not null check (base_sha ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
  result           text not null default 'in_progress' check (result in ('in_progress', 'success', 'failure')),
  details          jsonb not null default '{}' check (jsonb_typeof(details) = 'object'),
  check_run_id     bigint check (check_run_id > 0),
  destroyed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (repository_id, head_sha),
  foreign key (repository_id, installation_id) references repositories (id, installation_id) on delete restrict
);
create index merge_group_evaluations_installation_idx on merge_group_evaluations (installation_id, updated_at desc);

-- The runtime role (cla_app) creates the row, writes the verdict and marks the group destroyed. It holds no privilege on the table
-- until this block runs, and the block does nothing when the role does not exist (a plain install or PGlite has none). No DELETE:
-- no job removes a group's row, and a retention sweep, if there is ever one, brings its own migration.
do $$
declare
  s text := quote_ident(current_schema());
begin
  if not exists (select 1 from pg_roles where rolname = 'cla_app') then
    raise notice 'role cla_app does not exist: runtime grants skipped';
    return;
  end if;
  execute format('grant select, insert, update on %1$s.merge_group_evaluations to cla_app', s);
end;
$$;
