// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { CHECK_NAME } from '../../shared/check-name.ts';
import type { GithubId } from '../../shared/github-id.ts';
import { checkRunFields, checkSuiteFields } from './webhook-routing-fields.ts';
import { type Delivery, ignored, type Routing, toJob } from './webhook-routing-types.ts';

// The rows of the routing table for a check being re-run (E06-S04). Re-running a check resolves to the head SHA, never to
// the pull request numbers of the payload: `check_run.pull_requests` is empty for a fork pull request, so the job lists the
// open pull requests of that SHA when it runs (E07-S07).

/** The tenant ids both events carry. */
interface Tenant {
  readonly installation: { readonly id: GithubId };
  readonly repository: { readonly id: GithubId };
}

/** Whether a check of the App `id` is ours: the configured `GITHUB_APP_ID` is the only App whose checks the platform acts on. */
function isOurApp(id: number, appId: string | undefined): boolean {
  return appId !== undefined && String(id) === appId;
}

/** The job a re-run request is, or an ignore for any other action of a check of ours. */
function rerun(action: string | undefined, headSha: string, tenant: Tenant, deliveryId: string): Routing {
  return action === 'rerequested'
    ? toJob({
        type: 'evaluate-head-sha',
        githubInstallationId: tenant.installation.id,
        githubRepoId: tenant.repository.id,
        headSha,
        deliveryId,
      })
    : ignored('unsupported_action');
}

/** A single re-run of the check: only `license/cla` of this App is ours, any other name is another tool's check. */
export function routeCheckRun({ action, payload, context }: Delivery): Routing {
  const parsed = checkRunFields.parse(payload);
  const { name, head_sha: headSha, app } = parsed.check_run;
  if (name !== CHECK_NAME || !isOurApp(app.id, context.appId)) {
    return ignored('foreign_check');
  }
  return rerun(action, headSha, parsed, context.deliveryId);
}

/** "Re-run all checks" sends a `check_suite`: the same job as a single re-run, for the suites of this App. */
export function routeCheckSuite({ action, payload, context }: Delivery): Routing {
  const parsed = checkSuiteFields.parse(payload);
  const { head_sha: headSha, app } = parsed.check_suite;
  return isOurApp(app.id, context.appId)
    ? rerun(action, headSha, parsed, context.deliveryId)
    : ignored('foreign_check');
}
