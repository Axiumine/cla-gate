// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// E09-S09: sentences that more than one screen shows, kept here so the wording cannot drift between them. The web
// application shows these sentences, so this file holds constants only and reads nothing from the file system.

/**
 * What the repository enablement screen tells an operator whose repository another CLA tool already covers (E14 builds the
 * screen, E18 the page around it): one sentence, ending with the path of the document that has the steps. It does not spell the
 * check name, which `CHECK_RUN_NAME` owns. The document is `docs/legacy-status-coexistence.md`; a test (`legacy-status-doc.test.ts`)
 * fails when the path named here is not a file. Nothing imports it yet, so `knip.json` lists the file as an entry.
 */
export const LEGACY_STATUS_NOTICE =
  'Disable any other CLA tool for this repository before you enable it here, because its commit status and our check share a name and must both pass (docs/legacy-status-coexistence.md).';
