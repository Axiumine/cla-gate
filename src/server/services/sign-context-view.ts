// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { pullRequestUrl } from '../domain/pull-request-url.ts';
import { signStatus, type ViewerSignature } from '../domain/sign-state.ts';
import type { SignDocument, SignRepository, StoredSignature } from './sign-context-queries.ts';

// The parts of the sign page answer (E13-S02), each made from what the queries read: pure functions from the stored rows to
// the shapes the wire carries. Instants leave as ISO 8601 in UTC; nothing here reads the database or the clock.

/** A stored signature as the pure function takes it: the instants as milliseconds, which the domain layer has no `Date` for. */
function factsOf(signature: StoredSignature): ViewerSignature {
  return {
    id: signature.id,
    major: signature.major,
    minor: signature.minor,
    signedAtMs: signature.signedAt.getTime(),
    revokedAtMs: signature.revokedAt?.getTime() ?? null,
  };
}

/** An instant in milliseconds since the epoch as the wire carries it. */
const isoOf = (ms: number): string => new Date(ms).toISOString();

/** The part of the answer that comes from the viewer's signatures, as the wire carries it. */
export function standing(document: SignDocument, signatures: readonly StoredSignature[]) {
  const { state, signature, revoked } = signStatus(document.version.major, signatures.map(factsOf));
  return {
    state,
    signature:
      signature === null
        ? null
        : { id: signature.id, major: signature.major, minor: signature.minor, signedAt: isoOf(signature.signedAtMs) },
    revoked:
      revoked === null
        ? null
        : { major: revoked.major, signedAt: isoOf(revoked.signedAtMs), revokedAt: isoOf(revoked.revokedAtMs) },
  };
}

/** The document and its active version as the wire carries them. */
export function documentView(document: SignDocument) {
  const { version } = document;
  return {
    document: { id: document.id, name: document.name },
    version: {
      id: version.id,
      major: version.major,
      minor: version.minor,
      contentMd: version.contentMd,
      contentSha256: version.contentSha256,
      rationale: version.rationale,
      publishedAt: version.publishedAt.toISOString(),
    },
  };
}

/** The part of the answer about the repository and the pull request the person came from. */
export function repositoryView(repository: SignRepository, prNumber: number | null) {
  return {
    repository: {
      githubRepoId: repository.githubRepoId,
      fullName: repository.fullName,
      accountLogin: repository.accountLogin,
    },
    pr: prNumber,
    prUrl: prNumber === null ? null : pullRequestUrl(repository.fullName, prNumber),
  };
}
