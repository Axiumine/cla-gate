completed failure

CLA signature required: 3 unsigned, 2 unlinked

[Sign the CLA](https://cla.example.test/sign/4242?pr=7)

### Not signed (3)

- `octocat` (GitHub id 1): opened the PR
- `hubot` (GitHub id 2): commit author
- `(unnamed)` (GitHub id 9): co-author

### Email not linked to a GitHub account (2)

- commit `0000002`: committed as `Pat Committer` (email not linked to a GitHub account)
- commit `0000003`: authored as `Jane Doe`, committed as `Jane Doe` (email not linked to a GitHub account)

### How to fix

Read the email of a commit with `git log -1 --format=%ae <sha>`.

1. Add and verify the commit email at https://github.com/settings/emails.
2. Or set a linked address and rewrite the commits with `git config user.email "<linked email>"`, `git rebase <base> --exec 'git commit --amend --reset-author --no-edit'` and `git push --force-with-lease`.
3. Or ask a maintainer to record an exception for the listed commits (an exception never counts as a signature).

After fixing, comment `/recheck` or use Re-run. `/recheck` can be used once per minute.

### Not blocking

These do not change the result.

- `Rob Roe`
