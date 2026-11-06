// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Button } from '../ui/index.ts';
import { type AuditFilters, isFiltered, NO_FILTERS } from './audit-filters.ts';
import { ActionFilter, TextFilter } from './FilterFields.tsx';
import { type FilterForm, useFilterForm } from './use-filter-form.ts';

export interface AuditFilterFormProps {
  /** The filters of the address: what the fields start with. */
  readonly filters: AuditFilters;
  /** Puts these filters in the address; the page starts again from the first. */
  readonly onApply: (filters: AuditFilters) => void;
}

/** The typed filters: the actor, the subject (its kind and its number) and the two ends of the range, each with the error of its last submit. */
function TextFilters({ form }: { readonly form: FilterForm }) {
  const { values, errors, change } = form;
  return (
    <>
      <TextFilter
        field="actorGithubId"
        value={values.actorGithubId}
        problem={errors.get('actorGithubId')}
        onChange={change}
      />
      <TextFilter
        field="subjectType"
        value={values.subjectType}
        problem={errors.get('subjectType')}
        onChange={change}
      />
      <TextFilter field="subjectId" value={values.subjectId} problem={errors.get('subjectId')} onChange={change} />
      <TextFilter field="from" value={values.from} problem={errors.get('from')} onChange={change} />
      <TextFilter field="to" value={values.to} problem={errors.get('to')} onChange={change} />
    </>
  );
}

/**
 * The filters of the audit screen (E18-S09) in one form that is applied as a whole: the action, the numeric id of the actor, the kind
 * and the id of the subject, and a range of time in UTC. Enter in a field applies it. A field that cannot be read shows its error and
 * nothing is asked for. The form is made for the filters of the address and is remounted when they change, so Back shows the fields of
 * that address. "Clear filters" is there only while a filter is applied.
 */
export function AuditFilterForm({ filters, onApply }: AuditFilterFormProps) {
  const t = useT();
  const form = useFilterForm(filters, onApply);
  return (
    <search aria-label={t('audit.filter.label')}>
      <form onSubmit={form.submit} noValidate className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <ActionFilter value={form.values.action} onChange={form.change} />
          <TextFilters form={form} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary">
            {t('audit.filter.apply')}
          </Button>
          {isFiltered(filters) ? (
            <Button
              onClick={() => {
                onApply(NO_FILTERS);
              }}
            >
              {t('audit.filter.clear')}
            </Button>
          ) : null}
        </div>
      </form>
    </search>
  );
}
