-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 Giovanni Manzoni
--
-- 002_audit_metadata_allowlist (E04-S09): widens what audit_log.metadata may hold, so the keys and values that later
-- epics write (account ids and types, scopes, hex commit SHAs, lists of ids) are accepted. Forward-only: never edit
-- this file once merged. A key that is not listed here needs a NEW migration that replaces the function again; the
-- test src/server/adapters/db/migration-002-audit-metadata.test.ts compares the list below with AUDIT_METADATA_KEYS
-- in src/shared/audit.ts and fails until both say the same.
--
-- Still an allowlist, never a denylist: a key must be listed to pass, so a personal-data key (name, email, login,
-- avatar_url) or free text (reason, message, title, text) cannot get in by being unthought of. Values are:
--   * integers (no fractions), booleans and null;
--   * lists of at most 100 integers;
--   * codes of 1 to 64 characters from [a-z0-9_.:-]: enum-like names and hex digests, never a sentence, and never
--     shaped like an IP address. Migration 001 refused such a value by refusing every digit-first, dotted or colon
--     string; the wider character class here must not let network metadata (IP, user agent) in, so a string is also
--     refused when it is four dotted numbers of 1 to 3 digits with an optional port (IPv4), or made only of hex digits,
--     dots and colons with at least two colons (IPv6, a mapped IPv4 address included). src/shared/audit-metadata.ts
--     holds the same two patterns and the shared case table in src/shared/test-support.ts pins both layers.
-- The size cap of 2,048 bytes is checked by the writer (src/server/services/audit.ts), not here.
--
-- The 12 keys of migration 001 stay; the 19 after them are new. The check constraint on audit_log calls the function,
-- so replacing it applies to every later insert; existing rows are not re-checked and the table stays append-only.

-- Same schema as migration 001 created the function in. CASE below, not AND: SQL does not promise to evaluate the
-- operands of AND in order, and jsonb_array_length() raises an error on anything but an array.
select set_config('search_path', quote_ident(current_schema()) || ', pg_catalog, pg_temp', true);

create or replace function audit_metadata_is_clean(metadata jsonb) returns boolean
language sql immutable parallel safe as $$
  select case when jsonb_typeof(metadata) = 'object' then not exists (
    select 1 from jsonb_each(metadata) as entry (key, value)
    where entry.key <> all (array[
            'count', 'signer_pii_rows', 'document_id', 'version_id', 'signature_id', 'repository_id', 'pr_number',
            'major', 'minor', 'reason_code', 'kind', 'enabled',
            'account_id', 'account_type', 'scope', 'github_id', 'user_github_id', 'previous_document_id',
            'source_repository_id', 'source_pr_number', 'revision', 'bump', 'affected_signatures',
            'rolled_back_from_version_id', 'commit_sha', 'state', 'row_count', 'rows', 'signature_count',
            'webhook_deliveries', 'sessions'
          ])
       or not (case jsonb_typeof(entry.value)
                 when 'number' then (entry.value #>> '{}') ~ '^-?[0-9]+$'
                 when 'boolean' then true
                 when 'null' then true
                 when 'string' then (entry.value #>> '{}') ~ '^[a-z0-9_.:-]{1,64}$'
                   and (entry.value #>> '{}') !~ '^[0-9]{1,3}([.][0-9]{1,3}){3}(:[0-9]{1,5})?$'
                   and not ((entry.value #>> '{}') ~ '^[0-9a-f:.]+$'
                            and length(entry.value #>> '{}') - length(replace(entry.value #>> '{}', ':', '')) >= 2)
                 when 'array' then jsonb_array_length(entry.value) <= 100 and not exists (
                   select 1 from jsonb_array_elements(entry.value) as element (item)
                   where jsonb_typeof(element.item) <> 'number' or (element.item #>> '{}') !~ '^-?[0-9]+$'
                 )
                 else false
               end)
  ) else false end
$$;
