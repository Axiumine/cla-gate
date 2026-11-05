-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 Giovanni Manzoni
--
-- 017_signer_pii_login_index (E15-S02): the index behind the search for a signer by login. Forward-only: never edit this file once
-- merged, add a new migration instead.
--
-- GET /api/installations/:installationId/signatures?login= matches the login the signer gave when signing (signer_pii.login) exactly
-- and whatever its case, as `lower(login) = lower($1)`. Without this index each search would read the signatures of the whole
-- installation and look every one of them up in signer_pii. The index holds the same text the column holds, so it lives and dies
-- with the row: erasing a signer (erase_signer_pii) deletes the row and its entry with it. It changes no row and no trigger.

create index signer_pii_login_lower_idx on signer_pii (lower(login));
