// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
//
// `node scripts/ci/install-trivy.ts`: installs the pinned Trivy release into `$RUNNER_TEMP/trivy` for the CI `trivy` job. It
// downloads the tarball from the GitHub release, checks its SHA-256 against the pin in ci.yml, unpacks the `trivy` binary
// and puts its directory on the PATH of the next steps (the GITHUB_PATH file).
// Logic-free on purpose: everything lives in lib/trivy-install.ts and is tested there.
import process from 'node:process';
import { stdIo } from './lib/io.ts';
import { runTrivyInstall } from './lib/trivy-install.ts';
import { systemDeps } from './lib/trivy-install-deps.ts';

process.exitCode = await runTrivyInstall(process.env, stdIo, systemDeps);
