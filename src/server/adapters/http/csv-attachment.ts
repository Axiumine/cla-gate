// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyReply } from 'fastify';

/**
 * Marks the answer as a CSV download under `fileName`, which the caller builds from ids and a date only (E16-S03, E21-S05). A function of its
 * own, for the reason of `setNoStore`: the result of `header` is a thenable and is dropped on purpose.
 */
export function setAttachment(reply: FastifyReply, fileName: string): void {
  void reply.type('text/csv; charset=utf-8');
  void reply.header('content-disposition', `attachment; filename="${fileName}"`);
}
