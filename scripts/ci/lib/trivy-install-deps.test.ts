// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { makeRepo, tempDir } from '../../code-caps/test-support.ts';
import { listDir } from '../../semgrep-rules/test-support.ts';
import { type Exec, realExec } from './exec.ts';
import { systemDeps as postgresDeps } from './postgres-deps.ts';
import { collectIo, exists, readText, writeExecutable } from './test-support.ts';
import { runTrivyInstall } from './trivy-install.ts';
import { systemDeps } from './trivy-install-deps.ts';

test('the real dependencies run commands without a shell and append to a file the way the postgres helper does', () => {
  expect(systemDeps.exec).toBe(realExec);
  expect(systemDeps.appendFile).toBe(postgresDeps.appendFile);
});

test('the real file operations read bytes, create nested directories again and again, and ignore a missing file', () => {
  const root = tempDir();
  const nested = path.join(root, 'a', 'b');
  systemDeps.makeDirectory(nested);
  systemDeps.makeDirectory(nested);
  expect(listDir(path.join(root, 'a'))).toEqual(['b']);
  makeRepo(nested, { archive: 'bytes' });
  const file = path.join(nested, 'archive');
  expect(Buffer.from(systemDeps.readFile(file)).toString()).toBe('bytes');
  systemDeps.removeFile(file);
  expect(exists(file)).toBe(false);
  systemDeps.removeFile(file);
});

/** A tarball laid out like the release: the `trivy` binary (a shell script here) next to files that must stay packed. */
async function releaseTarball(root: string): Promise<string> {
  const source = path.join(root, 'source');
  makeRepo(source, { 'README.md': 'readme', 'contrib/html.tpl': 'template' });
  writeExecutable(path.join(source, 'trivy'), '#!/bin/sh\necho "Version: 0.76.1"\n');
  const tarball = path.join(root, 'release.tar.gz');
  const made = await realExec('tar', ['-czf', tarball, '-C', source, 'README.md', 'contrib', 'trivy']);
  expect(made.code).toBe(0);
  return tarball;
}

/** The real `tar`, file system and unpacked program; only `curl` is replaced, by a copy of a local file. */
function offlineExec(tarball: string): Exec {
  return async (file, args, extra) => {
    if (file !== 'curl') {
      return realExec(file, args, extra);
    }
    fs.copyFileSync(tarball, String(args[args.indexOf('--output') + 1]));
    return { code: 0, stdout: '', stderr: '' };
  };
}

/** A runner's temp directory (not yet created: the installer makes it) and the settings that name it. */
function runner(root: string, sha256: string) {
  const temp = path.join(root, 'runner-temp');
  const settings = {
    RUNNER_TEMP: temp,
    GITHUB_PATH: path.join(root, 'github-path'),
    INSTALL_TRIVY_VERSION: '0.76.1',
    INSTALL_TRIVY_SHA256: sha256,
  };
  return { temp, settings };
}

test('an install with the real tar and file system unpacks only the binary, which runs, and records its directory', async () => {
  const root = tempDir();
  const tarball = await releaseTarball(root);
  const { temp, settings } = runner(root, createHash('sha256').update(systemDeps.readFile(tarball)).digest('hex'));
  const { io, out, err } = collectIo();
  expect(await runTrivyInstall(settings, io, { ...systemDeps, exec: offlineExec(tarball) })).toBe(0);
  expect(err).toEqual([]);
  expect(out.at(-1)).toBe(`installed Version: 0.76.1 in ${temp}/trivy`);
  expect(listDir(temp)).toEqual(['trivy']);
  expect(listDir(path.join(temp, 'trivy'))).toEqual(['trivy']);
  expect(readText(settings.GITHUB_PATH)).toBe(`${temp}/trivy\n`);
});

test('an install with the real tar and file system refuses another archive, keeps nothing and does not touch the PATH file', async () => {
  const root = tempDir();
  const tarball = await releaseTarball(root);
  const { temp, settings } = runner(root, '0'.repeat(64));
  const { io, err } = collectIo();
  expect(await runTrivyInstall(settings, io, { ...systemDeps, exec: offlineExec(tarball) })).toBe(1);
  expect(err[0]).toContain('not the pinned');
  expect(listDir(temp)).toEqual(['trivy']);
  expect(listDir(path.join(temp, 'trivy'))).toEqual([]);
  expect(exists(settings.GITHUB_PATH)).toBe(false);
});
