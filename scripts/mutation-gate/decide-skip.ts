// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
//
// `node scripts/mutation-gate/decide-skip.ts` (yarn mutate:decide): the skip decision of the `mutation` job. Logic-free on
// purpose: everything lives in skip-cli.ts and is tested there. It wires the environment, the streams, the global `fetch`
// and the file append into runSkipCli, and turns its result into the exit code.
import fs from 'node:fs';
import process from 'node:process';
import { stdIo } from '../ci/lib/io.ts';
import { runSkipCli } from './skip-cli.ts';

process.exitCode = await runSkipCli(process.env, stdIo, {
  fetcher: fetch,
  appendFile: (file, text) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is GITHUB_OUTPUT or GITHUB_STEP_SUMMARY, set by the Actions runner
    fs.appendFileSync(file, text);
  },
});
