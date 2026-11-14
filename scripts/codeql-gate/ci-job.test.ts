// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { expression, findOnPath } from '../ci/lib/test-support.ts';
import { checkWorkflow } from '../ci/lib/workflow-guard.ts';
import { compareNames } from '../code-caps/types.ts';
import { activeLines, repoText, workflows } from '../semgrep-rules/test-support.ts';
import { yamlOf } from '../trivy-gate/test-support.ts';

// CodeQL code scanning (.github/workflows/codeql.yml): the matrix job `analyze`, which holds the one write token of the
// repository's workflows (security-events: write), and the aggregator job `codeql`, the required check. The runner policy
// (docs/ci-runners.md) lets the file hold that permission because its name says it runs on GitHub-hosted runners only; the
// pins here keep it that way, keep the actions on one release and pinned by SHA, and run the aggregator's script for real.

const CODEQL_FILE = '.github/workflows/codeql.yml';
const CI_FILE = '.github/workflows/ci.yml';
const text = repoText(CODEQL_FILE);
/** The file without its comment lines: the header names pull_request_target to explain why it is not used. */
const active = activeLines(text).join('\n');
const ciText = repoText(CI_FILE);

const stepSchema = z.strictObject({
  name: z.string(),
  uses: z.string().optional(),
  shell: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  with: z.record(z.string(), z.unknown()).optional(),
  run: z.string().optional(),
});
const analyzeSchema = z.strictObject({
  name: z.string(),
  'runs-on': z.string(),
  'timeout-minutes': z.number(),
  permissions: z.record(z.string(), z.string()),
  strategy: z.strictObject({
    'fail-fast': z.boolean(),
    matrix: z.strictObject({ language: z.array(z.string()) }),
  }),
  steps: z.array(stepSchema),
});
const aggregatorSchema = z.strictObject({
  name: z.string(),
  needs: z.string(),
  if: z.string(),
  'runs-on': z.string(),
  'timeout-minutes': z.number(),
  steps: z.array(stepSchema),
});
const workflowSchema = z.strictObject({
  name: z.string(),
  on: z.strictObject({
    pull_request: z.null(),
    push: z.strictObject({ branches: z.array(z.string()) }),
    schedule: z.array(z.strictObject({ cron: z.string() })),
    workflow_dispatch: z.null(),
  }),
  permissions: z.record(z.string(), z.string()),
  concurrency: z.strictObject({ group: z.string(), 'cancel-in-progress': z.string() }),
  jobs: z.strictObject({ analyze: analyzeSchema, codeql: aggregatorSchema }),
});

const workflow = workflowSchema.parse(yamlOf(CODEQL_FILE));
const { analyze, codeql } = workflow.jobs;
const ciWorkflow = z
  .object({
    concurrency: z.object({ group: z.string() }),
    jobs: z.record(z.string(), z.object({ name: z.string().optional() })),
  })
  .parse(yamlOf(CI_FILE));

const FULL_SHA = /^[0-9a-f]{40}$/;
const ACTIONS = ['actions/checkout', 'github/codeql-action/init', 'github/codeql-action/analyze'];
const LANGUAGE = expression('matrix.language');

function step(name: string) {
  const found = analyze.steps.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`the analyze job has no step ${name}`);
  }
  return found;
}

test('the workflow runs on pull requests, pushes to main, a weekly schedule and by hand, and on nothing else', () => {
  expect(workflow.name).toBe('CodeQL');
  expect(workflow.on.push.branches).toEqual(['main']);
  expect(workflow.on.schedule).toHaveLength(1);
  expect(workflow.on.schedule[0]?.cron).toMatch(/^\d{1,2} \d{1,2} \* \* [0-6]$/);
});

test('the required check always runs: no trigger carries a filter, so every pull request gets the check', () => {
  // pull_request and workflow_dispatch are bare keys (the schema above makes them null), so no branch, tag or type filter.
  expect(active).not.toMatch(/^(?:paths|paths-ignore|branches-ignore|tags|tags-ignore|types):/m);
  expect(active).not.toMatch(/pull_request_target|workflow_run/);
  expect(Object.keys(workflow.on).sort(compareNames)).toEqual([
    'pull_request',
    'push',
    'schedule',
    'workflow_dispatch',
  ]);
});

test('the workflow asks for contents: read, only the analyze job adds security-events: write, nothing uses a secret', () => {
  expect(workflow.permissions).toEqual({ contents: 'read' });
  expect(text).toMatch(/^permissions:\n {2}contents: read\n/m);
  expect(analyze.permissions).toEqual({ contents: 'read', 'security-events': 'write' });
  expect(Object.keys(codeql)).not.toContain('permissions');
  expect(active.match(/^security-events: write$/gm)).toHaveLength(1);
  expect(active).not.toMatch(/\$\{\{\s*secrets\./);
  expect(active).not.toContain('GITHUB_TOKEN');
});

test('both jobs run on the literal ubuntu-24.04 with a timeout, so the runner guard accepts the file (R1 to R7)', () => {
  expect(analyze['runs-on']).toBe('ubuntu-24.04');
  expect(codeql['runs-on']).toBe('ubuntu-24.04');
  expect(analyze['timeout-minutes']).toBe(30);
  expect(codeql['timeout-minutes']).toBe(5);
  expect(checkWorkflow(CODEQL_FILE, yamlOf(CODEQL_FILE))).toEqual([]);
});

test('the permission is allowed by the file name alone: the same text as ci.yml is refused for the job that uploads', () => {
  const asCi = checkWorkflow(CI_FILE, yamlOf(CODEQL_FILE));
  expect(asCi).toEqual([
    {
      file: CI_FILE,
      job: 'analyze',
      rule: 'R5',
      message: 'permission security-events: "write" is not allowed',
    },
  ]);
});

test('the jobs are analyze (one per language) and codeql, and no name is a job name of ci.yml', () => {
  expect(analyze.name).toBe(`analyze (${LANGUAGE})`);
  expect(codeql.name).toBe('codeql');
  const taken = Object.entries(ciWorkflow.jobs).flatMap(([id, job]) => [id, job.name ?? id]);
  expect(taken).not.toContain('codeql');
  expect(taken).not.toContain('analyze');
  expect(taken.filter((name) => name.startsWith('analyze'))).toEqual([]);
});

test('the matrix is the two languages, none stops the other, and their results are kept apart by a category', () => {
  expect(analyze.strategy).toEqual({
    'fail-fast': false,
    matrix: { language: ['actions', 'javascript-typescript'] },
  });
  expect(step('Analyze and upload the results to code scanning').with).toEqual({ category: `/language:${LANGUAGE}` });
});

// The step schema is strict, so a step with an `if:` or any key beyond the ones listed would fail to parse.
test('the analyze steps are checkout, init and analyze, in that order, none conditional or allowed to fail softly', () => {
  expect(analyze.steps.map((each) => each.name)).toEqual([
    'Check out the repository',
    'Initialize CodeQL',
    'Analyze and upload the results to code scanning',
  ]);
  expect(active).not.toContain('continue-on-error');
  expect(analyze.steps.filter((each) => each.run !== undefined)).toEqual([]);
});

test('the checkout does not keep the token and starts clean; init is build-mode none with security-extended', () => {
  expect(step('Check out the repository').with).toEqual({ 'persist-credentials': false, clean: true });
  expect(step('Initialize CodeQL').with).toEqual({
    languages: LANGUAGE,
    'build-mode': 'none',
    queries: 'security-extended',
  });
});

test('every action is pinned to a full commit SHA with its release in a comment, and init and analyze are the same release', () => {
  const used = analyze.steps.flatMap((each) => (each.uses === undefined ? [] : [each.uses.split('@')]));
  expect(used.map(([action]) => action)).toEqual(ACTIONS);
  for (const [, sha] of used) {
    expect(sha).toMatch(FULL_SHA);
  }
  expect(used[1]?.[1]).toBe(used[2]?.[1]);
  const comments = [...active.matchAll(/^uses: ([^@\s]+)@([0-9a-f]{40}) # (v\d+\.\d+\.\d+)$/gm)];
  expect(comments.map((each) => each[1])).toEqual(ACTIONS);
  expect(comments[1]?.[3]).toBe(comments[2]?.[3]);
  expect(comments[1]?.[3]).toMatch(/^v4\./);
});

test('the checkout is the release and SHA that ci.yml pins, so Dependabot moves the two together', () => {
  const pin = /uses: (actions\/checkout@[0-9a-f]{40} # v\d+\.\d+\.\d+)$/m;
  expect(pin.exec(text)?.[1]).toBeDefined();
  expect(pin.exec(text)?.[1]).toBe(pin.exec(ciText)?.[1]);
  const dependabot = z
    .object({ updates: z.array(z.object({ 'package-ecosystem': z.string(), directory: z.string() })) })
    .parse(yamlOf('.github/dependabot.yml'));
  expect(dependabot.updates).toContainEqual(
    expect.objectContaining({ 'package-ecosystem': 'github-actions', directory: '/' }),
  );
});

test('the concurrency group has a prefix of its own, so a CI run and a CodeQL run never cancel each other', () => {
  const prefix = (group: string) => group.slice(0, group.indexOf('$'));
  expect(prefix(workflow.concurrency.group)).toBe('codeql-');
  expect(prefix(ciWorkflow.concurrency.group)).toBe('ci-');
  expect(workflow.concurrency.group).toBe(`codeql-${expression('github.event_name')}-${expression('github.ref')}`);
  expect(workflow.concurrency['cancel-in-progress']).toBe(expression("github.event_name == 'pull_request'"));
});

test('the aggregator runs always(), waits for analyze alone, has one step and reads the result of analyze', () => {
  expect(codeql.needs).toBe('analyze');
  expect(codeql.if).toBe(expression('always()'));
  expect(codeql.steps).toHaveLength(1);
  const [only] = codeql.steps;
  expect(only?.env).toEqual({ RESULT: expression('needs.analyze.result') });
  expect(only?.shell).toBe('bash');
  expect(only?.run).not.toContain('${{');
  expect(only?.uses).toBeUndefined();
});

/** Runs the aggregator's script the way the runner does (bash -e -o pipefail) with the given environment. */
function aggregate(environment: Readonly<Record<string, string>>) {
  const run = codeql.steps[0]?.run;
  if (run === undefined) {
    throw new Error('the codeql job has no run step');
  }
  const result = spawnSync(findOnPath('bash'), ['--noprofile', '--norc', '-eo', 'pipefail', '-c', run], {
    env: { PATH: String(process.env['PATH']), ...environment },
    encoding: 'utf8',
  });
  return { status: result.status, out: result.stdout };
}

test('every language analysed and uploaded: the aggregator passes and says so', () => {
  expect(aggregate({ RESULT: 'success' })).toEqual({
    status: 0,
    out: 'CodeQL analysed and uploaded every language\n',
  });
});

test.each([['failure'], ['cancelled'], ['skipped']])(
  'an analysis that ended as %s turns the aggregator red with an error that names the result',
  (result) => {
    const outcome = aggregate({ RESULT: result });
    expect(outcome.status).toBe(1);
    expect(
      outcome.out.startsWith(`::error title=CodeQL::the analysis ended with: ${result}, so the check fails `),
    ).toBe(true);
    expect(outcome.out.trim().split('\n')).toHaveLength(1);
  },
);

test.each([
  ['an empty result', ''],
  ['another case', 'Success'],
  ['a trailing space', 'success '],
  ['something that only starts like success', 'successful'],
  ['a command substitution, which is printed and never run', '$(echo pwned)'],
])('a result that is not exactly success fails too: %s', (_what, result) => {
  const outcome = aggregate({ RESULT: result });
  expect(outcome.status).toBe(1);
  expect(outcome.out).toContain(`the analysis ended with: ${result},`);
});

test('a missing result is an error of the script itself, not a pass', () => {
  expect(aggregate({}).status).not.toBe(0);
});

test('the semgrep helper reads the file too: every job has a name, a timeout and a runner, every step a name', () => {
  const found = workflows().find((flow) => flow.name === 'codeql.yml');
  expect(Object.keys(found?.jobs ?? {})).toEqual(['analyze', 'codeql']);
  expect(Object.values(found?.jobs ?? {}).map((job) => job['runs-on'])).toEqual(['ubuntu-24.04', 'ubuntu-24.04']);
});

test('the file header records why it is a file of its own, which events it uses and why the default setup stays off', () => {
  const header = text.slice(0, text.indexOf('\nname: CodeQL'));
  for (const reason of [
    'Why a file of its own, on GitHub-hosted runners only',
    'Why pull_request and never pull_request_target',
    'Why no paths filter and no job-level `if`',
    "Why GitHub's default setup stays off",
    'Why one aggregator job is the required context',
  ]) {
    expect(header).toContain(reason);
  }
  expect(header).toContain('security-events: write');
});
