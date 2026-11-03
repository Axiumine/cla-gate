completed failure

CLA signature required: 2 unlinked

### Email not linked to a GitHub account (2)

- commit `0000002`: authored as `Jane Doe` (email not linked to a GitHub account)
- commit `0000003`: committed as `Pat Committer` (email not linked to a GitHub account)

### How to fix

Read the email of a commit with `git log -1 --format=%ae <sha>`.

1. Add and verify the commit email at https://github.com/settings/emails.
2. Or set a linked address and rewrite the commits with `git config user.email "<linked email>"`, `git rebase <base> --exec 'git commit --amend --reset-author --no-edit'` and `git push --force-with-lease`.
3. Or ask a maintainer to record an exception for the listed commits (an exception never counts as a signature).

After fixing, comment `/recheck` or use Re-run. `/recheck` can be used once per minute.
