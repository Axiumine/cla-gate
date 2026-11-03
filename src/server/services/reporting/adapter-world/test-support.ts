// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { httpWorld } from '../../../adapters/github/http-world/test-support.ts';
import { testGitHubKey } from '../../../config/test-support.ts';
import { installation, repository } from '../../github-contract/test-support.ts';
import { FULL_NAME, INSTALLATION, REPOSITORY, reportingWorld } from '../test-support.ts';

// The world of the reporter on the real Octokit adapter, over HTTP with MSW (E09-S05, E09-S07): the tenant `org-1` is served by the
// mocked GitHub, and the reporter's client is the adapter.

const signer = testGitHubKey();

/** The world: MSW serving the tenant, and a reporter whose client is the adapter. */
export async function adapterWorld() {
  const github = await httpWorld(signer);
  github.addInstallation(installation(INSTALLATION, 'org-1'), [repository(REPOSITORY, FULL_NAME)]);
  const world = await reportingWorld({ github: github.client });
  /** The requests that were about the Check Run and the comment: the token mint is the adapter's own business. */
  const checkRequests = () => github.requests.filter((request) => !request.includes('/app/'));
  return { world, github, checkRequests };
}
