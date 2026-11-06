// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FlowWorld } from '../world/flow-world.ts';

// E18-S12: where the steps of e2e/flow.spec.ts go and what they write, shared by every group of steps.

/** The name and the wording of the CLA the maintainer writes. */
export const DOCUMENT_NAME = 'Our project CLA';
export const DOCUMENT_TEXT = '# Our agreement\n\nMade-up wording for the browser spec.';
/** The sentence of the document that the contributor must be able to read before signing. */
export const DOCUMENT_SENTENCE = 'Made-up wording for the browser spec.';

/** A path below the maintainer's tenant: `tenantPath(world, 'documents')`. */
export function tenantPath(world: FlowWorld, rest: string): string {
  return `/installations/${String(world.tenant.id)}/${rest}`;
}

/** A sentence of the catalog with its `{repository}` filled in with the repository of the world. */
export function forRepository(world: FlowWorld, sentence: string): string {
  return sentence.replace('{repository}', world.repository.name);
}
