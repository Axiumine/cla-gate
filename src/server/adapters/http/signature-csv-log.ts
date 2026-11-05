// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyBaseLogger } from 'fastify';

/** The event name of the warning: which export it is about (E21-S05 adds the exports of the corporate agreements). */
type ExportEvent = 'signature_export_release_failed' | 'corporate_export_release_failed';

/**
 * What the export tells the log when its snapshot could not be committed or rolled back after the response was done
 * (E16-S03): one warning with the error and nothing of the file. The caller's cells are personal data and never reach a log.
 */
export function logReleaseFailure(
  log: Pick<FastifyBaseLogger, 'warn'>,
  event: ExportEvent = 'signature_export_release_failed',
): (error: unknown) => void {
  return (error) => {
    log.warn({ err: error }, event);
  };
}
