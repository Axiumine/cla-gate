-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 Giovanni Manzoni
--
-- 012_allowlist_login_snapshot (E14-S06): the login an allowlist entry was typed as, kept to be shown. Forward-only: never edit
-- this file once merged, add a new migration instead.
--
-- An entry is the numeric GitHub id of an account (migration 001: github_id, the only thing matching ever reads). The login is
-- a display snapshot of what GitHub called that id when the entry was made: it is never used for matching, never written to
-- audit_log, and it can be out of date after a rename. The column is NULL for a row made before this migration, for an entry
-- whose account has no login worth showing, and after the erasure of the person (erase_signer_pii, migration 009, already looks
-- the column up in the catalogue and sets it to NULL for the person's entries in the installation; nothing there is redefined).
--
-- The text comes from GitHub, so the database refuses anything but the shape of a GitHub login or bot login (the pattern of
-- src/shared/allowlist.ts: up to 39 letters, digits and hyphens, optionally followed by [bot]). A response that carries markup
-- cannot plant it in a column that a screen later shows, even through a code path that forgets to check. NULL passes.
--
-- Nothing else changes: the runtime role holds select, insert, update and delete on allowlist_entries (migration 001), which
-- covers the new column, and the unique key, the composite foreign key and the grants are untouched.

alter table allowlist_entries add column login_snapshot text;

alter table allowlist_entries
  add constraint allowlist_entries_login_snapshot_shape
  check (login_snapshot is null or login_snapshot ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$');
