-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 Giovanni Manzoni
--
-- 007_installation_admin_seen (E11-S07): the ledger of the org admins a live lookup last saw. Forward-only: never edit
-- this file once merged, add a new migration instead.
--
-- GitHub refuses installation tokens for a suspended or uninstalled installation, so nobody's role can be asked of it
-- while the App is in that state. The ledger is the one bounded exception to "roles are verified live": the application
-- records the pair (installation, person) whenever a live lookup finds the person an admin of the organisation (at most
-- once a minute per pair), deletes it when a live lookup finds them no longer one, and reads it only for a suspended or
-- deleted installation, counting entries seen in the last 14 days. An admin can then still read and export signature
-- evidence while the App is away; the price is that someone demoted in the meantime keeps read access for at most 14 days
-- in that state. An installation of a user account needs no ledger: its owner is `installations.account_id`.
--
-- Numeric ids and a time only, never a login or a name: the table is not signer data and erasure does not touch it.
-- The installation is the tenant key every tenant table carries (E04-S06); the person is the numeric GitHub id, not
-- `users.id`, because the ledger is read for a person whose row may have been erased. Nothing here weakens migration 001:
-- no trigger, foreign key or grant is dropped or relaxed, and the runtime role gets nothing on any other table.

create table installation_admin_seen (
  installation_id  bigint not null references installations (id) on delete restrict,
  user_github_id   bigint not null check (user_github_id > 0),
  seen_at          timestamptz not null,
  primary key (installation_id, user_github_id)
);

-- The runtime role (cla_app) reads, writes, refreshes and deletes entries: a live negative deletes the pair, which is the
-- point of the table. It holds no privilege on the table until this block runs, and the block does nothing when the role
-- does not exist (a plain install or PGlite has none).
do $$
declare
  s text := quote_ident(current_schema());
begin
  if not exists (select 1 from pg_roles where rolname = 'cla_app') then
    raise notice 'role cla_app does not exist: runtime grants skipped';
    return;
  end if;
  execute format('grant select, insert, update, delete on %1$s.installation_admin_seen to cla_app', s);
end;
$$;
