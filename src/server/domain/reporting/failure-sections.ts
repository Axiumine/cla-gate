// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { signUrl } from '../../../shared/sign-link.ts';
import { corporateLine } from './check-output.ts';
import { renderName } from './encode.ts';
import { unlinkedCommits } from './failure-commits.ts';
import type { FailureRequest, ReportedEvaluation } from './failure-input.ts';
import { unsignedPeople } from './failure-people.ts';
import { countedHeading, FAILURE_NOTICES, NOT_BLOCKING_INTRO, overrideLine, signLinkPart } from './failure-text.ts';
import { type OutputPart, truncationLine } from './output-parts.ts';

// E09-S03: the sections of the failure report that depend on the evaluation, each one a list of `OutputPart`s that is empty
// when the section has nothing to say. failure-report.ts puts them in order.

/** The most unresolved co-authors the `Not blocking` section names. */
const MAX_NOT_BLOCKING = 10;

/** The sections about people and commits, with the counts the title states and the sign link when there is one. */
export interface PeopleSections {
  readonly parts: readonly OutputPart[];
  readonly unsigned: number;
  readonly unlinked: number;
  /** The address of the sign page, or `null` when nobody who can sign is unsigned. */
  readonly signUrl: string | null;
}

/**
 * The sign link, `Not signed (N)`, `Email not linked to a GitHub account (M)` and the line about overridden commits. With no
 * active CLA there is nothing to sign and nothing to link, so there are none of them.
 * @throws InvalidSignLinkError when a sign link is due and cannot be made; InvalidShaError, InvalidIdError for text that is
 * not a full commit SHA or a safe integer.
 */
export function peopleSections(request: FailureRequest): PeopleSections {
  const { evaluation, names } = request;
  if (evaluation.failureCodes.includes('no_active_cla')) {
    return { parts: [], unsigned: 0, unlinked: 0, signUrl: null };
  }
  const people = unsignedPeople(evaluation, names);
  const commits = unlinkedCommits(evaluation.findings);
  const link = people.canSign ? signUrl(request.publicBaseUrl, request.githubRepoId, request.prNumber) : null;
  const parts: OutputPart[] = [];
  if (link !== null) {
    parts.push(signLinkPart(link));
  }
  if (people.count > 0) {
    parts.push(countedHeading('Not signed', people.count), { kind: 'list', entries: people.entries });
  }
  if (commits.count > 0) {
    parts.push(countedHeading('Email not linked to a GitHub account', commits.count), {
      kind: 'list',
      entries: commits.entries,
    });
  }
  if (commits.overridden > 0) {
    parts.push(overrideLine(commits.overridden));
  }
  return { parts, unsigned: people.count, unlinked: commits.count, signUrl: link };
}

/**
 * The sentence about the people an approval of a corporate CLA covers in a pull request that still fails (E21-S05): how many, never
 * whom, and never by which company, domain or organisation. Empty when a corporate CLA covers nobody.
 */
export function corporateParts(evaluation: ReportedEvaluation): OutputPart[] {
  const covered = evaluation.actors.filter(
    (actor) => actor.covered && actor.basis?.kind === 'corporate_approval',
  ).length;
  const line = corporateLine(covered);
  return line === null ? [] : [{ kind: 'text', text: line }];
}

/** The sentences for the failure codes that no person fixes by signing or linking. */
export function noticeParts(evaluation: ReportedEvaluation): OutputPart[] {
  return evaluation.failureCodes.flatMap((code) => FAILURE_NOTICES.get(code) ?? []);
}

/** The names of the unresolved `Co-authored-by` trailers of the commits that have the advisory, once each, as code spans. */
function coAuthorNames(request: FailureRequest): string[] {
  const shas = new Set(
    request.evaluation.advisories
      .filter((advisory) => advisory.code === 'co_author_unresolved')
      .map((advisory) => advisory.sha.toLowerCase()),
  );
  const names = [...shas].flatMap((sha) => request.names.coAuthors.get(sha) ?? []);
  return [...new Set(names.map(renderName))];
}

/** `Not blocking`: the heading and sentence, the first names, and the visible line for the ones that are not shown. */
export function notBlockingParts(request: FailureRequest): OutputPart[] {
  const names = coAuthorNames(request);
  if (names.length === 0) {
    return [];
  }
  const shown = names.slice(0, MAX_NOT_BLOCKING);
  const parts: OutputPart[] = [NOT_BLOCKING_INTRO, { kind: 'list', entries: shown.map((name) => `- ${name}`) }];
  if (shown.length < names.length) {
    parts.push({ kind: 'text', text: truncationLine(names.length - shown.length) });
  }
  return parts;
}
