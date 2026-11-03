# Legacy status coexistence

How to move a repository from another CLA tool to this platform without leaving two blocking `license/cla` entries on its pull requests. Read it before you enable a repository that another CLA tool already covers. The permissions and the check name are in [`github-app.md`](github-app.md); the story behind this page is E09-S09.

## The rule

- This App reports one Check Run named `license/cla` for every head commit of a pull request. The name is a constant and is never renamed, because a repository's required-check rule refers to it by name.
- A CLA tool that was in place before this platform may report a commit status (an older GitHub mechanism than checks) with the same context, `license/cla`. A check and a commit status with the same name must both pass.
- So the legacy tool must be disabled for a repository before the repository is enabled here. Enabling first leaves pull requests that wait for two entries of one name.

## Steps

1. Remove the legacy tool's webhook from the repository, or uninstall the legacy app for that repository.
2. Open a recent pull request: a new one, or a new commit on an open one, made after step 1. A status stays on the commit it was posted to, so only a commit made after step 1 shows what the legacy tool does now. Confirm that its statuses hold no `license/cla`:

   ```sh
   gh api repos/{owner}/{repo}/commits/{sha}/statuses
   ```

   `gh` fills `{owner}` and `{repo}` from the repository you are in; put the head commit of that pull request in place of `{sha}`. The answer must have no entry whose `context` is `license/cla`. Adding `--paginate --jq '.[].context'` prints the contexts and nothing else.
3. Enable the repository here.

## Branch protection

These facts come from [`github-app.md`](github-app.md) and matter when the repository's rule is changed to require the check.

- Pin the required check to this App (ruleset `integration_id`).
- The required check can be selected only if it has reported within the last 7 days. After step 3, open a test pull request, wait for `license/cla` to complete, and only then add it to the rule.
- GitHub counts `success`, `skipped` and `neutral` as passing for a required check. It does not count `cancelled`, `failure`, `timed_out` or `action_required`.
- This App writes four conclusions and no other:

| Conclusion | Counts as passing | When this App writes it |
|---|---|---|
| `success` | yes | every contributor of the pull request is covered |
| `failure` | no | a contributor is unsigned or unlinked, or the evaluation could not be completed (`/recheck` runs it again) |
| `neutral` | yes | a disabled repository: CLA enforcement is turned off for it |
| `cancelled` | no | a closed pull request whose check was still running |

`skipped`, `timed_out`, `action_required` and `stale` are never written.

## What the App does not do

- It does not detect a legacy status at runtime. That is on purpose: reading statuses needs the `Commit statuses: read` permission, which is not in the permission table of [`github-app.md`](github-app.md), and that file's rule is no permission without a recorded reason. The disabling in the steps above is the operator's job.
- It says nothing about how a ruleset treats two entries of the same name, beyond the one sentence of [`github-app.md`](github-app.md) that this page repeats: a check and a commit status with the same name must both pass.

## The pull request comment

- The comment is overwritten on every evaluation. A change that a person makes to it by hand is lost at the next one, so write a reply as a new comment instead of editing this one.
- A pull request that passes and never failed gets no comment: the Check Run is the signal. When a pull request that failed passes later, its existing comment is edited to say that all contributors have signed.
- `/recheck`, a line of its own in a comment on the pull request, runs the evaluation again and is limited to once a minute for each pull request. The Re-run and Re-run all checks buttons of GitHub also start a fresh run.
