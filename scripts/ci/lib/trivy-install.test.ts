// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import type { ExecResult } from './exec.ts';
import { collectIo, fail, ok } from './test-support.ts';
import { runTrivyInstall } from './trivy-install.ts';
import type { TrivyInstallDeps } from './trivy-install-deps.ts';
import { SHA256_VARIABLE, VERSION_VARIABLE } from './trivy-install-plan.ts';

const ARCHIVE_BYTES = new TextEncoder().encode('pretend this is the release tarball');
const SHA256 = createHash('sha256').update(ARCHIVE_BYTES).digest('hex');
const ENV = {
  RUNNER_TEMP: '/runner/tmp',
  GITHUB_PATH: '/runner/path-file',
  [VERSION_VARIABLE]: '0.76.1',
  [SHA256_VARIABLE]: SHA256,
};
const ARCHIVE = '/runner/tmp/trivy_0.76.1_Linux-64bit.tar.gz';
const URL = 'https://github.com/aquasecurity/trivy/releases/download/v0.76.1/trivy_0.76.1_Linux-64bit.tar.gz';
const CURL = `exec curl --fail --silent --show-error --location --retry 3 --proto =https --proto-redir =https --output ${ARCHIVE} ${URL}`;
const TAR = `exec tar -xzf ${ARCHIVE} -C /runner/tmp/trivy trivy`;
const VERSION = 'exec /runner/tmp/trivy/trivy --version';

interface Replies {
  readonly curl?: ExecResult;
  readonly tar?: ExecResult;
  readonly trivy?: ExecResult;
  readonly bytes?: Uint8Array;
}

/** Dependencies that do nothing but record, in order, what the installer asked for, and answer from `replies`. */
function recorder(replies: Replies = {}) {
  const events: string[] = [];
  const answers = new Map<string, ExecResult>([
    ['curl', replies.curl ?? ok()],
    ['tar', replies.tar ?? ok()],
  ]);
  const deps: TrivyInstallDeps = {
    exec: (file, args, env) => {
      events.push(`exec ${file} ${args.join(' ')}`);
      expect(env).toBeUndefined();
      return Promise.resolve(answers.get(file) ?? replies.trivy ?? ok('Version: 0.76.1\nVulnerability DB:\n'));
    },
    readFile: (file) => {
      events.push(`read ${file}`);
      return replies.bytes ?? ARCHIVE_BYTES;
    },
    makeDirectory: (directory) => {
      events.push(`mkdir ${directory}`);
    },
    removeFile: (file) => {
      events.push(`rm ${file}`);
    },
    appendFile: (file, text) => {
      events.push(`append ${file} ${JSON.stringify(text)}`);
    },
  };
  return { deps, events };
}

test('a good download is checked, unpacked, tried and put on the PATH, in that order, and the archive is removed', async () => {
  const { deps, events } = recorder();
  const { io, out, err } = collectIo();
  expect(await runTrivyInstall(ENV, io, deps)).toBe(0);
  expect(events).toEqual([
    'mkdir /runner/tmp/trivy',
    CURL,
    `read ${ARCHIVE}`,
    TAR,
    `rm ${ARCHIVE}`,
    VERSION,
    'append /runner/path-file "/runner/tmp/trivy\\n"',
  ]);
  expect(out).toEqual([`${URL} matches the pinned SHA-256`, 'installed Version: 0.76.1 in /runner/tmp/trivy']);
  expect(err).toEqual([]);
});

test('the release URL and the file name follow the version', async () => {
  const { deps, events } = recorder();
  const { io } = collectIo();
  expect(await runTrivyInstall({ ...ENV, [VERSION_VARIABLE]: '1.20.300' }, io, deps)).toBe(0);
  expect(events[1]).toContain(
    '--output /runner/tmp/trivy_1.20.300_Linux-64bit.tar.gz https://github.com/aquasecurity/trivy/releases/download/v1.20.300/trivy_1.20.300_Linux-64bit.tar.gz',
  );
});

test('the line the binary prints for --version is shown with control characters escaped', async () => {
  const { deps } = recorder({ trivy: ok('Version: \u001b[31m0.76.1\nsecond line\n') });
  const { io, out } = collectIo();
  expect(await runTrivyInstall(ENV, io, deps)).toBe(0);
  expect(out.at(-1)).toBe('installed Version: \\x1b[31m0.76.1 in /runner/tmp/trivy');
});

test.each([
  ['RUNNER_TEMP is missing', { RUNNER_TEMP: undefined }, 'RUNNER_TEMP must be an absolute path, got ""'],
  ['RUNNER_TEMP is relative', { RUNNER_TEMP: 'tmp' }, 'RUNNER_TEMP must be an absolute path, got "tmp"'],
  [
    'RUNNER_TEMP has a control character',
    { RUNNER_TEMP: 'tmp\u001b[2J' },
    'RUNNER_TEMP must be an absolute path, got "tmp\\x1b[2J"',
  ],
  [
    'GITHUB_PATH is missing',
    { GITHUB_PATH: undefined },
    'GITHUB_PATH is not set: this helper runs in a GitHub Actions step',
  ],
  ['GITHUB_PATH is empty', { GITHUB_PATH: '' }, 'GITHUB_PATH is not set: this helper runs in a GitHub Actions step'],
  [
    'the version is missing',
    { [VERSION_VARIABLE]: undefined },
    `${VERSION_VARIABLE} must be a release number such as 1.2.3, got ""`,
  ],
  [
    'the version has a v',
    { [VERSION_VARIABLE]: 'v0.76.1' },
    `${VERSION_VARIABLE} must be a release number such as 1.2.3, got "v0.76.1"`,
  ],
  [
    'the version has two numbers',
    { [VERSION_VARIABLE]: '0.76' },
    `${VERSION_VARIABLE} must be a release number such as 1.2.3, got "0.76"`,
  ],
  [
    'the version has four numbers',
    { [VERSION_VARIABLE]: '0.76.1.2' },
    `${VERSION_VARIABLE} must be a release number such as 1.2.3, got "0.76.1.2"`,
  ],
  [
    'the version is a path',
    { [VERSION_VARIABLE]: '0.76.1/../x' },
    `${VERSION_VARIABLE} must be a release number such as 1.2.3, got "0.76.1/../x"`,
  ],
  [
    'the version ends in a line break',
    { [VERSION_VARIABLE]: '0.76.1\n' },
    `${VERSION_VARIABLE} must be a release number such as 1.2.3, got "0.76.1\\x0a"`,
  ],
  [
    'the digest is missing',
    { [SHA256_VARIABLE]: undefined },
    `${SHA256_VARIABLE} must be 64 lowercase hex digits, got ""`,
  ],
  [
    'the digest has capitals',
    { [SHA256_VARIABLE]: SHA256.toUpperCase() },
    `${SHA256_VARIABLE} must be 64 lowercase hex digits, got "${SHA256.toUpperCase()}"`,
  ],
  [
    'the digest is one digit short',
    { [SHA256_VARIABLE]: SHA256.slice(1) },
    `${SHA256_VARIABLE} must be 64 lowercase hex digits, got "${SHA256.slice(1)}"`,
  ],
  [
    'the digest is one digit long',
    { [SHA256_VARIABLE]: `${SHA256}0` },
    `${SHA256_VARIABLE} must be 64 lowercase hex digits, got "${SHA256}0"`,
  ],
  [
    'the digest ends in a line break',
    { [SHA256_VARIABLE]: `${SHA256}\n` },
    `${SHA256_VARIABLE} must be 64 lowercase hex digits, got "${SHA256}\\x0a"`,
  ],
])('nothing runs when %s', async (_what, change, message) => {
  const { deps, events } = recorder();
  const { io, out, err } = collectIo();
  expect(await runTrivyInstall({ ...ENV, ...change }, io, deps)).toBe(1);
  expect(events).toEqual([]);
  expect(out).toEqual([]);
  expect(err).toEqual([`install-trivy install: ${message}`]);
});

test('a failed download stops before anything is read or unpacked, and says what curl said', async () => {
  const { deps, events } = recorder({ curl: fail('curl: (6) Could not resolve host: github.com\n', 6) });
  const { io, out, err } = collectIo();
  expect(await runTrivyInstall(ENV, io, deps)).toBe(1);
  expect(events).toEqual(['mkdir /runner/tmp/trivy', CURL, `rm ${ARCHIVE}`]);
  expect(out).toEqual([]);
  expect(err).toEqual([
    'install-trivy install: curl failed with exit code 6: curl: (6) Could not resolve host: github.com',
  ]);
});

test('an archive that is not the pinned one is refused, removed, and never unpacked or put on the PATH', async () => {
  const other = new TextEncoder().encode('a different archive');
  const actual = createHash('sha256').update(other).digest('hex');
  const { deps, events } = recorder({ bytes: other });
  const { io, out, err } = collectIo();
  expect(await runTrivyInstall(ENV, io, deps)).toBe(1);
  expect(events).toEqual(['mkdir /runner/tmp/trivy', CURL, `read ${ARCHIVE}`, `rm ${ARCHIVE}`]);
  expect(out).toEqual([]);
  expect(err).toEqual([
    `install-trivy install: SHA-256 of ${URL} is ${actual}, not the pinned ${SHA256}: nothing was unpacked`,
  ]);
});

test('an empty download is not the pinned archive either', async () => {
  const { deps, events } = recorder({ bytes: new Uint8Array() });
  const { io, err } = collectIo();
  expect(await runTrivyInstall(ENV, io, deps)).toBe(1);
  expect(events).not.toContain(TAR);
  expect(err.join('\n')).toContain('SHA-256 of');
});

test('a failed unpack removes the archive and leaves the PATH alone', async () => {
  const { deps, events } = recorder({ tar: fail('tar: trivy: Not found in archive\n', 2) });
  const { io, err } = collectIo();
  expect(await runTrivyInstall(ENV, io, deps)).toBe(1);
  expect(events).toEqual(['mkdir /runner/tmp/trivy', CURL, `read ${ARCHIVE}`, TAR, `rm ${ARCHIVE}`]);
  expect(err).toEqual(['install-trivy install: tar failed with exit code 2: tar: trivy: Not found in archive']);
});

test('a binary that does not run is reported and is not put on the PATH', async () => {
  const { deps, events } = recorder({ trivy: fail('spawn /runner/tmp/trivy/trivy ENOENT', 127) });
  const { io, out, err } = collectIo();
  expect(await runTrivyInstall(ENV, io, deps)).toBe(1);
  expect(events.at(-1)).toBe(VERSION);
  expect(out).toEqual([`${URL} matches the pinned SHA-256`]);
  expect(err).toEqual([
    'install-trivy install: trivy --version failed with exit code 127: spawn /runner/tmp/trivy/trivy ENOENT',
  ]);
});

test('a multi-line error is shown with every further line prefixed, so a log line cannot pass for a workflow command', async () => {
  const { deps } = recorder({ curl: fail('first\n::error::forged\n', 22) });
  const { io, err } = collectIo();
  expect(await runTrivyInstall(ENV, io, deps)).toBe(1);
  expect(err).toEqual(['install-trivy install: curl failed with exit code 22: first', '| ::error::forged']);
});
