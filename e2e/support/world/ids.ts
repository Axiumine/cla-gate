// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// E18-S12: the numbers of the seeded world that a spec has to name: the row ids of its tenants, repositories and documents (so an
// address such as /installations/9001/documents is the same on every run) and the numeric GitHub ids of its repositories. The
// row ids are in a range that the identity sequences of a running server do not reach in a test run.

export const TENANT = { id: 9001, githubId: 91_000_001, login: 'alice-oss' } as const;
export const SECOND_TENANT = { id: 9002, githubId: 91_000_002, login: 'alice-labs' } as const;
/** The tenant of another owner: the maintainer is no admin of it. */
export const FOREIGN_TENANT = { id: 9003, githubId: 91_000_003, login: 'bob-private' } as const;

export const REPOSITORIES = {
  /** Enforcing, with the document attached: where the sign link of the seeded pull requests points. */
  widgets: { id: 9101, githubId: 71_000_101, name: 'alice-oss/widgets' },
  /** Not enforcing, no document. */
  gadgets: { id: 9102, githubId: 71_000_102, name: 'alice-oss/gadgets' },
  /** Not enforcing, a document attached. */
  legacy: { id: 9103, githubId: 71_000_103, name: 'alice-oss/legacy' },
  /** The only repository of the second tenant. */
  prototype: { id: 9104, githubId: 71_000_104, name: 'alice-labs/prototype' },
  /** The repository of the foreign tenant. */
  vault: { id: 9105, githubId: 71_000_105, name: 'bob-private/vault' },
} as const;

export const DOCUMENTS = {
  individual: { id: 9201, name: 'Individual CLA' },
  hostile: { id: 9202 },
  foreign: { id: 9203, name: 'Private CLA of another tenant' },
} as const;

export const VERSIONS = {
  v1: 9301,
  v1_1: 9302,
  v2: 9303,
  hostile: 9304,
  foreign: 9305,
} as const;

/** The pull request the seeded sign links name. */
export const SIGN_PR = 23;
