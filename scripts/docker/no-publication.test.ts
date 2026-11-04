// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { readText } from '../ci/lib/test-support.ts';
import { listFiles, publicationFindings, ROOT } from './test-support.ts';

// E19-S01: the image is built from the checkout and never pushed. No workflow, script or compose file may publish one:
// no push, no login to a registry, no permission to write packages, no pushing build option. The scan reads every file under
// .github/ and scripts/ (this test excluded, its samples name the words) and every docker*.yml at the root, and the
// Dockerfile and the docker/ directory as well.

const THIS_FILE = 'scripts/docker/no-publication.test.ts';

function rootFiles(): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the repository root, a fixed path
  return fs.readdirSync(ROOT).filter((name) => /^(?:docker.*\.ya?ml|Dockerfile)$/.test(name));
}

const scanned = [...listFiles('.github'), ...listFiles('scripts'), ...listFiles('docker'), ...rootFiles()].filter(
  (file) => file !== THIS_FILE,
);

test('the scan covers the workflows, the scripts, the Dockerfile and the compose file', () => {
  expect(scanned).toEqual(
    expect.arrayContaining([
      '.github/workflows/ci.yml',
      'scripts/ci/postgres.ts',
      'scripts/docker/test-support.ts',
      'docker-compose.yml',
      'Dockerfile',
    ]),
  );
  expect(scanned).not.toContain(THIS_FILE);
});

test('a directory that does not exist has no files', () => {
  expect(listFiles('no-such-directory')).toEqual([]);
});

test('no file publishes an image', () => {
  const found = scanned.flatMap((file) =>
    publicationFindings(readText(path.join(ROOT, file))).map((finding) => `${file}: ${finding}`),
  );
  expect(found).toEqual([]);
});

test.each([
  ['docker push ghcr.io/example/image:latest', 'a push to a registry'],
  ['  run: docker  image push example/image', 'a push to a registry'],
  ['run: docker login ghcr.io -u me', 'a login to a registry'],
  ['uses: docker/login-action@0000000000000000000000000000000000000000', 'the registry login action'],
  ['permissions:\n  packages: write', 'the permission to write packages'],
  ['permissions:\n  packages: "write"', 'the permission to write packages'],
  ['with:\n  push: true', 'a build that pushes'],
  ["with:\n  push: 'true'", 'a build that pushes'],
])('the scan recognises %j as %s', (sample, name) => {
  expect(publicationFindings(sample)).toEqual([name]);
});

test.each([
  'packages: read',
  'push: false',
  'run: docker build --tag cla-gate:local .',
  'run: docker pull postgres:18',
  'a push to main triggers the workflow',
])('the scan lets %j through', (sample) => {
  expect(publicationFindings(sample)).toEqual([]);
});
