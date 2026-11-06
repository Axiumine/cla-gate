// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type SyntheticEvent, useState } from 'react';
import type { ClaDocumentKind } from '../../shared/cla.ts';
import { normaliseDocumentName } from '../../shared/cla-name.ts';
import { createDocumentRoute } from '../../shared/cla-routes.ts';
import { useApiClient } from '../auth/hooks.ts';
import { documentListKey } from './document-queries.ts';
import { shownRuleOf } from './document-rules.ts';
import { useSingleFlight } from './use-single-flight.ts';

/** The rules of the create that are shown on the name; the limit is shown there too, because the name is what the person was filling in. */
const NAME_RULES = ['invalid_name', 'document_name_taken', 'document_limit_reached'] as const;

type NameRule = (typeof NAME_RULES)[number];

/** The rule of `error` that belongs to the name field. */
function nameRuleOf(error: unknown): NameRule | undefined {
  const rule = shownRuleOf(error);
  return NAME_RULES.find((candidate) => candidate === rule);
}

/** The one rule of the create that belongs to the kind field. */
function kindRuleOf(error: unknown): 'kind_not_supported' | undefined {
  return shownRuleOf(error) === 'kind_not_supported' ? 'kind_not_supported' : undefined;
}

/** The values of the dialog: the scope is `''` for the whole installation, else the id of a repository as text. */
export interface NewDocumentValues {
  readonly name: string;
  readonly scope: string;
  readonly kind: ClaDocumentKind;
}

/** The create request: once the document exists the list is made out of date and the person is taken to its editor. */
function useCreateDocument(installationId: number) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    gcTime: 0,
    mutationFn: (request: NewDocumentValues) =>
      client.call(createDocumentRoute, {
        params: { installationId },
        body: {
          name: request.name,
          kind: request.kind,
          ...(request.scope === '' ? {} : { repositoryId: Number(request.scope) }),
        },
      }),
    onSuccess: ({ document }) => {
      void queryClient.invalidateQueries({ queryKey: documentListKey(installationId) });
      void navigate({
        to: '/installations/$installationId/documents/$documentId',
        params: { installationId, documentId: document.id },
      });
    },
  });
}

/**
 * The state and the request of the new-document dialog (E18-S05). A name that cannot be one (`normaliseDocumentName`, the cleaning
 * the server applies) is refused before anything is sent, with the same words as the server's `invalid_name`; the other rules of
 * the create come back from the server and are put on their field, and editing a value clears them. The request is sent once at a time.
 */
export function useNewDocument(installationId: number) {
  const [values, setValues] = useState<NewDocumentValues>({ name: '', scope: '', kind: 'individual' });
  const [nameRefused, setNameRefused] = useState(false);
  const mutation = useCreateDocument(installationId);
  const send = useSingleFlight(mutation);
  const error = mutation.isError ? mutation.error : undefined;
  const nameRule: NameRule | undefined = nameRefused ? 'invalid_name' : nameRuleOf(error);
  const kindRule = kindRuleOf(error);
  return {
    values,
    change: (changes: Partial<NewDocumentValues>) => {
      setValues({ ...values, ...changes });
      setNameRefused(false);
      mutation.reset();
    },
    submit: (event: SyntheticEvent) => {
      event.preventDefault();
      const name = normaliseDocumentName(values.name);
      setNameRefused(name === null);
      if (name !== null) {
        send({ ...values, name });
      }
    },
    pending: mutation.isPending,
    nameRule,
    kindRule,
    failure: nameRule === undefined && kindRule === undefined ? error : undefined,
  };
}
