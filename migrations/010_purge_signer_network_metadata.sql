-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 Giovanni Manzoni
--
-- 010_purge_signer_network_metadata (E16-S05): the retention of the optional network metadata. Forward-only: never edit this
-- file once merged, add a new migration instead.
--
-- E13-S05 may store the IP address and the user agent of a signing on signer_pii (ip_address, user_agent), only when the
-- operator switched recording on. They are kept for NETWORK_METADATA_RETENTION_DAYS and then removed. The runtime role has no
-- UPDATE on signer_pii (migration 001) and must not get one, so the removal is a SECURITY DEFINER function, like the erasure:
--
--   purge_signer_network_metadata(p_cutoff)  sets ip_address and user_agent to NULL on every signer_pii row created before
--   the cutoff (a row at the cutoff is kept) where either is set, in one statement, and returns the number of rows changed.
--   When that number is above zero it appends one audit row network_metadata.purged: no actor (it is a schedule), no
--   installation (retention is a setting of the instance, so one run reaches every tenant), no subject, and { rows } as the
--   only metadata. A run that changes nothing writes nothing, so a second run on the same data is silent.
--
-- The two columns do not exist before E13-S05 adds them, so the function looks them up in the catalogue and clears the ones
-- that are there; nothing has to be redefined when that migration lands, and a run before it returns 0. name, email, login and
-- the signature core are never touched (erasure, migration 009, is the only way to remove those). The update and the audit
-- insert are one function call, so an audit row that cannot be written undoes the purge: no row loses its values unrecorded.

select set_config('search_path', quote_ident(current_schema()) || ', pg_catalog, pg_temp', true);

create function purge_signer_network_metadata(p_cutoff timestamptz) returns integer
language plpgsql
security definer
set search_path from current
as $$
declare
  v_assignments text;
  v_present text;
  v_rows integer := 0;
begin
  if p_cutoff is null then
    raise exception 'purge_signer_network_metadata: the cutoff is required' using errcode = 'invalid_parameter_value';
  end if;

  select string_agg(format('%I = null', attname), ', ' order by attname),
         string_agg(format('%I is not null', attname), ' or ' order by attname)
    into v_assignments, v_present
    from pg_attribute
   where attrelid = 'signer_pii'::regclass
     and attname in ('ip_address', 'user_agent')
     and attnum > 0
     and not attisdropped;

  if v_assignments is not null then
    execute format('update signer_pii set %s where created_at < $1 and (%s)', v_assignments, v_present)
      using p_cutoff;
    get diagnostics v_rows = row_count;
  end if;

  if v_rows > 0 then
    insert into audit_log (action, metadata)
    values ('network_metadata.purged', jsonb_build_object('rows', v_rows));
  end if;

  return v_rows;
end;
$$;

revoke all on function purge_signer_network_metadata(timestamptz) from public;

-- The runtime role runs the function and nothing more: it still has no UPDATE on signer_pii. The grant is made only when the
-- role exists (a plain install or PGlite has none), as in migrations 001 and 009.
do $$
declare
  s text := quote_ident(current_schema());
begin
  if not exists (select 1 from pg_roles where rolname = 'cla_app') then
    raise notice 'role cla_app does not exist: runtime grants skipped';
    return;
  end if;
  execute format('grant execute on function %1$s.purge_signer_network_metadata(timestamptz) to cla_app', s);
end;
$$;
