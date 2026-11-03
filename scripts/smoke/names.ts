// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Owner, ownedName } from '../ci/lib/container-owner.ts';
import { type Env, variable } from '../ci/lib/env.ts';

// E19-S08: the names and labels of the stacks the container smoke test starts. The Docker daemon of a runner is shared with
// other repositories (docs/ci-runners.md, Containers and cleanup), so everything a smoke stack creates is named for its run and
// carries two labels, and the clean-up removes nothing else.

/** The label every container, network, volume and image of a smoke stack carries: `cla-gate.ci=container`, as the CI job is named. */
export const SMOKE_OWNER: Owner = { prefix: 'cla-smoke-', labelKey: 'cla-gate.ci', labelValue: 'container' };

/** The second label: the run the resource belongs to, so that two runs on one daemon never remove each other's stacks. */
const RUN_LABEL = 'cla-gate.run';

/** The environment variable that names the run: the workflow sets it from the run id and attempt before anything starts. */
export const RUN_VARIABLE = 'CLA_SMOKE_RUN';

/** A compose project name is lower-case letters, digits and hyphens; the run leaves room for a scenario name after it. */
const RUN_PATTERN = /^cla-smoke-[a-z0-9][a-z0-9-]{0,39}$/;
const SCENARIO_PATTERN = /^[a-z][a-z0-9]{0,11}$/;

export interface StackNames {
  /** `cla-smoke-<run id>-<attempt>` in CI, `cla-smoke-local-<random>` anywhere else. */
  readonly run: string;
  /** The compose project: the run and the scenario. */
  readonly project: string;
  /** The image the stack builds and runs, so that no other run's image is replaced or removed. */
  readonly image: string;
}

/**
 * The name of this run: CLA_SMOKE_RUN when the workflow set it, else one made here. Only a name that starts with the owner's
 * prefix and is a valid compose project name is accepted, so no variable can aim the clean-up at somebody else's resources.
 */
export function smokeRun(env: Env, hex: string): string {
  const given = variable(env, RUN_VARIABLE);
  const run = given === '' ? ownedName(SMOKE_OWNER, env, hex) : given;
  if (!RUN_PATTERN.test(run)) {
    throw new Error(
      `${RUN_VARIABLE} must be cla-smoke- followed by lower-case letters, digits and hyphens (at most 40)`,
    );
  }
  return run;
}

/** The names of one stack of the run: `scenario` is a short lower-case word (`boot`, `tls`). */
export function stackNames(run: string, scenario: string): StackNames {
  // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- anchored, bounded patterns with no nested quantifier (linear time), applied to names the test code chooses, not request data
  if (!RUN_PATTERN.test(run) || !SCENARIO_PATTERN.test(scenario)) {
    throw new Error(
      'a stack is named for a run (cla-smoke-...) and a scenario of at most 12 lower-case letters and digits',
    );
  }
  const project = `${run}-${scenario}`;
  return { run, project, image: `cla-gate-smoke:${project}` };
}

/** The labels of every resource of the run, as a map and as the `key=value` filters `docker ... --filter label=` takes. */
export function runLabels(run: string): Record<string, string> {
  return { [SMOKE_OWNER.labelKey]: SMOKE_OWNER.labelValue, [RUN_LABEL]: run };
}

/** The two `--filter label=...` arguments that select the resources of a run and nothing else. */
export function runFilters(run: string): string[] {
  return Object.entries(runLabels(run)).flatMap(([key, value]) => ['--filter', `label=${key}=${value}`]);
}
