// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { useSourceLink } from '../meta/meta.ts';

/** The licence of the platform, by its SPDX identifier: the name is not translated. */
const LICENCE = 'AGPL-3.0-only';

/** How many characters of the commit id the footer shows. */
const SHORT_COMMIT_LENGTH = 7;

/**
 * The footer of every page (E17-S09): "Source code" linking to the tree of the running commit (or to the repository while the
 * commit is not known), the first seven characters of the commit, and the licence. This is the offer of corresponding source
 * that AGPL section 13 asks every network user be given, for the version that is running. It renders without waiting for
 * `/api/meta` and without needing it, so the link never disappears; the shell and the root error boundary both render it.
 */
export function SourceFooter() {
  const t = useT();
  const { href, commit } = useSourceLink();
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-4 text-sm text-fg-muted">
        <span className="inline-flex items-center gap-2">
          <a href={href} rel="noopener noreferrer" className="underline underline-offset-2">
            {t('footer.sourceCode')}
          </a>
          {commit === null ? null : (
            <code className="rounded-md bg-surface-muted px-1.5 py-0.5 font-code text-fg">
              {commit.slice(0, SHORT_COMMIT_LENGTH)}
            </code>
          )}
        </span>
        <span>{t('footer.licence', { licence: LICENCE })}</span>
      </div>
    </footer>
  );
}
