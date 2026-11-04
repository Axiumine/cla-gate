-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 Giovanni Manzoni
--
-- 015_signatures_user_index (E13-S06): the index behind the list of a person's own signatures. Forward-only: never edit this
-- file once merged, add a new migration instead.
--
-- GET /api/me/signatures reads the signatures of one person in every tenant, newest first, a page at a time, and the cursor
-- starts a page at a row of (signed_at, id). The indexes of 001 start with the installation or are partial (signatures_active_unique
-- covers the signatures that are not revoked), so without this one each page would read the whole table. The index changes no
-- row and no trigger: the signature core stays immutable.

create index signatures_user_signed_at_idx on signatures (user_id, signed_at desc, id desc);
