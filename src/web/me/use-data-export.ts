// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { type DataExport, dataExportRoute } from '../../shared/data-export.ts';
import { useApiClient } from '../auth/index.ts';
import { saveAsFile } from '../setup/download-file.ts';

/** The refusal of the last attempt, kept while the next one is under way so the message and its "Try again" stay put. */
interface Refusal {
  readonly error: unknown;
}

/** Saves the export as a JSON file named after the numeric GitHub id of the person, as the server names its download. */
function saveExport(data: DataExport): string {
  const name = `cla-data-${data.user.githubId}.json`;
  saveAsFile(name, JSON.stringify(data, null, 2), 'application/json');
  return name;
}

/**
 * The download of the person's own data (E18-S03): `GET /api/me/export` through the typed client, saved as a file in the
 * browser. It is a request and not a link so that a `429` (five an hour) arrives as an error the screen can show with its
 * countdown, instead of an error document in the downloads folder. The document holds the person's name, e-mail and login:
 * it is never kept in the query cache or in the state of the screen, only handed to the browser, and what the screen keeps
 * is the name of the file.
 */
export function useDataExport() {
  const client = useApiClient();
  const [refusal, setRefusal] = useState<Refusal | undefined>(undefined);
  const mutation = useMutation({
    gcTime: 0,
    mutationFn: async () => saveExport(await client.call(dataExportRoute)),
    onSuccess: () => {
      setRefusal(undefined);
    },
    onError: (error) => {
      setRefusal({ error });
    },
  });
  return {
    download: () => {
      mutation.mutate();
    },
    pending: mutation.isPending,
    /** The name of the file that was saved by the last attempt, when it succeeded. */
    savedAs: mutation.isSuccess ? mutation.data : undefined,
    refusal,
  };
}
