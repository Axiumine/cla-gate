-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 Giovanni Manzoni
--
-- 006_session_verified_emails (E10-S01): the verified e-mail addresses a person had at login. Forward-only: never edit
-- this file once merged, add a new migration instead.
--
-- The signing page (E13) offers the signer the verified addresses of their GitHub account. No GitHub user token is
-- stored, so the addresses are read once, at login, and kept with the session as [{ "email": "...", "primary": true }].
-- This is personal data with the shortest life the design allows: it lives exactly as long as the session row, is
-- deleted with it (logout, expiry, the purge on session creation, a revoked authorization, erase_signer_pii) and is
-- never copied anywhere except into signer_pii by the signature the person makes. The column is NOT NULL with an empty
-- array as default, so a session of a person without a verified address, and every session that exists today, holds [].
-- The check keeps the value an array of at most 20 elements; the shape of an element is parsed by the application.
-- Nothing else changes: the runtime role already holds select, insert, update and delete on sessions, which covers the
-- new column, and no trigger or immutability rule applies to sessions.

alter table sessions add column verified_emails jsonb not null default '[]';

-- A CASE, not an AND: Postgres does not promise to stop at the first false operand, and jsonb_array_length raises an
-- error for a value that is not an array.
alter table sessions
  add constraint sessions_verified_emails_check
  check (case when jsonb_typeof(verified_emails) = 'array' then jsonb_array_length(verified_emails) <= 20 else false end);
