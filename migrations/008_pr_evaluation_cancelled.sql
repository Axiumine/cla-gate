-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 Giovanni Manzoni
--
-- 008_pr_evaluation_cancelled (E07-S06): a pull request evaluation can be `cancelled`. Forward-only: never edit this file
-- once merged.
--
-- Migration 001 allowed three values in pr_evaluations.result: in_progress, success and failure. A pull request that is
-- closed while its evaluation is in progress must not leave a Check Run hanging, so the close ends that evaluation as
-- `cancelled`. It is a lifecycle state: the evaluation engine never produces it (its outcomes stay success and failure),
-- and a reopened pull request is evaluated again from it. Nothing else changes: no trigger, grant, index or foreign key
-- is touched, and a value outside the four still violates the check.

alter table pr_evaluations drop constraint pr_evaluations_result_check;
alter table pr_evaluations
  add constraint pr_evaluations_result_check check (result in ('in_progress', 'success', 'failure', 'cancelled'));
