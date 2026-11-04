// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// The Node flag that every process of a Stryker run starts with (E20-S04): the main process (scripts/mutation-gate/mutate-run.ts)
// and the checker and test runner processes it forks (`checkerNodeArgs` and `testRunnerNodeArgs` in stryker.config.mjs).
//
// Why: Stryker sends a message to a child as `worker.send(JSON.stringify(message))`, a string, and Node's IPC channel then
// JSON-stringifies that string a second time. The message that asks the TypeScript checker to group the mutants holds every
// mutant of the shard with the ids of the tests that cover it, twice (`coveredBy` and `testFilter`), so its size grows with
// the number of mutants times the number of tests that reach them: hundreds of megabytes for a shard of 2000 mutants and 5000
// tests. The second pass is a `JSON.stringify` of one flat string, and since V8 13.6 (the default in Node 25 and 26) its fast
// path reserves 8 bytes per character in one allocation. From 268 435 451 one-byte characters, or 134 217 726 two-byte ones,
// that is over 2 GiB, and V8 aborts the whole process with `FATAL ERROR: Zone Allocation failed - process out of memory` at a
// heap of a few hundred megabytes; `--max-old-space-size` does not matter to it (nodejs/node#66489, open; V8 issue 568816246).
// That is what ended the main process of the `http-a-v` shard of the nightly run 41817514084 at that heap, 0.2 s after
// Stryker planned the mutants (the size of that message was not logged, so the match is by symptom and by the code, not
// measured). Reproduced on Node 26.13.0 with a fork that sends a flat string of 406 million characters. The flag turns the
// abort into a plain stringify, which works up to the string limit of V8 (536 870 888 characters; beyond it comes a
// `RangeError: Invalid string length`, which a smaller shard avoids).
//
// Node refuses this flag in NODE_OPTIONS ("is not allowed in NODE_OPTIONS"), so it goes on the command line of each process.
// Remove it when the fix of nodejs/node#66489 is in the Node of `.nvmrc`.

/** Arguments of `node` for the processes of a Stryker run, before the script. */
export const STRYKER_NODE_ARGS: readonly string[] = ['--no-json-stringify-fast-path'];
