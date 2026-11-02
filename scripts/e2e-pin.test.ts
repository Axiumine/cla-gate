// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { pinProblems } from './e2e/pin.ts';
import { repoText } from './semgrep-rules/test-support.ts';

// E20-S06: one Playwright version in three places. A Dependabot bump of the package alone must fail this file until the
// image of `yarn e2e:update` and the image of the `e2e` CI job are bumped in the same pull request.

const PACKAGE_JSON = repoText('package.json');
const CI_YAML = repoText('.github/workflows/ci.yml');
const VERSION = /"@playwright\/test": "(\d+\.\d+\.\d+)"/.exec(PACKAGE_JSON)?.[1] ?? '';
const DIGEST = /@sha256:[0-9a-f]{64}/.exec(CI_YAML)?.[0] ?? '';

/** The repository's own text with one exact piece of it replaced (a failure to find the piece is a failure of the test). */
function changed(text: string, from: string, to: string): string {
  expect(text).toContain(from);
  return text.replace(from, to);
}

test('the repository pins one version: the package, the e2e:update tag and the e2e job image agree, with a digest in CI', () => {
  expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  expect(DIGEST).toMatch(/^@sha256:[0-9a-f]{64}$/);
  expect(PACKAGE_JSON).toContain(`mcr.microsoft.com/playwright:v${VERSION}-noble${DIGEST} `);
  expect(CI_YAML).toContain(`mcr.microsoft.com/playwright:v${VERSION}-noble${DIGEST}`);
  expect(pinProblems(PACKAGE_JSON, CI_YAML)).toEqual([]);
});

test('a bump of the package alone (what Dependabot does) fails until both images follow', () => {
  const bumped = changed(PACKAGE_JSON, `"@playwright/test": "${VERSION}"`, '"@playwright/test": "1.99.0"');
  expect(pinProblems(bumped, CI_YAML)).toEqual([
    `the e2e:update image is ${VERSION} but @playwright/test is 1.99.0`,
    `the e2e job image is ${VERSION} but @playwright/test is 1.99.0`,
  ]);
});

test('bumping the package and the e2e:update image but not the CI image fails on the CI image', () => {
  const half = changed(
    changed(PACKAGE_JSON, `"@playwright/test": "${VERSION}"`, '"@playwright/test": "1.99.0"'),
    `playwright:v${VERSION}-noble@`,
    'playwright:v1.99.0-noble@',
  );
  expect(pinProblems(half, CI_YAML)).toEqual([`the e2e job image is ${VERSION} but @playwright/test is 1.99.0`]);
});

test('bumping all three together is fine', () => {
  const package99 = changed(
    changed(PACKAGE_JSON, `"@playwright/test": "${VERSION}"`, '"@playwright/test": "1.99.0"'),
    `playwright:v${VERSION}-noble@`,
    'playwright:v1.99.0-noble@',
  );
  const ci99 = changed(CI_YAML, `playwright:v${VERSION}-noble${DIGEST}`, `playwright:v1.99.0-noble${DIGEST}`);
  expect(pinProblems(package99, ci99)).toEqual([]);
});

test.each([['^'], ['~'], ['>='], ['v']])('a %j prefix on the package version is not an exact pin', (prefix) => {
  const version = `${prefix}${VERSION}`;
  const ranged = changed(PACKAGE_JSON, `"@playwright/test": "${VERSION}"`, `"@playwright/test": "${version}"`);
  expect(pinProblems(ranged, CI_YAML)[0]).toBe(
    `@playwright/test must be a devDependency pinned to an exact version (no ^ or ~), got ${version}`,
  );
});

test.each([['latest'], ['1.64'], ['1.64.1-beta.1'], ['workspace:*']])(
  'the package version %j is not an exact pin',
  (version) => {
    const ranged = changed(PACKAGE_JSON, `"@playwright/test": "${VERSION}"`, `"@playwright/test": "${version}"`);
    expect(pinProblems(ranged, CI_YAML)[0]).toBe(
      `@playwright/test must be a devDependency pinned to an exact version (no ^ or ~), got ${version}`,
    );
  },
);

test('a missing package fails', () => {
  const none = JSON.stringify({
    scripts: { 'e2e:update': `docker run mcr.microsoft.com/playwright:v${VERSION}-noble${DIGEST} yarn e2e` },
  });
  expect(pinProblems(none, CI_YAML)[0]).toBe(
    '@playwright/test must be a devDependency pinned to an exact version (no ^ or ~), got undefined',
  );
});

test.each([
  ['the digest removed', (ci: string) => changed(ci, DIGEST, '')],
  ['a short digest', (ci: string) => changed(ci, DIGEST, '@sha256:abc')],
  ['another flavour', (ci: string) => changed(ci, `v${VERSION}-noble`, `v${VERSION}-jammy`)],
  ['another registry', (ci: string) => changed(ci, 'mcr.microsoft.com/playwright', 'example.org/playwright')],
  ['no E2E_IMAGE', (ci: string) => changed(ci, 'E2E_IMAGE:', 'E2E_OTHER:')],
])('an e2e job image with %s fails', (_what, edit) => {
  const problems = pinProblems(PACKAGE_JSON, edit(CI_YAML));
  expect(problems).toEqual([
    'the e2e job needs env E2E_IMAGE: mcr.microsoft.com/playwright:v<version>-noble@sha256:<64 hex digits>',
  ]);
});

test('a workflow without an e2e job fails', () => {
  const problems = pinProblems(PACKAGE_JSON, 'jobs:\n  static:\n    runs-on: x\n');
  expect(problems).toEqual([
    'the e2e job needs env E2E_IMAGE: mcr.microsoft.com/playwright:v<version>-noble@sha256:<64 hex digits>',
  ]);
});

test('an E2E_IMAGE that is not a string fails', () => {
  const ci = 'jobs:\n  e2e:\n    env:\n      E2E_IMAGE: 5\n';
  expect(pinProblems(PACKAGE_JSON, ci)).toHaveLength(1);
});

const SCRIPT_SHAPE =
  'the e2e:update script must start exactly one mcr.microsoft.com/playwright:v<version>-noble@sha256:<64 hex digits> image';

test.each([
  ['no image', 'docker run yarn e2e --update-snapshots'],
  [
    'two images',
    `docker run mcr.microsoft.com/playwright:v${VERSION}-noble${DIGEST} mcr.microsoft.com/playwright:v${VERSION}-noble${DIGEST} yarn e2e`,
  ],
  ['a tag without a digest', `docker run mcr.microsoft.com/playwright:v${VERSION}-noble yarn e2e`],
  ['a short digest', `docker run mcr.microsoft.com/playwright:v${VERSION}-noble@sha256:abc yarn e2e`],
  ['another flavour', `docker run mcr.microsoft.com/playwright:v${VERSION}-jammy${DIGEST} yarn e2e`],
  ['a floating tag', 'docker run mcr.microsoft.com/playwright:latest yarn e2e'],
])('an e2e:update script with %s fails', (_what, script) => {
  const manifest = JSON.stringify({
    devDependencies: { '@playwright/test': VERSION },
    scripts: { 'e2e:update': script },
  });
  expect(pinProblems(manifest, CI_YAML)).toEqual([SCRIPT_SHAPE]);
});

test('an e2e:update image with another digest than the CI image fails, so a re-pushed tag cannot write baselines', () => {
  const other = `@sha256:${'a'.repeat(64)}`;
  const package2 = changed(PACKAGE_JSON, `noble${DIGEST} `, `noble${other} `);
  expect(pinProblems(package2, CI_YAML)).toEqual([
    `the e2e:update image digest ${other.slice(1)} is not the digest of the e2e job image ${DIGEST.slice(1)}`,
  ]);
});

test('a package.json without scripts fails on the e2e:update script', () => {
  const manifest = JSON.stringify({ devDependencies: { '@playwright/test': VERSION } });
  expect(pinProblems(manifest, CI_YAML)).toHaveLength(1);
});
