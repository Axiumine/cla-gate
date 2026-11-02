// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { InstallationRowId } from '../adapters/db/installation-row-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { RoleViewer } from './org-admin.ts';
import { type ProbeBudget, ProbeBudgetExhaustedError } from './probe-budget.ts';
import { listRepoAdminCandidates } from './repo-admin-candidates.ts';
import type { CachedRepoAdminLookup } from './role-lookups.ts';

// The role-in-installation rule of E11-S01 (E11-S03): a person who is no org admin has a role in an installation when they
// are admin of at least one of its repositories that carries a repo-scoped CLA document. The endpoints that list what a
// person may see (E14-S01, E15) and the denial path that chooses between 403 and 404 (E11-S05) ask this; it costs one
// GitHub call per repository, so it is bounded by a per-request budget and ends at the first hit.

/** How many repositories are probed at once. */
const DISCOVERY_CONCURRENCY = 5;

/**
 * What the discovery found. `none` with `truncated` is not "no role": the repositories past the budget were not asked, so
 * a caller that lists things shows what it found and says the list may be incomplete, and one that must decide (the
 * denial path) treats it as no role.
 */
export interface RoleDiscovery {
  readonly role: 'repo_admin' | 'none';
  readonly truncated: boolean;
}

export interface RepoAdminDiscoveryDeps {
  readonly db: Kysely<Database>;
  /**
   * The permission lookup with the role cache in front of it (E11-S04), which makes a hit cost nothing. The bare lookup of
   * E11-S03 fits too: it asks for fewer fields.
   */
  readonly lookup: CachedRepoAdminLookup;
}

export type DiscoverRepoAdminRole = (
  viewer: RoleViewer,
  installationId: InstallationRowId,
  budget: ProbeBudget,
) => Promise<RoleDiscovery>;

/**
 * The discovery over `deps`: takes up to `budget.remaining` repositories of the installation (`installationId` is
 * `installations.id`) that carry a repo-scoped document and are not removed, in repository id order, and probes them with
 * concurrency 5. It stops starting probes at the first admin hit: `{ role: 'repo_admin', truncated: false }`.
 *
 * Without a hit the answer is `{ role: 'none', truncated }`: `truncated` is true when more repositories were left than the
 * budget allowed (the first `remaining` are the ones asked, always the same ones, so a stranger who repeats the request
 * costs the same few calls and not more), or when the budget ran out under the probes. A budget that is already empty
 * asks nothing and is `{ role: 'none', truncated: true }`.
 *
 * A probe that fails is not "no role": the failure (a rate limit, an outage, an installation the instance does not serve)
 * is thrown after the probes in flight have settled, unless one of them found an admin, which is an answer.
 */
export function createRepoAdminDiscovery({ db, lookup }: RepoAdminDiscoveryDeps): DiscoverRepoAdminRole {
  return async (viewer, installationId, budget) => {
    const allowed = budget.remaining;
    if (allowed === 0) {
      return { role: 'none', truncated: true };
    }
    const listed = await listRepoAdminCandidates(db, { installationId }, allowed + 1);
    const candidates = listed.slice(0, allowed);
    const probes = new Probes(candidates, (candidate) =>
      lookup(
        { id: installationId, github_installation_id: candidate.github_installation_id },
        candidate,
        viewer,
        budget,
      ),
    );
    await probes.run();
    if (probes.admin) {
      return { role: 'repo_admin', truncated: false };
    }
    if (probes.failure !== undefined) {
      throw probes.failure.error;
    }
    return { role: 'none', truncated: listed.length > allowed || probes.exhausted };
  };
}

/** One run of the probes of a discovery: a pool of workers over the candidates, and what they found. */
class Probes<T> {
  admin = false;
  exhausted = false;
  failure: { readonly error: unknown } | undefined;
  readonly #candidates: readonly T[];
  readonly #probe: (candidate: T) => Promise<boolean>;
  #next = 0;

  constructor(candidates: readonly T[], probe: (candidate: T) => Promise<boolean>) {
    this.#candidates = candidates;
    this.#probe = probe;
  }

  /** Runs until every candidate is asked, an admin is found or a probe fails; never rejects. */
  async run(): Promise<void> {
    const workers = Array.from({ length: Math.min(DISCOVERY_CONCURRENCY, this.#candidates.length) }, () =>
      this.#work(),
    );
    await Promise.all(workers);
  }

  async #work(): Promise<void> {
    while (!(this.admin || this.exhausted || this.failure !== undefined)) {
      const candidate = this.#candidates[this.#next];
      this.#next += 1;
      if (candidate === undefined) {
        return;
      }
      await this.#ask(candidate);
    }
  }

  async #ask(candidate: T): Promise<void> {
    try {
      if (await this.#probe(candidate)) {
        this.admin = true;
      }
    } catch (error) {
      if (error instanceof ProbeBudgetExhaustedError) {
        this.exhausted = true;
      } else {
        this.failure ??= { error };
      }
    }
  }
}
