// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { exists, expression, findOnPath, readText, writeExecutable } from '../ci/lib/test-support.ts';
import { tempDir } from '../code-caps/test-support.ts';
import { ciJob, ciTextOnSharedRunners, ROOT, repoText } from '../semgrep-rules/test-support.ts';
import { yamlOf } from '../trivy-gate/test-support.ts';
import { SHARD_NAMES } from './shards.ts';
import { ALWAYS_GATE, GATE } from './test-support.ts';

// E20-S04 and E20-S05: the `mutation` job of .github/workflows/ci.yml, one matrix job per shard (the server shards and the
// scripts scope), the manual trigger that can pick one shard, and the steps that decide on --force run for real in bash
// against a stub yarn. The shards themselves are tested in shards.test.ts; when the job runs, its permissions and the skip
// decision (the `decide` step and the gate on every step after it) are pinned in skip-job.test.ts.

const job = ciJob('mutation');
const DECIDE = 'Decide whether this shard can be skipped (nightly run only)';
const RESTORE = 'Restore the Stryker incremental file';
const CHECK_RESTORED = 'Check the restored Stryker incremental file';
const RUN = 'Mutation tests';
const CHECK_BEFORE_SAVE = 'Check the Stryker incremental file before the save';
const SAVE = 'Save the Stryker incremental file';
const UPLOAD = 'Upload the mutation report';
const ciText = repoText('.github/workflows/ci.yml');
const SHARD = expression('matrix.shard');

/** A step of the job by name (the failure names it). */
function step(name: string) {
  const found = job.steps.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`the mutation job has no step ${name}`);
  }
  return found;
}

const workflow = z
  .object({
    on: z.object({
      workflow_dispatch: z.object({
        inputs: z.object({
          force: z.object({ type: z.string(), default: z.boolean(), description: z.string() }),
          shard: z.object({
            type: z.string(),
            default: z.string(),
            description: z.string(),
            options: z.array(z.string()),
          }),
        }),
      }),
      schedule: z.array(z.object({ cron: z.string() })),
    }),
    concurrency: z.object({ group: z.string(), 'cancel-in-progress': z.string() }),
    jobs: z.object({
      mutation: z.object({
        strategy: z
          .object({
            'fail-fast': z.boolean(),
            'max-parallel': z.number(),
            matrix: z.object({ shard: z.string() }).strict(),
          })
          .strict(),
      }),
    }),
  })
  .parse(yamlOf('.github/workflows/ci.yml'));
const { strategy } = workflow.jobs.mutation;

/** The files that `hashFiles(...)` of a cache key lists. */
function hashedFiles(key: string): string[] {
  const list = /hashFiles\(([^)]*)\)/.exec(key)?.[1] ?? '';
  return [...list.matchAll(/'([^']+)'/g)].map((match) => match[1] ?? '');
}

/** A file name as `hashFiles` takes it: in single quotes. */
function quoted(file: string): string {
  return `'${file}'`;
}

test('the job is named after its shard, waits for static, runs on the shared self-hosted runners and may take an hour', () => {
  expect(job.name).toBe(`mutation (${SHARD})`);
  expect(job.needs).toBe('static');
  expect(job['runs-on']).toEqual(['self-hosted', 'Linux', 'X64']);
  // 60 is the cap of the runner guard (rule R4); the budget below leaves the save and upload steps their time.
  expect(job['timeout-minutes']).toBe(60);
});

test('the matrix runs every shard, one failed shard does not stop the others, and two at most run at once on the shared runners', () => {
  expect(strategy['fail-fast']).toBe(false);
  expect(strategy['max-parallel']).toBe(2);
  expect(ciText).toMatch(/max-parallel: 2\n/);
});

test('max-parallel limits one workflow run, not the repository, and the documents say so and name the overlap of the nightly, tag and manual runs', () => {
  // The group is per event and ref (and a pull request is the only run that cancels): the nightly run, a tag and a manual run
  // are different groups, each with its own matrix of two shards at a time. A push to main does not run the job any more
  // (skip-job.test.ts), so it no longer holds its group for hours, and the consequence that followed from that is gone.
  expect(workflow.concurrency.group).toBe(`ci-${expression('github.event_name')}-${expression('github.ref')}`);
  expect(workflow.concurrency['cancel-in-progress']).toBe(expression("github.event_name == 'pull_request'"));
  const runners = readText('docs/ci-runners.md');
  const row = runners.split('\n').find((line) => line.startsWith('| `mutation`')) ?? '';
  expect(row).toContain('one workflow run holds at most two of the three shared runners');
  expect(row).toContain('the limit is per run');
  expect(runners).not.toMatch(/never holds more than two/);
  expect(ciText).not.toMatch(/never holds more than two/);
  expect(ciText).toContain('it limits one workflow run, not the repository');
  const risk =
    runners.split('\n').find((line) => line.startsWith('- **The mutation matrix and the shared runners')) ?? '';
  expect(risk).toContain('the nightly run, a `v*` tag push and a manual run are different groups and can overlap');
  expect(risk).toContain('two overlapping runs ask for four runners while the organisation has three');
  expect(risk).toContain('A push to `main` does not run the `mutation` job');
  for (const stale of [
    'the next push waits as the pending run',
    'a third push replaces that pending run',
    'can be cancelled before it starts',
  ]) {
    expect(risk).not.toContain(stale);
    expect(ciText).not.toContain(stale);
  }
});

test('the matrix is every shard of shards.ts, or the one shard a manual run picked, and the picked value is never spliced into a command', () => {
  const list = JSON.stringify(SHARD_NAMES);
  expect(strategy.matrix.shard).toBe(
    expression(
      `fromJSON(github.event_name == 'workflow_dispatch' && inputs.shard != 'all' && format('["{0}"]', inputs.shard) || '${list}')`,
    ),
  );
  expect(SHARD_NAMES.at(-1)).toBe('scripts');
  // The input is read in this one expression and nowhere else in the job.
  const uses = ciText.split('inputs.shard').length - 1;
  expect(uses).toBe(2);
  expect(job.steps.filter((each) => (each.run ?? '').includes('inputs.shard'))).toEqual([]);
});

test('a manual run has a force input that defaults to false, a shard choice that defaults to all, and the nightly schedule exists', () => {
  const { force, shard } = workflow.on.workflow_dispatch.inputs;
  expect(force).toMatchObject({ type: 'boolean', default: false });
  expect(force.description).not.toBe('');
  expect(shard).toMatchObject({ type: 'choice', default: 'all' });
  expect(shard.description).not.toBe('');
  expect(workflow.on.schedule).toEqual([{ cron: '17 3 * * *' }]);
});

test('the shard choice offers all and every shard, in the order of shards.ts, so GitHub refuses anything else', () => {
  expect(workflow.on.workflow_dispatch.inputs.shard.options).toEqual(['all', ...SHARD_NAMES]);
});

test('the job holds no secret of its own, sets no job-level environment and cannot fail softly', () => {
  expect(job.env).toBeUndefined();
  expect(job.steps.filter((each) => each['continue-on-error'] !== undefined)).toEqual([]);
  expect(ciText).toMatch(/^permissions:\n {2}contents: read\n/m);
  // The qodana job (E20-S08) holds a secret and runs on a GitHub-hosted machine: it is not part of this check.
  expect(ciTextOnSharedRunners()).not.toMatch(/\$\{\{\s*secrets\./);
});

test('the steps are Node, the skip decision, Corepack and Yarn, the restore and its check, the run, the check and the save, and the upload, in that order', () => {
  expect(job.steps.map((each) => each.name)).toEqual([
    'Preflight (runner capabilities)',
    'Keep tool state in the runner temp directory',
    'Check out the repository',
    'Set up Node.js (version from .nvmrc)',
    DECIDE,
    'Enable Corepack',
    'Restore the Yarn cache',
    'Install dependencies',
    RESTORE,
    CHECK_RESTORED,
    RUN,
    CHECK_BEFORE_SAVE,
    SAVE,
    UPLOAD,
  ]);
  expect(step('Install dependencies').run).toBe('yarn install --immutable');
  expect(step('Check out the repository').with).toMatchObject({ 'persist-credentials': false, clean: true });
});

// --------------------------------------------------------------------------- the incremental cache

const restore = step(RESTORE);
const save = step(SAVE);
const key = z.string().parse(restore.with?.['key']);
const PREFIX = `stryker-${SHARD}-${expression('runner.os')}-${expression(
  `hashFiles(${hashedFiles(key).map(quoted).join(', ')})`,
)}-`;
const RUN_SUFFIX = `${expression('github.sha')}-${expression('github.run_id')}-${expression('github.run_attempt')}`;

test('the incremental file of each shard is restored from a cache keyed by the shard, what makes an old result untrustworthy and the run', () => {
  expect(restore.uses).toMatch(/^actions\/cache\/restore@[0-9a-f]{40}$/);
  expect(restore.with).toEqual({
    path: `reports/stryker-incremental-${SHARD}.json`,
    key: `${PREFIX}${RUN_SUFFIX}`,
    'restore-keys': PREFIX,
  });
});

test('the hash covers the lockfile, Node, the Stryker config, every Vitest config and every tsconfig the checker reads', () => {
  expect(hashedFiles(key)).toEqual([
    'yarn.lock',
    '.nvmrc',
    'stryker.config.mjs',
    'vitest.config.ts',
    'vitest.projects.ts',
    'vitest.stryker.config.ts',
    'vitest.stryker-scripts.config.ts',
    'tsconfig.base.json',
    'tsconfig.server.json',
    'tsconfig.scripts.json',
  ]);
});

test('every file in the hash exists, because hashFiles of a file that is not there hashes nothing and says nothing', () => {
  for (const file of hashedFiles(key)) {
    expect(exists(path.join(ROOT, file)), file).toBe(true);
  }
});

test('the key ends with the run, not only the commit, so a re-run on the same commit can save again and the newest cache wins', () => {
  expect(key.endsWith(`-${RUN_SUFFIX}`)).toBe(true);
  expect(key).toContain(expression('github.run_id'));
  expect(key).toContain(expression('github.run_attempt'));
});

test('the shard name is part of the prefix, so no shard restores the file of another', () => {
  const prefixOf = (shard: string) => PREFIX.replace(SHARD, shard);
  for (const first of SHARD_NAMES) {
    for (const second of SHARD_NAMES.filter((name) => name !== first)) {
      expect(prefixOf(first).startsWith(prefixOf(second)), `${first} / ${second}`).toBe(false);
    }
  }
});

test('each shard caches the incremental file its Stryker run writes, which is named after the shard', () => {
  const written = (shard: string) => `reports/stryker-incremental-${shard}.json`;
  expect(String(restore.with?.['path']).replace(SHARD, 'shared')).toBe(written('shared'));
  expect(written('scripts')).toBe('reports/stryker-incremental-scripts.json');
});

test('the incremental file is saved after the run, whatever happened to it, under the key the restore step looked for', () => {
  expect(save.uses).toMatch(/^actions\/cache\/save@[0-9a-f]{40}$/);
  expect(save.if).toBe(ALWAYS_GATE);
  expect(save.with).toEqual({ path: restore.with?.['path'], key: restore.with?.['key'] });
  const names = job.steps.map((each) => each.name);
  expect(names.indexOf(SAVE)).toBe(names.indexOf(CHECK_BEFORE_SAVE) + 1);
  expect(names.indexOf(CHECK_BEFORE_SAVE)).toBe(names.indexOf(RUN) + 1);
  expect(names.indexOf(RESTORE)).toBeLessThan(names.indexOf(RUN));
});

test('a file Stryker cannot read is deleted after the restore and again before the save, so that the cache never keeps a broken file', () => {
  // Stryker rethrows every read error but "no such file", so a cut-short file stops each later run at start-up, and the save
  // step would store the restored file again under the newest cache name. scripts/mutation-gate/incremental-file.ts has the check.
  const names = job.steps.map((each) => each.name);
  expect(names.indexOf(CHECK_RESTORED)).toBe(names.indexOf(RESTORE) + 1);
  expect(names.indexOf(CHECK_RESTORED)).toBe(names.indexOf(RUN) - 1);
  for (const checking of [step(CHECK_RESTORED), step(CHECK_BEFORE_SAVE)]) {
    expect(checking.run).toBe('yarn mutate:check-incremental');
    expect(checking.env).toEqual({ STRYKER_SHARD: SHARD });
    expect(checking.uses).toBeUndefined();
  }
  // After the restore it runs when the job is healthy; before the save it also runs after a failed, stopped or timed-out run.
  // Both only when the leg was not skipped (skip-job.test.ts pins the gate on every step).
  expect(step(CHECK_RESTORED).if).toBe(GATE);
  expect(step(CHECK_BEFORE_SAVE).if).toBe(ALWAYS_GATE);
});

test('yarn mutate:check-incremental runs the check script', () => {
  const manifest = z.object({ scripts: z.record(z.string(), z.string()) }).parse(JSON.parse(readText('package.json')));
  expect(manifest.scripts['mutate:check-incremental']).toBe('node scripts/mutation-gate/check-incremental.ts');
});

test('the cache actions are pinned by full commit SHA with their version in the comment, restore and save at the same release', () => {
  expect(ciText).toMatch(/uses: actions\/cache\/restore@[0-9a-f]{40} # v\d+\.\d+\.\d+$/m);
  expect(ciText).toMatch(/uses: actions\/cache\/save@[0-9a-f]{40} # v\d+\.\d+\.\d+$/m);
  const restoreRelease = /uses: actions\/cache\/restore@([0-9a-f]{40}) # (v\d+\.\d+\.\d+)$/m.exec(ciText);
  const saveRelease = /uses: actions\/cache\/save@([0-9a-f]{40}) # (v\d+\.\d+\.\d+)$/m.exec(ciText);
  expect(restoreRelease?.slice(1)).toEqual(saveRelease?.slice(1));
  // The same release as the other cache steps of the file.
  expect(ciText).toContain(`uses: actions/cache@${restoreRelease?.[1]} # ${restoreRelease?.[2]}`);
});

// --------------------------------------------------------------------------- the run

test('--force is decided in an environment variable that is true on the schedule and on a forced manual run only', () => {
  const run = step(RUN);
  expect(run.env).toMatchObject({
    MUTATE_FORCE: expression(
      "github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.force == true)",
    ),
  });
  expect(run.run).not.toContain('${{');
  expect(run.if).toBe(GATE);
});

test('the shard reaches the run as STRYKER_SHARD, and the run is stopped by a budget that leaves the last steps their time', () => {
  const env = z.record(z.string(), z.string()).parse(step(RUN).env);
  expect(Object.keys(env).toSorted((a, b) => a.localeCompare(b))).toEqual([
    'MUTATE_BUDGET_MINUTES',
    'MUTATE_FORCE',
    'STRYKER_SHARD',
  ]);
  expect(env['STRYKER_SHARD']).toBe(SHARD);
  expect(env['MUTATE_BUDGET_MINUTES']).toMatch(/^[1-9]\d?$/);
  // 5 minutes at least for Stryker to write its file, for the cache save and for the upload.
  expect(Number(env['MUTATE_BUDGET_MINUTES']) + 5).toBeLessThanOrEqual(job['timeout-minutes']);
  expect(Number(env['MUTATE_BUDGET_MINUTES'])).toBeGreaterThanOrEqual(30);
});

test('the matrix value appears in no command: only as a name, a path, a cache key and the STRYKER_SHARD variable of the decision, the run and the two checks', () => {
  expect(job.steps.filter((each) => (each.run ?? '').includes('matrix'))).toEqual([]);
  const lines = ciText
    .split('\n')
    .filter((line) => line.includes('matrix.shard') && !line.trimStart().startsWith('#'))
    .map((line) => line.trim().split(':')[0]);
  const byName = (a: string | undefined, b: string | undefined) => String(a).localeCompare(String(b));
  expect(lines.toSorted(byName)).toEqual(
    [
      'STRYKER_SHARD',
      'STRYKER_SHARD',
      'STRYKER_SHARD',
      'STRYKER_SHARD',
      'key',
      'key',
      'name',
      'name',
      'path',
      'path',
      'path',
      'restore-keys',
    ].toSorted(byName),
  );
});

/** Runs the mutation step in bash with a stub yarn (`body` is its script), and returns the exit status and its calls. */
function mutationStep(force: string, body = 'echo "$@" >> "$0.calls"') {
  const bin = tempDir();
  const yarn = path.join(bin, 'yarn');
  writeExecutable(yarn, `#!/bin/sh\n${body}\n`);
  const script = step(RUN).run ?? '';
  const result = spawnSync(findOnPath('bash'), ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
    env: { PATH: `${bin}${path.delimiter}${path.dirname(findOnPath('bash'))}`, MUTATE_FORCE: force },
    encoding: 'utf8',
  });
  const calls = `${yarn}.calls`;
  return { status: result.status, commands: exists(calls) ? readText(calls).trim().split('\n') : [] };
}

test('a scheduled or forced run executes yarn mutate:shard --force', () => {
  expect(mutationStep('true')).toEqual({ status: 0, commands: ['mutate:shard --force'] });
});

test.each(['false', ''])(
  'a run that is not forced (%j) executes plain yarn mutate:shard and reuses the incremental file',
  (force) => {
    expect(mutationStep(force)).toEqual({ status: 0, commands: ['mutate:shard'] });
  },
);

test('a failing mutation run fails the step, so a score below the threshold fails the shard', () => {
  expect(mutationStep('false', 'exit 1')).toEqual({ status: 1, commands: [] });
  expect(mutationStep('true', 'exit 1')).toEqual({ status: 1, commands: [] });
});

// --------------------------------------------------------------------------- the report

test('each shard uploads its own report as mutation-report-<shard> for seven days, also when an earlier step failed, and it is the last step', () => {
  const upload = step(UPLOAD);
  expect(upload.uses).toMatch(/^actions\/upload-artifact@[0-9a-f]{40}$/);
  expect(upload.if).toBe(ALWAYS_GATE);
  expect(upload.with).toEqual({
    name: `mutation-report-${SHARD}`,
    path: `reports/mutation/${SHARD}/`,
    'retention-days': 7,
  });
  expect(job.steps.at(-1)?.name).toBe(UPLOAD);
});

test('the upload action is pinned by full commit SHA with its version in the comment', () => {
  expect(ciText).toMatch(/uses: actions\/upload-artifact@[0-9a-f]{40} # v\d+\.\d+\.\d+$/m);
});
