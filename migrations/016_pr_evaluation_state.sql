-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 Giovanni Manzoni
--
-- 016_pr_evaluation_state (E15-S01): whether the pull request of an evaluation is open or closed. Forward-only: never edit this
-- file once merged, add a new migration instead.
--
-- The pending-pull-requests view and the re-evaluation that follows a revocation must touch open pull requests only, and GitHub
-- is not asked per row. `pr_state` is the answer the database keeps: the evaluation job writes it from the pull request it
-- fetched, the close handling sets `closed` on every row of the pull request and a reopen sets `open`, and the sweep corrects a
-- missed close. A merged pull request counts as closed. The column is a lifecycle flag like `result`, not evidence: the table
-- stays updatable for the runtime role, no trigger is involved, and the grants of migration 001 (select, insert and update on the
-- whole table) already cover it. Rows that exist take the default `open`, and no backfill is needed because the next sweep
-- closes the ones that are not.

alter table pr_evaluations
  add column pr_state text not null default 'open',
  add constraint pr_evaluations_pr_state_check check (pr_state in ('open', 'closed'));

-- The lookups of the pending view and of the re-evaluation read one installation, then its repositories, then the rows that are
-- open and failing, so the columns follow that order.
create index pr_evaluations_state_result_idx on pr_evaluations (installation_id, repository_id, pr_state, result);
