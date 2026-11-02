# Operations

What an operator must keep in mind. Configuration variables are in [`configuration.md`](configuration.md); the CI runner policy is in [`ci-runners.md`](ci-runners.md).

- **Private key rotation**: the App supports multiple private keys; generate the new key and deploy it before deleting the old one.
- **Backups**: signatures are legal evidence. Daily backups plus point-in-time recovery, with a periodically tested restore.
- **Poison jobs**: bounded pg-boss `retryLimit` and a dead-letter queue whose handler sets the Check Run to `failure` with a `/recheck` hint, so a check is never stuck `in_progress`.
- **GitHub rate budget**: cache installation tokens and org membership; Octokit throttling honours `retry-after`.
