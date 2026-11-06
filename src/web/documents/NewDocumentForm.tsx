// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { ErrorState } from '../states/ErrorState.tsx';
import { Button, DialogClose } from '../ui/index.ts';
import { FOOTER_CLASSES } from '../ui/overlay.tsx';
import { KindField } from './KindField.tsx';
import { NameField } from './NameField.tsx';
import { ScopeRepositories } from './ScopeRepositories.tsx';
import { useNewDocument } from './use-new-document.ts';

export interface NewDocumentFormProps {
  readonly installationId: number;
}

/**
 * The form of the new-document dialog (E18-S05): the name (1 to 100 characters), the scope (the whole installation, or one of the
 * first repositories of the tenant, by name) and the kind (only the kinds the server accepts). A rule the server refuses the create
 * with is shown on the field it is about (`invalid_name`, `document_name_taken` and `document_limit_reached` on the name,
 * `kind_not_supported` on the kind); any other failure is the error state above the buttons, and the typed values stay.
 */
export function NewDocumentForm({ installationId }: NewDocumentFormProps) {
  const t = useT();
  const form = useNewDocument(installationId);
  return (
    <form onSubmit={form.submit} noValidate className="flex flex-col gap-4">
      <NameField
        value={form.values.name}
        rule={form.nameRule}
        onChange={(name) => {
          form.change({ name });
        }}
      />
      <ScopeRepositories
        installationId={installationId}
        value={form.values.scope}
        onChange={(scope) => {
          form.change({ scope });
        }}
      />
      <KindField
        value={form.values.kind}
        rule={form.kindRule}
        onChange={(kind) => {
          form.change({ kind });
        }}
      />
      {form.failure === undefined ? null : <ErrorState variant="banner" error={form.failure} />}
      <div className={FOOTER_CLASSES}>
        <DialogClose>
          <Button variant="secondary">{t('common.cancel')}</Button>
        </DialogClose>
        <Button type="submit" variant="primary" loading={form.pending}>
          {t('documents.new.submit')}
        </Button>
      </div>
    </form>
  );
}
