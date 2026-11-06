// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { AuditAction } from '../../shared/audit.ts';

// What the audit log is narrowed to (E18-S09): the filters of the address and of the request, as values and not as the text that was
// typed (the text is `audit-filter-form.ts`).

/** The filters of the log: each one is `undefined` when it does not narrow the list. Moments are canonical UTC text. */
export interface AuditFilters {
  readonly action: AuditAction | undefined;
  /** The numeric GitHub id of the actor, never a login. */
  readonly actorGithubId: number | undefined;
  /** The kind of record an event is about, in the shape of `AUDIT_SUBJECT_TYPE_PATTERN`. */
  readonly subjectType: string | undefined;
  readonly subjectId: number | undefined;
  /** The start of the range, included. */
  readonly from: string | undefined;
  /** The end of the range, excluded. */
  readonly to: string | undefined;
}

/** No filter: the whole log. */
export const NO_FILTERS: AuditFilters = {
  action: undefined,
  actorGithubId: undefined,
  subjectType: undefined,
  subjectId: undefined,
  from: undefined,
  to: undefined,
};

/** Whether any filter narrows the list: "nothing matches" is not "nothing was recorded". */
export function isFiltered(filters: AuditFilters): boolean {
  return [filters.action, filters.actorGithubId, filters.subjectType, filters.subjectId, filters.from, filters.to].some(
    (value) => value !== undefined,
  );
}

/** A text that is the same for the same filters and differs for any other: the key a component is remounted by. */
export function filterKey(filters: AuditFilters): string {
  return JSON.stringify([
    filters.action ?? null,
    filters.actorGithubId ?? null,
    filters.subjectType ?? null,
    filters.subjectId ?? null,
    filters.from ?? null,
    filters.to ?? null,
  ]);
}
