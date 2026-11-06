// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// E18-S12: the texts of the seeded documents. Made-up wording for the screens to show; nothing here is an agreement, and no
// file of the product holds one (a maintainer brings their own text).

/** The first major of the document of the seeded tenant. */
export const TEXT_V1 = `# Individual Contributor Agreement

This is test text for the screens, version 1.

## Scope

1. The text only exists so that a page has something to show.
2. It is replaced by the maintainer's own wording.
`;

/** The minor change of the first major: one more sentence. */
export const TEXT_V1_1 = `# Individual Contributor Agreement

This is test text for the screens, version 1.1.

## Scope

1. The text only exists so that a page has something to show.
2. It is replaced by the maintainer's own wording.
3. A third item was added in a minor version.
`;

/** The second major: a new section, which is why everyone has to sign again. */
export const TEXT_V2 = `# Individual Contributor Agreement

This is test text for the screens, version 2. Company name: <company name>.

## Scope

1. The text only exists so that a page has something to show.
2. It is replaced by the maintainer's own wording.
3. A third item was added in a minor version.

## Employer

If your employer has rights in your work, you confirm that you have permission to contribute it.

See [the project site](https://example.test/project) for details.
`;

/** The text of the draft being written on top of the second major. */
export const TEXT_DRAFT = `${TEXT_V2}
## Draft section

A paragraph that is not published yet.
`;

/** The text of the document whose name is hostile. */
export const TEXT_SHORT = `# Short agreement

One paragraph of test text.
`;

/** The consent sentence the server returns for the sign page is its own; this is only the text of the other tenant's document. */
export const TEXT_OTHER = `# Private agreement of another tenant

This text must never appear on a page of the tenant the maintainer administers.
`;

/** A name that a screen must show as text and never run. */
export const HOSTILE_DOCUMENT_NAME = '<img src=x onerror=alert(1)> Hostile CLA';
