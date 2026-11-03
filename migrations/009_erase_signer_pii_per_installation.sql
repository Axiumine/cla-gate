-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 Giovanni Manzoni
--
-- 009_erase_signer_pii_per_installation (E16-S04): erasure of a signer's personal data is scoped to one installation.
-- Forward-only: never edit this file once merged, add a new migration instead.
--
-- Migration 001 erased a person everywhere from one call. With several orgs on one instance, the admin of one org asking
-- for it would reach the signatures another org holds, and another org's evidence is not theirs to change. The function
-- now takes the installation (installations.id, the tenant key) as a third argument and removes only what that tenant
-- holds; the two-argument function is dropped, so the only erase_signer_pii that exists is the scoped one.
--
--   * signer_pii: deleted only where the joined signatures.installation_id is the installation and the user matches.
--   * allowlist_entries.login_snapshot (E14-S06, a display snapshot of the login of a listed account): set to null for the
--     person's entries in that installation. The column does not exist before E14 adds it, so the function looks for it in
--     the catalogue and updates it when it is there; nothing has to be redefined when that migration lands.
--   * users (login, name, avatar_url: a display snapshot shared by every tenant) and sessions (verified_emails is an
--     email address): scrubbed and deleted only when no signer_pii row of the person remains in any tenant, because the
--     person is still a signer of another org until then.
--   * one audit row signer_pii.erased carries the installation, the acting administrator, the subject user/<github id>
--     and { signer_pii_rows }, and nothing else. The function returns the number of deleted signer_pii rows.
-- The signature core, the CLA versions and the audit log are untouched, and no grant or trigger of migration 001 is
-- dropped or relaxed. Erasure is not revocation: the signatures stay valid.
--
-- The guard on signer_pii inserts (migration 001) refuses personal data for a signature that predates the person's
-- erasure. Erasure is now per installation, so the guard looks at the erasures of the installation of the signature
-- (an audit row with no installation, written by the old function, still counts everywhere): erasing a person for one org
-- must not stop a signing that is in flight at another.

select set_config('search_path', quote_ident(current_schema()) || ', pg_catalog, pg_temp', true);

drop function erase_signer_pii(bigint, bigint);

create function erase_signer_pii(p_github_id bigint, p_actor_github_id bigint, p_installation_id bigint) returns integer
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
  if p_installation_id is null then
    raise exception 'erase_signer_pii: the installation is required' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from installations where id = p_installation_id) then
    raise exception 'erase_signer_pii: no installation with that id' using errcode = 'no_data_found';
  end if;
  select id into v_user_id from users where github_id = p_github_id for update;
  if not found then
    raise exception 'erase_signer_pii: no user with that GitHub id' using errcode = 'no_data_found';
  end if;

  delete from signer_pii as p
   using signatures as s
   where s.id = p.signature_id and s.installation_id = p_installation_id and p.user_id = v_user_id;
  get diagnostics v_deleted = row_count;

  if exists (
    select 1 from pg_attribute
    where attrelid = 'allowlist_entries'::regclass and attname = 'login_snapshot' and attnum > 0 and not attisdropped
  ) then
    execute 'update allowlist_entries set login_snapshot = null
              where installation_id = $1 and github_id = $2 and login_snapshot is not null'
      using p_installation_id, p_github_id;
  end if;

  if not exists (select 1 from signer_pii where user_id = v_user_id) then
    delete from sessions where user_id = v_user_id;
    update users
       set login = 'erased-' || github_id::text, name = null, avatar_url = null, updated_at = now()
     where id = v_user_id;
  end if;

  insert into audit_log (installation_id, actor_github_id, action, subject_type, subject_id, metadata)
  values (p_installation_id, p_actor_github_id, 'signer_pii.erased', 'user', p_github_id,
          jsonb_build_object('signer_pii_rows', v_deleted));

  return v_deleted;
end;
$$;

revoke all on function erase_signer_pii(bigint, bigint, bigint) from public;

create or replace function signer_pii_guard_insert() returns trigger
language plpgsql
set search_path from current
as $$
begin
  if exists (
    select 1
    from signatures as s
    join users as u on u.id = s.user_id
    join audit_log as a on a.action = 'signer_pii.erased' and a.subject_type = 'user' and a.subject_id = u.github_id
                       and (a.installation_id = s.installation_id or a.installation_id is null)
    where s.id = new.signature_id and a.occurred_at >= s.signed_at
  ) then
    raise exception 'signer_pii: the person of this signature was erased; their personal data is not stored again'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

-- The runtime role runs the function and nothing more: it still has no DELETE or UPDATE on signer_pii. The grant is made
-- only when the role exists (a plain install or PGlite has none), as in migration 001.
do $$
declare
  s text := quote_ident(current_schema());
begin
  if not exists (select 1 from pg_roles where rolname = 'cla_app') then
    raise notice 'role cla_app does not exist: runtime grants skipped';
    return;
  end if;
  execute format('grant execute on function %1$s.erase_signer_pii(bigint, bigint, bigint) to cla_app', s);
end;
$$;
