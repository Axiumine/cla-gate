-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 Giovanni Manzoni
--
-- 013_erase_allowlist_only_person (E14-S06): the erasure reaches the login of an allowlisted account that never signed.
-- Forward-only: never edit this file once merged, add a new migration instead.
--
-- Migration 012 added allowlist_entries.login_snapshot, a display snapshot of the login of a listed account, and the
-- function of migration 009 clears it for the person's entries in the installation. But that function started by looking the
-- person up in `users` and raised 'no user with that GitHub id' when there was none, and an allowlisted account (a bot, a
-- maintainer) typically never signed in or signed anything: its snapshot could not be erased through the function, though
-- it is personal data of a person.
--
-- The function is redefined (same name, same three arguments, so its grants and the revoke from public stay as they are):
--   * a person with no `users` row is no longer an error when the installation holds an allowlist entry for their id; the
--     entry's login snapshot is cleared, no signer_pii row is deleted (none can exist without a user), the sessions and the
--     user row that are not there are not touched, and the audit row signer_pii.erased is written with { signer_pii_rows: 0 };
--   * a person known to neither `users` nor the allowlist of the installation is still 'no user with that GitHub id';
--   * the snapshot is cleared by a plain statement now, since the column exists from migration 012 on (migration 009 looked it
--     up in the catalogue because it was written first).
-- Everything else is as in migration 009: the work stays inside one installation, the users row and the sessions are scrubbed
-- only when no signer_pii row of the person remains in any tenant, the audit row carries the installation, the acting
-- administrator, the subject user/<github id> and { signer_pii_rows } and nothing else, and the function returns the number
-- of deleted signer_pii rows. No table, trigger or grant changes; erasure is not revocation.

select set_config('search_path', quote_ident(current_schema()) || ', pg_catalog, pg_temp', true);

create or replace function erase_signer_pii(p_github_id bigint, p_actor_github_id bigint, p_installation_id bigint) returns integer
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
  if not found and not exists (
    select 1 from allowlist_entries where installation_id = p_installation_id and github_id = p_github_id
  ) then
    raise exception 'erase_signer_pii: no user with that GitHub id' using errcode = 'no_data_found';
  end if;

  -- Without a users row v_user_id is null, which matches no signer_pii row: the delete changes nothing, the scrub of the user
  -- and the sessions is skipped, and the person is only an allowlisted account.
  delete from signer_pii as p
   using signatures as s
   where s.id = p.signature_id and s.installation_id = p_installation_id and p.user_id = v_user_id;
  get diagnostics v_deleted = row_count;

  update allowlist_entries set login_snapshot = null
   where installation_id = p_installation_id and github_id = p_github_id and login_snapshot is not null;

  if v_user_id is not null and not exists (select 1 from signer_pii where user_id = v_user_id) then
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
