# Privacy notes for operators

This is operational guidance for the people who run an instance. It is not legal advice. The operator decides, with counsel, the lawful basis for each kind of data, who is controller and who is processor (the operator, the maintainers of each org and GitHub may each be one, depending on how the instance is run), and how long data is kept. The numbers below are what the software does and enforces; they are not a recommendation that fits every jurisdiction.

The tables and commands in this document are checked against the code by `src/server/docs/privacy-inventory.test.ts` and its neighbours, so a column, a path or a default that changes fails a test until this page says the same. Where the text names a story (E13-S05, E14-S06), that part is not built yet and the page says what to do until it is. The schema is described in [`data-model.md`](data-model.md), the access rules in [`security.md`](security.md), the variables in [`configuration.md`](configuration.md).

## What the instance holds about a person

Every column that can hold a name, an email address, a login, an avatar, an address or a user agent is in this table. A column that sounds personal and is not (an organisation login, a repository name) is listed with its reason in the test, not here. Numeric GitHub ids are not in the table: they are the key of every signature and audit row and they stay after an erasure (see [What stays, and why](#what-stays-and-why)).

<!-- inventory:start -->
| Column | Purpose | Visible to | Retention | Erasable |
|---|---|---|---|---|
| `users.login` | Display snapshot of the GitHub login, refreshed at every login | The person; org admins, as the name of an actor in the audit log of their org | Until erased | Yes, replaced by `erased-<github id>` |
| `users.name` | Display snapshot of the profile name, refreshed at every login | The person | Until erased | Yes, set to null |
| `users.avatar_url` | Display snapshot of the avatar address, refreshed at every login | The person | Until erased | Yes, set to null |
| `signer_pii.name` | Name the signer gave when signing, kept as part of the evidence | Admins who may export the signatures of the document (CSV export); the person | Until erased | Yes, the row is deleted |
| `signer_pii.email` | Verified email the signer chose when signing | Admins who may export the signatures of the document (CSV export); the person | Until erased | Yes, the row is deleted |
| `signer_pii.login` | Login at the time of signing | Admins who may export the signatures of the document (CSV export); the person | Until erased | Yes, the row is deleted |
| `signer_pii.ip_address` | Address of the signing request, only when recording is switched on | The person, in their own export; nobody else through the application | 30 days by default, 90 at most | Yes, purged by the daily job or deleted with the row |
| `signer_pii.user_agent` | User agent of the signing request, only when recording is switched on | The person, in their own export; nobody else through the application | 30 days by default, 90 at most | Yes, purged by the daily job or deleted with the row |
| `allowlist_entries.login_snapshot` | Login of an allowlisted account, shown to the maintainers who manage the list | Maintainers who manage the allowlist of that org | Until erased | Yes, set to null for that org |
| `sessions.verified_emails` | Verified addresses GitHub reported at login, so the signer can pick one without a stored user token | The signed-in person | The life of the session | Yes, the session rows are deleted |
<!-- inventory:end -->

`signer_pii.ip_address` and `signer_pii.user_agent` are added by E13-S05 and `allowlist_entries.login_snapshot` by E14-S06. Until they exist the rows above describe what will be stored, nothing is recorded, and the erasure and the purge already look for the columns and handle them when they appear.

## What is never collected

- **User tokens.** The login exchanges the code for a GitHub user token, reads the identity and the verified emails, and asks GitHub to revoke the token at once. No user token is stored, in a column, a file or a log. The session row keeps the hash of its cookie id, never the id.
- **Request bodies.** No log line carries a body, a header, a query string or a client address: the request log is the method and the path. Webhook payloads are not stored either; `webhook_deliveries` keeps the delivery id, the event, the action and two times.
- **IP address and user agent**, unless the operator sets `RECORD_NETWORK_METADATA=true` (E13-S05; the default is false). Switching it on needs a documented legitimate interest and a short retention, which are the operator's to decide with counsel (GDPR Art. 5(1)(c) and 5(1)(e)). The retention is `NETWORK_METADATA_RETENTION_DAYS`: a whole number of days from 1 to 90, 30 when unset, enforced whether or not recording is still on, so switching recording off never strands old values. A daily job removes the two values from every row older than the limit and writes one `network_metadata.purged` audit row with the count. There is no setting that turns the limit off. The job handler is built, but the job is not registered with the job queue yet (E16-S05 is open), so keep recording off until it is.
- Addresses do live in memory for the rate limiter and the failed-signature throttle of the webhook route (the key is the client address, lost at a restart, never written). The proxy, load balancer and hosting in front of the instance have logs of their own; they are outside this software, and the operator answers for them.

## Retention

<!-- retention:start -->
| Data | Default | Limit | Setting |
|---|---|---|---|
| IP address and user agent in `signer_pii` | 30 days | 90 days | `NETWORK_METADATA_RETENTION_DAYS` |
| Session, idle lifetime | 8 hours | the absolute lifetime | `SESSION_IDLE_SECONDS` |
| Session, absolute lifetime | 7 days | none | `SESSION_ABSOLUTE_SECONDS` |
| Name, email and login in `signer_pii` | until erased | none | none |
| Signatures and CLA versions | indefinitely | none | none |
| Audit log | indefinitely | none | none |
<!-- retention:end -->

Signatures, CLA versions and audit rows are immutable (database triggers refuse `UPDATE` beyond the revocation columns, `DELETE` and `TRUNCATE`) and have no retention setting, because they are the evidence the product exists to keep. Sessions are removed at logout, at expiry and when the person's data is erased.

## Erasure runbook

Erasure removes the personal data one org holds for one person and leaves the signature core in place. The people who may run it are the org admins of the installation (for a `User` installation, the account owner); a repository admin gets `403`. The person asks the maintainers, who run it; there is no self-service erasure.

1. **Find the numeric GitHub id** of the person (`github_user_id` in the signature CSV export). Never use a login: it is a snapshot and can be reused by someone else.
2. **Preview:** `GET /api/installations/:installationId/erasure-preview?githubUserId=<id>`, where `:installationId` is `installations.id` of this instance and not GitHub's installation id. The answer is `{ githubUserId, signatures, signerPiiRows }`: counts only, no personal data. A person with no signature in this org is `404`.
3. **Execute:** `POST /api/installations/:installationId/erasures` with `{ "githubUserId": <id>, "expectedRows": <signerPiiRows from the preview> }` and the `x-csrf-token` header of the session. The answer is `200 { "erasedRows": n }`. If the live count differs from `expectedRows` the answer is `409 count_changed` and nothing changes: run the preview again.
4. **What it did:** deleted the person's `signer_pii` rows of this org only; set `allowlist_entries.login_snapshot` to null for their entries in this org; and, only when no `signer_pii` row of the person is left in any org, replaced `users.login` by `erased-<id>`, cleared `users.name` and `users.avatar_url`, and deleted their sessions. One audit row `signer_pii.erased` records the org, the acting admin, the person's id and the number of rows, and nothing else. The log line `signer_erasure_done` has the same numbers and no name or email.
5. **Check:** the signature CSV export shows the person's signatures with `pii_erased` true and empty `login`, `name` and `email`.

If the maintainers of an org are gone, the operator can call the function with the owner database role: `select erase_signer_pii(<github id>, <acting github id>, <installations.id>)`. The acting id is the caller's attribution and the database cannot verify it; use your own numeric id. The function is the only way to remove or change a `signer_pii` row, because the runtime role has no `delete` or `update` on the table.

Erasing again is harmless (0 rows, one more audit row). The person can sign again later, which stores a fresh `signer_pii` row.

### What stays, and why

The signature core is kept as evidence for legal claims (GDPR Art. 17(3)(e)): the numeric GitHub id, the CLA version and its text hash, the consent text id, the signer type, the time and source of the signing, and the revocation columns. The audit rows stay too. Their numeric ids still point to a GitHub account that is public on GitHub; whether that is personal data after an erasure, and for how long it may be kept, is for counsel.

Erasure is not revocation and not a ban. The signatures stay valid and keep covering the person. To end the coverage the maintainers revoke the signature (E15); a revocation applies to future pull requests only, takes a reason from a fixed code set and never free text, and cannot be scrubbed because the row is immutable. Erasure does not reach copies outside the instance: pull request comments and check runs on GitHub are GitHub's data.

## Answering an access request

The person signs in with GitHub and downloads their own data from `GET /api/me/export`. The file is JSON, named `cla-data-<github id>.json`, and covers every org of the instance: the profile snapshot, each signature with its personal data (`personalData` is null where it was erased), the allowlist entries for their id, and up to 1,000 audit entries about them, newest first, with `truncated: true` when more exist. It holds no other person's id. It is limited to 5 requests an hour per person, and every download is recorded as `data_export.created`. There is no operator-side version of the export: the subject is always the signed-in person, so an operator who must answer someone who cannot sign in has to do so with a query by numeric id, with counsel's advice on identity checks.

## The audit log

The audit log is append-only: triggers block `UPDATE`, `DELETE` and `TRUNCATE`, and the runtime role does not own the table. A row holds numeric ids, an action name from a closed list and a metadata object whose keys come from a fixed list and whose values are numbers, booleans and short codes (a database check refuses anything else). It never holds a name, an email, a login or an address, so erasure has nothing to scrub in it, and nothing purges it. Org admins read the rows of their own org through `GET /api/installations/:installationId/audit-log`; rows that belong to the whole instance (`data_export.created`, `network_metadata.purged`) are read only with the owner database role.

## Backups

- Erased data survives in backups until they expire. Erasure changes the live database and nothing else.
- Restoring a backup taken before an erasure brings the personal data back: the `signer_pii` rows, the `users` snapshot and the sessions. The audit row of the erasure is gone with the restore as well.
- Keep a list of erased people outside the database and outside the backups, **numeric ids only and no other data**: for each erasure, the GitHub id of the person and the `installations.id` of the org. After any restore, run the erasure again for every entry on the list (preview, then execute).
- The one free-text field a maintainer writes is the `reason` of a commit override. It is not covered by erasure, so it must not contain personal data; tell maintainers so wherever they write it. Revocation reasons are a fixed code set and cannot hold any.

## Several orgs on one instance

- Erasure is per installation: an org admin removes what their org holds and cannot reach another org's data or evidence. The `users` snapshot of the person is scrubbed only when no org holds personal data for them any longer.
- Each org's maintainers see only their own audit log, their own signatures and their own exports. A request for another org's data gets the same `404` as an unknown id.
- The network metadata retention is one instance-wide setting, not one per org.
- The instance operator with database access can see everything: signatures, `signer_pii`, sessions and every audit row. The application never shows one org's data to another, but the database does not know about orgs. Tell the maintainers of each org who has that access (the owner role, the runtime role `DATABASE_URL`, and every backup), and keep the list short.
