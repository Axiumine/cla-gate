-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 Giovanni Manzoni
--
-- 019_repositories_public_verification (E22-S02): the opt-in of a repository to the public signature check. Forward-only: never
-- edit this file once merged, add a new migration instead.
--
-- `GET /api/public/repos/:githubRepoId/signers/:login` answers, without a session, whether a GitHub login has a valid signature on
-- the CLA a repository enforces. It answers only for a repository whose maintainers turned it on, so the default is off: every
-- repository that exists today, and every one that appears later, stays invisible to the endpoint until an admin of the
-- repository (the role that sets its other settings) says otherwise through the dashboard. The flag is a setting of the
-- repository and holds no personal data.
--
-- Nothing else changes: the runtime role holds select, insert and update on repositories (migration 001), which covers the new
-- column, and the identity trigger of 001 protects the identity columns only. The change of the flag is audited by the application
-- as `repository.public_verification_changed` in the transaction that makes it, and it is not retroactive: it does not touch a
-- signature, a document or a version.

alter table repositories add column public_verification boolean not null default false;
