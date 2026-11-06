// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { guarded, readError } from '../api/response.ts';
import { useSingleFlight } from '../documents/use-single-flight.ts';
import { saveBlobAs } from '../setup/download-file.ts';

/** The header the server names the file in (E16-S03): built from the document id and the UTC date, never from user text. */
const DISPOSITION = /^attachment; filename="(signatures-[1-9]\d*-\d{4}-\d{2}-\d{2}\.csv)"$/;

/** The name the file is saved as: the server's, when its header is the one it writes, else one made from the document id. */
function fileNameOf(disposition: string | null, documentId: number): string {
  const named = disposition === null ? null : DISPOSITION.exec(disposition)?.[1];
  return named ?? `signatures-${String(documentId)}.csv`;
}

/** The file of the export and the header that names it: a plain same-origin GET with the session cookie, and an error answer read like any other. */
async function fetchCsv(address: string): Promise<{ readonly file: Blob; readonly disposition: string | null }> {
  const response = await guarded(window.fetch(address, { credentials: 'same-origin' }), undefined);
  if (!response.ok) {
    throw await readError(response, Date.now(), undefined);
  }
  return { file: await guarded(response.blob(), undefined), disposition: response.headers.get('content-disposition') };
}

/** The refusal of the last attempt, kept while the next one is under way so the message and its "Try again" stay put. */
interface Refusal {
  readonly error: unknown;
}

/**
 * The download of one document's signatures (E18-S07): a GET of `address` through the browser's own `fetch`, with the cookie of the
 * session, whose answer is handed to the browser as it is: the page never reads the CSV as text and never builds it (what is
 * a formula in a cell is prefixed by the server, E16-S03). It is a request and not a plain navigation so that a `429` (six a
 * minute) arrives as an error the screen can show with its countdown, instead of an error document in the downloads folder. The file is not
 * kept in the query cache or in the state of the screen, only handed to the browser; what the screen keeps is its name.
 */
export function useCsvExport(address: string, documentId: number) {
  const [refusal, setRefusal] = useState<Refusal | undefined>(undefined);
  const mutation = useMutation({
    gcTime: 0,
    mutationFn: async () => {
      const { file, disposition } = await fetchCsv(address);
      const name = fileNameOf(disposition, documentId);
      saveBlobAs(name, file);
      return name;
    },
    onSuccess: () => {
      setRefusal(undefined);
    },
    onError: (error) => {
      setRefusal({ error });
    },
  });
  const send = useSingleFlight(mutation);
  return {
    download: () => {
      send();
    },
    pending: mutation.isPending,
    /** The name of the file that was saved by the last attempt, when it succeeded. */
    savedAs: mutation.isSuccess ? mutation.data : undefined,
    refusal,
  };
}
