-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 Giovanni Manzoni
--
-- 004_installation_account_type_other (E05-S04, S07, S08): an installation of an account that is neither a user nor an
-- organisation (an enterprise) can be stored. Forward-only: never edit this file once merged.
--
-- Migration 001 allowed only 'Organization' and 'User' in installations.account_type. An installation of any other kind
-- of account made the whole list of installations unreadable, so the instance could neither record it as rejected nor
-- sync anyone else. The account type 'Other' is now stored: the admission policy never serves it (whatever its numeric
-- id), the row is rejected with the reason account_not_allowed and gets no repositories. Nothing else changes: no
-- trigger, grant or foreign key is touched, and a value outside the three still violates the check.

alter table installations drop constraint installations_account_type_check;
alter table installations
  add constraint installations_account_type_check check (account_type in ('Organization', 'User', 'Other'));
