// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { parseGithubRepoId } from '../sign/params.ts';

// Where "Sign again" of the "my signatures" screen leads (E18-S03).

/** The start of a `resignPath`: the schema of the endpoint admits `/sign/` and a number and nothing else. */
const SIGN_PREFIX = '/sign/';

/**
 * The numeric GitHub repository id of a `resignPath`, or `undefined` when there is no path to sign again from, or when the id in
 * it is not one the sign page takes (the schema admits more digits than a safe integer): such a row gets no link instead of a
 * link to a page of the app that does not exist.
 */
export function resignRepositoryId(resignPath: string | null): number | undefined {
  return resignPath === null ? undefined : parseGithubRepoId(resignPath.slice(SIGN_PREFIX.length));
}
