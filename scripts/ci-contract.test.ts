// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { dependabotProblems } from './ci-contract/dependabot.ts';
import { scriptProblems } from './ci-contract/package-scripts.ts';
import { requiredJobNames } from './ci-contract/required.ts';
import { requiredJobProblems, workflowFileNames, workflowProblems } from './ci-contract/workflow.ts';
import { ROOT, repoText } from './semgrep-rules/test-support.ts';

// E20-S09: the CI contract, applied to this repository. The rules live in scripts/ci-contract/ and have their own tests with
// hostile inputs; this file only proves that the real workflows, package.json, dependabot.yml and the required-check list in
// CLAUDE.md meet them, so a pull request that breaks one fails here.

const WORKFLOWS = '.github/workflows';
// eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed directory of this repository
const FILES = workflowFileNames(fs.readdirSync(path.join(ROOT, WORKFLOWS))).map((name) => `${WORKFLOWS}/${name}`);
const CI_FILE = `${WORKFLOWS}/ci.yml`;

test('the repository has workflow files, and ci.yml is one of them', () => {
  expect(FILES).toContain(CI_FILE);
});

test.each(FILES.map((file) => [file]))(
  '%s pins every action by SHA with a release comment and avoids pull_request_target',
  (file) => {
    expect(workflowProblems(file, repoText(file))).toEqual([]);
  },
);

test('CLAUDE.md names the required checks, and each is a job of ci.yml with its exact name and no job-level if', () => {
  const required = requiredJobNames(repoText('CLAUDE.md'));
  expect(required.length).toBeGreaterThan(0);
  expect(requiredJobProblems(CI_FILE, repoText(CI_FILE), required)).toEqual([]);
});

test('package.json keeps the script contracts of the gates', () => {
  expect(scriptProblems(repoText('package.json'))).toEqual([]);
});

test('dependabot.yml groups the lockstep packages: Playwright, Stryker and memlab', () => {
  expect(dependabotProblems(repoText('.github/dependabot.yml'))).toEqual([]);
});
