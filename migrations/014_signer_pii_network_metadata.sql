-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 Giovanni Manzoni
--
-- 014_signer_pii_network_metadata (E13-S05): the optional network metadata of a signing. Forward-only: never edit this file
-- once merged, add a new migration instead.
--
-- Two nullable columns on the erasable personal data of a signature: the address the signing request came from (ip_address,
-- inet) and its User-Agent header (user_agent, text, at most 512 characters). Both are NULL unless the operator switched
-- RECORD_NETWORK_METADATA on, so the columns say nothing about the default installation. They are personal data and live
-- where the other personal data of a signer lives, in signer_pii: erase_signer_pii (migration 009) deletes the whole row,
-- and purge_signer_network_metadata (migration 010) sets the two columns to NULL after NETWORK_METADATA_RETENTION_DAYS.
-- Both functions find the columns in the catalogue, so neither is redefined here.
--
-- Nothing is added to signatures or audit_log: the immutable core and the audit trail stay free of network values. The
-- runtime role's table-level INSERT and SELECT on signer_pii (migration 001) already cover a column added later, so no grant
-- changes, and the role still has no UPDATE or DELETE on the table.

alter table signer_pii
  add column ip_address inet null,
  add column user_agent text null,
  add constraint signer_pii_user_agent_length check (user_agent is null or length(user_agent) <= 512);
