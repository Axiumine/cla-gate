// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { AUDIT_ACTIONS } from '../../shared/audit.ts';
import { AUDIT_SUBJECT_TYPE_PATTERN } from '../../shared/audit-log.ts';
import type { AuditFilters } from './audit-filters.ts';
import { endsBeforeStart, instantDisplay, instantText } from './audit-instant.ts';

// The filter form of the audit screen (E18-S09): the text in its fields, the zod schema that turns it into filters, and the field
// errors when it cannot. A field left empty is no filter; a field that holds something that is not a value is an error on that field
// and nothing is asked for; a `to` that ends before the `from` is an error on `to`.

/** What the fields hold, as the text of each. */
export interface FilterFormValues {
  readonly action: string;
  readonly actorGithubId: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly from: string;
  readonly to: string;
}

/** The fields of the form, in the order they are shown. */
export type FilterField = keyof FilterFormValues;

/** What is wrong with a field: it holds no value, or (`to` only) it ends the range before its start. */
export type FilterProblem = 'invalid' | 'before_from';

/** The fields that cannot be read, each with its problem; empty when the form is fine. */
export type FilterErrors = ReadonlyMap<FilterField, FilterProblem>;

/** A whole number above zero in plain digits, as the server reads it: no sign, no leading zero, within what a number holds exactly. */
const idText = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .pipe(z.int().positive());

const blank = z.literal('').transform((): undefined => undefined);

/** A field that may be left empty (no filter) and otherwise holds what `schema` reads, blanks around it ignored. */
const orBlank = <Value>(schema: z.ZodType<Value, string>) =>
  z
    .string()
    .trim()
    .pipe(z.union([blank, schema]));

/** The form as zod reads it: the `to` check runs only when both ends are values, so it never adds a second error to a bad field. */
const filterFormSchema = z
  .object({
    action: orBlank(z.enum(AUDIT_ACTIONS)),
    actorGithubId: orBlank(idText),
    subjectType: orBlank(z.string().regex(AUDIT_SUBJECT_TYPE_PATTERN)),
    subjectId: orBlank(idText),
    from: orBlank(instantText),
    to: orBlank(instantText),
  })
  .refine(({ from, to }) => !endsBeforeStart(from, to), { path: ['to'], message: 'before_from' });

/** The fields of the form, for the lookup of an error. */
const FIELDS: readonly FilterField[] = ['action', 'actorGithubId', 'subjectType', 'subjectId', 'from', 'to'];

/** The result of reading the form: the filters, or the fields that cannot be read. */
export type FilterParse =
  | { readonly ok: true; readonly filters: AuditFilters }
  | { readonly ok: false; readonly errors: FilterErrors };

/** What a zod issue of the form says about its field: only the range check carries `before_from`. */
function problemOf(message: string): FilterProblem {
  return message === 'before_from' ? 'before_from' : 'invalid';
}

/** Reads the text of the form into filters, or says which fields it cannot read. */
export function parseFilterForm(values: FilterFormValues): FilterParse {
  const result = filterFormSchema.safeParse(values);
  if (result.success) {
    return { ok: true, filters: result.data };
  }
  const problems = new Map<PropertyKey | undefined, FilterProblem>(
    result.error.issues.map((issue) => [issue.path[0], problemOf(issue.message)]),
  );
  const errors = FIELDS.flatMap((field): [FilterField, FilterProblem][] => {
    const problem = problems.get(field);
    return problem === undefined ? [] : [[field, problem]];
  });
  return { ok: false, errors: new Map(errors) };
}

/** The text the fields start with for these filters: each value in the shortest form that is read back as it was. */
export function valuesOf(filters: AuditFilters): FilterFormValues {
  return {
    action: filters.action ?? '',
    actorGithubId: filters.actorGithubId === undefined ? '' : String(filters.actorGithubId),
    subjectType: filters.subjectType ?? '',
    subjectId: filters.subjectId === undefined ? '' : String(filters.subjectId),
    from: filters.from === undefined ? '' : instantDisplay(filters.from),
    to: filters.to === undefined ? '' : instantDisplay(filters.to),
  };
}
