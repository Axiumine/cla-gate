// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQuery } from '@tanstack/react-query';
import type { InstallationRole } from '../../shared/installations.ts';
import { useApiClient } from '../auth/hooks.ts';
import { useT } from '../i18n/index.ts';
import { QueryBoundary } from '../states/QueryBoundary.tsx';
import { Button, DialogClose } from '../ui/index.ts';
import { FOOTER_CLASSES } from '../ui/overlay.tsx';
import { AttachFailure } from './AttachFailure.tsx';
import { ChoiceField } from './ChoiceField.tsx';
import { documentIdOf } from './document-choices.ts';
import { repositoryDocumentsQueryOptions } from './repository-documents-query.ts';
import type { Repository } from './repository-queries.ts';
import { useAttachChoice } from './use-attach-choice.ts';
import type { useAttachDocument } from './use-attach-document.ts';

export interface AttachFormProps {
  /** `installations.id` of the tenant in the address. */
  readonly installationId: number;
  readonly repository: Repository;
  /** The role in the installation, for the link to the editor. */
  readonly role: InstallationRole | undefined;
  /** The request of the attach; the form lives in the dialog, the request outlives a close that is refused while it is out. */
  readonly attach: ReturnType<typeof useAttachDocument>;
}

/**
 * The form of the attach dialog (E18-S10): the documents the repository may enforce (`GET .../repositories/:repositoryId/documents`, asked
 * for when the dialog opens), the document it enforces now preselected, and "No CLA (detach)". The form exists only while the dialog is
 * open, so it starts from the repository's document the next time. A rule the server refuses the change with is told in the dialog
 * (`document_unpublished` with a link to the editor of the chosen document) and goes away when another document is chosen.
 */
export function AttachForm({ installationId, repository, role, attach }: AttachFormProps) {
  const t = useT();
  const documents = useQuery(repositoryDocumentsQueryOptions(useApiClient(), installationId, repository.id));
  const { choice, setChoice, current, choices, chosen } = useAttachChoice(repository, documents.data);
  const send = () => {
    attach.send(documentIdOf(choice));
  };
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <QueryBoundary query={documents} errorLevel={3}>
        {() => (
          <ChoiceField
            choices={choices}
            current={current}
            value={choice}
            onChange={(value) => {
              setChoice(value);
              attach.reset();
            }}
          />
        )}
      </QueryBoundary>
      {attach.failure === undefined ? null : (
        <AttachFailure
          installationId={installationId}
          error={attach.failure}
          chosen={chosen}
          role={role}
          retry={send}
          retrying={attach.pending}
        />
      )}
      <div className={FOOTER_CLASSES}>
        <DialogClose>
          <Button variant="secondary">{t('common.cancel')}</Button>
        </DialogClose>
        <Button type="submit" variant="primary" loading={attach.pending} disabled={documents.data === undefined}>
          {t('repositories.attach.submit')}
        </Button>
      </div>
    </form>
  );
}
