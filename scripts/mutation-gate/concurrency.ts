// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// How many Stryker processes one run may start on the machine it finds itself on (stryker.config.mjs, `concurrency`).
//
// Stryker's own default is the number of CPUs minus one (all of them when there are four or fewer), and it knows nothing about
// memory. Half of that many processes are TypeScript checkers while the mutants are being checked, then all of them are Vitest
// test runners that hold the server suite with per-test coverage, next to the main process that holds every mutant of the
// shard. On a shared runner with 8 cores and 32 GB that is seven processes of 2 to 3 GB on top of what the other jobs of the
// host use, and the kernel's out-of-memory killer took the whole machine down, not only the job.
//
// So the count follows the resources the run has: the CPUs, and the memory that is available when the run starts
// (`process.availableMemory()`: the free memory of the host, or what is left of the limit of the container or cgroup when there
// is one). A 4-core runner with 13 GiB free gets 2 processes, an 8-core one with 28 GiB free gets 5, a 32-core one with 60 GiB
// free gets 13, and a machine that cannot hold even one child still gets 1, which is slow and finishes. Memory that other jobs
// take after the start is not seen, which is what MEMORY_SHARE is for. A `--concurrency` on the command line still wins, because Stryker reads
// the command line over the config file.

const BYTES_PER_MIB = 1024 * 1024;

/**
 * What one Stryker child process (a checker or a test runner) may need at its peak, in MiB. Measured on 2026-11-22 on the
 * development machine at `--concurrency 7`: the shard `sweep`, cold, peaked at 14.2 GiB for its whole process tree (the main
 * process and 7 children, 2 GiB each on average, the biggest 2.8 GiB); the dry run of `shared`, 7003 tests in one process,
 * had a biggest process of 3.2 GiB after 30 minutes. 3 GiB covers the biggest of those with the average slot well below it.
 */
export const CHILD_MIB = 3072;

/** What the Stryker main process needs besides its children (it holds every mutant of the shard and its results), in MiB. */
export const MAIN_MIB = 2560;

/** The part of the available memory a run plans with; the rest is for the host and for the jobs that start after this one. */
export const MEMORY_SHARE = 0.7;

/** What a run knows about the machine: its CPUs and the bytes of memory it may use. */
export interface Resources {
  readonly cpus: number;
  readonly availableBytes: number;
}

/** Stryker's own default for the CPUs alone: one less than the CPUs when there are more than four, else all of them. */
function byCpus(cpus: number): number {
  return cpus > 4 ? cpus - 1 : cpus;
}

/** The children the memory can hold: what the share of it leaves after the main process, in whole children. */
function byMemory(availableBytes: number): number {
  const planned = (availableBytes / BYTES_PER_MIB) * MEMORY_SHARE - MAIN_MIB;
  return Math.floor(planned / CHILD_MIB);
}

/**
 * The number of Stryker processes for a machine: the smaller of what the CPUs and the memory allow, and never less than one,
 * because a machine that cannot hold one child still has to run the shard.
 */
export function concurrencyFor(resources: Resources): number {
  return Math.max(1, Math.min(byCpus(resources.cpus), byMemory(resources.availableBytes)));
}
