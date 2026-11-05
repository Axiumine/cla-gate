// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { ownSignaturesRoute } from '../../shared/own-signatures.ts';

// What the address of the "my signatures" screen holds (E18-S03): `/me/signatures?cursor=<opaque>`, the page the person is on, so
// a reload and the browser's Back land on the same page.

/**
 * `?cursor=` of the screen: a text of the length the endpoint takes (1 to 1024 characters), else nothing, so an empty value, a
 * number, a list or a text that is too long is dropped and the screen shows the first page. The cursor is opaque: it is kept and
 * handed back, never read. A text that has the right shape but is not one the server made is the endpoint's `400`, which the
 * screen answers with the first page too.
 */
export const mySignaturesSearchSchema = z.object({ cursor: ownSignaturesRoute.query.shape.cursor.catch(undefined) });
