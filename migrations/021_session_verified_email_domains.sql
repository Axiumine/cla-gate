-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 Giovanni Manzoni
--
-- 021_session_verified_email_domains (E21-S04): the domains of the verified e-mail addresses a person had at login. Forward-only: never
-- edit this file once merged, add a new migration instead.
--
-- The claim of an employee under an employer's corporate agreement (E21-S04) matches the e-mail domains the manager approved against
-- the domains of the person's verified addresses. No GitHub user token is stored, so the domains are read once, at login, and kept with
-- the session, next to `verified_emails` (migration 005). Only the DOMAINS are kept here, never an address: each element is the form
-- the corporate approvals store (lower case, an internationalised name as its punycode `xn--` form), at most 20 as for the addresses.
-- The column lives exactly as long as the session row: it is deleted with it (logout, expiry, the purge on session creation, a
-- revoked authorization, erase_signer_pii) and is never copied anywhere. The column is NOT NULL with an empty array as default, so a
-- session of a person without a verified address, and every session that exists today, holds '{}' and claims nothing until the next
-- login. Nothing else changes: the runtime role already holds select, insert, update and delete on sessions, which covers the new
-- column, and no trigger or immutability rule applies to sessions.

alter table sessions add column verified_email_domains text[] not null default '{}';

-- What may be in the array, judged on its text form, `{a.example,b.example}`: an element is written bare only when it holds nothing
-- but characters outside the quoting rules, and the pattern then lets through letters of the lower-case alphabet, digits, dots and
-- hyphens. Every other element is refused: an '@' or an upper-case letter (so an address cannot be kept here), a space, a comma or a
-- quote (the text form puts the element in quotes, which the pattern does not accept), an empty element and the SQL null (written
-- `""` and `NULL`). Elements are therefore judged one by one even though the pattern reads the whole text. The empty array is `{}`.
-- No operand of the check can raise an error.
alter table sessions
  add constraint sessions_verified_email_domains_check
  check (
    cardinality(verified_email_domains) <= 20
    and verified_email_domains::text ~ '^\{([a-z0-9.-]+(,[a-z0-9.-]+)*)?\}$'
  );
