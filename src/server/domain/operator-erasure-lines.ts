// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../shared/github-id.ts';
import {
  type ErasedInstallation,
  type Footprint,
  type InstallationFootprint,
  rowsOf,
  sameSignatures,
  signaturesOf,
  snapshotsOf,
  withRows,
  withSnapshots,
} from './operator-erasure.ts';

// The wording of the operator's erasure command (E22-S05). Every line the command prints is built here from numbers and fixed
// words, so no name, login or email can reach it: a footprint holds counts and installation ids and nothing a person typed.

/** The one line per installation that a dry run and a report print. */
const installationLine = (installation: InstallationFootprint): string =>
  `installation ${installation.installationId}: ${installation.signerPiiRows} signer_pii rows, ${installation.loginSnapshots} allowlist logins, ${installation.signatures} signature cores`;

/** What a dry run prints: the totals, the counts per installation, and that nothing was changed. */
export function dryRunLines(githubId: GithubId, before: Footprint): string[] {
  const scrubbed = before.scrubbed ? 'yes' : 'no';
  const lines = [
    `erase dry run for GitHub id ${githubId}: ${rowsOf(before)} signer_pii rows and ${snapshotsOf(before)} allowlist logins in ${before.installations.length} installations, ${signaturesOf(before)} signature cores would be kept, users snapshot scrubbed: ${scrubbed}`,
    ...before.installations.map(installationLine),
  ];
  if (before.installations.length === 0) {
    lines.push(
      'no installation holds a signature or an allowlisted login of this person, so the erasure function has no installation to run in: --execute would leave the users snapshot as it is and exit 3',
    );
  }
  return [...lines, 'nothing was changed; add --execute to erase'];
}

/** What a finished erasure prints: the rows deleted per installation, the cores kept, and that the snapshot is scrubbed. */
export function erasedLines(githubId: GithubId, before: Footprint, erased: readonly ErasedInstallation[]): string[] {
  const deleted = erased.reduce((total, installation) => total + installation.deleted, 0);
  return [
    `erased GitHub id ${githubId}: ${deleted} signer_pii rows deleted and ${snapshotsOf(before)} allowlist logins cleared in ${erased.length} installations, ${signaturesOf(before)} signature cores kept, users snapshot scrubbed`,
    ...erased.map(
      (installation) => `installation ${installation.installationId}: ${installation.deleted} signer_pii rows deleted`,
    ),
  ];
}

/** What the command prints when the check after the erasure does not hold: the counts that differ, and nothing else. */
export function mismatchLines(githubId: GithubId, before: Footprint, after: Footprint): string[] {
  const left = withRows(after);
  const lines = [`erase failed: the check after the erasure of GitHub id ${githubId} does not hold`];
  if (left.length > 0) {
    lines.push(
      `signer_pii rows left: ${rowsOf(after)}`,
      ...left.map(
        (installation) =>
          `installation ${installation.installationId}: ${installation.signerPiiRows} signer_pii rows left`,
      ),
    );
  }
  const listed = withSnapshots(after);
  if (listed.length > 0) {
    lines.push(
      `allowlist logins left: ${snapshotsOf(after)}`,
      ...listed.map(
        (installation) =>
          `installation ${installation.installationId}: ${installation.loginSnapshots} allowlist logins left`,
      ),
    );
  }
  if (!after.scrubbed) {
    lines.push('users snapshot scrubbed: no');
  }
  if (!sameSignatures(before, after)) {
    lines.push(`signature cores: ${signaturesOf(before)} before, ${signaturesOf(after)} after`);
  }
  return lines;
}

/** The ids of installations as a list a person can read, or `none`. */
const listOf = (ids: readonly number[]): string => (ids.length === 0 ? 'none' : ids.join(', '));

/** What the command prints, after the line that names the error, when a call fails part-way: where the loop stood. */
export const partialLine = (done: readonly number[], pending: readonly number[]): string =>
  `installations done: ${listOf(done)}; pending: ${listOf(pending)}; running the command again is safe`;
