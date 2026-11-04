# Data protection for the operator

This guide is written for the person or organisation that runs the server and so decides why and how the contributors' personal data is processed: in data-protection terms, the controller (or one of several, if you run it for others). It says what the software stores, what it enforces, and what only you can do. **It is not legal advice.** The lawful basis for each kind of data, who is controller and who is processor, the content of your privacy notice, how long you keep what, and what you owe people who ask, are decisions for you and your counsel. The numbers below are what the software does; they are not a recommendation that fits every jurisdiction.

The column-by-column inventory, the full erasure runbook and the access-request procedure are in [`../privacy.md`](../privacy.md). Tests keep that page equal to the schema, so this guide points to it and does not repeat the inventory.

## What is stored

| Where | What | Who can read it | How long |
|---|---|---|---|
| `signatures` (the signature core) | The numeric GitHub id of the signer, the CLA version and the hash of its text, the consent text, when and from which repository and pull request it was signed, and a revocation if one happened | Maintainers of the organisation, through the dashboard and the CSV export | Indefinitely: it is the evidence. Rows cannot be updated (beyond revocation) or deleted |
| `signer_pii` | The name, verified email and login the person gave when signing | Administrators who export the signatures; the person | Until erased |
| `users` | The login, name and avatar address GitHub reported at the last sign-in: display snapshots | The person; administrators see the login of an actor in their audit log | Until erased |
| `sessions` | A hash of the session cookie, expiry times and the verified addresses GitHub reported at sign-in | The signed-in person | The life of the session |
| `audit_log` | Numeric ids, a closed set of action names and short codes. It never holds a name, an email, a login or an address | Administrators of the organisation | Indefinitely |

Nothing else about a person is stored. In particular the platform never stores a GitHub token of a user (the sign-in uses one once, and asks GitHub to revoke it), never logs a request body, a header or a client address, and keeps no copy of a webhook payload.

The identity of a signer is the numeric GitHub id. That is deliberate: a login or an email is a display snapshot that can change hands, so nothing is decided on one.

## What the software enforces

The numbers here are checked against the code by a test, so a default that changes fails the build until this page says the same.

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

**Network metadata is off by default.** The IP address and the user agent of a signing request are stored only when you switch the recording on. The switch (`RECORD_NETWORK_METADATA`) arrives with the signing feature (E13-S05) and the application does not accept it before; until then nothing records an address. Switching it on needs a legitimate interest that you document, and a short retention (`NETWORK_METADATA_RETENTION_DAYS`, 1 to 90 days, 30 by default), which a daily job enforces whether or not recording is still on. A job that removes the values is built, but it is not yet scheduled (E16-S05 is open): keep recording off until it is. Addresses do exist in the memory of the server for the rate limit, are never written, and are lost at a restart.

**What is outside the software.** The proxy in front of the server, your hosting provider, your backups and anything that collects logs hold data of their own, and you answer for them. The bundled Caddy keeps no access log. nginx logs the address and the path of every request unless you configure `access_log off;` for this site or rotate the log quickly; a load balancer or CDN has its own. Record these in your notice.

## The privacy notice you must provide

People whose data the platform handles never deal with you directly: they open a pull request, follow a link and sign. The platform does not show them a notice of yours (the CLA text is the maintainers'), so you provide one and tell the maintainers of each organisation where it is, so that their CLA or their contribution guide links to it. A notice has to cover at least the following; this is a checklist for your counsel, not a template.

- Who you are and how to reach you (and a data-protection officer, if you have one).
- What you process and why: signing a CLA and proving it later; checking pull requests; signing in.
- The lawful basis you rely on for each purpose. That is your decision with counsel. The software's answer to the retention question is the table above.
- The categories of data (the numeric GitHub id, login, name, verified email, optionally the address and user agent) and where they come from (the person, and GitHub).
- Who receives it: the maintainers of the organisation the person signed for, GitHub as the platform the App runs on, and your hosting provider and any backup storage.
- Where it is processed and whether it leaves your jurisdiction (GitHub's and your host's locations).
- How long each kind is kept: the table above, plus your backup retention (below).
- The person's rights and how to use them: the access request is a download from the platform (`GET /api/me/export` after signing in); erasure is requested from the maintainers, who run it; and the right to complain to a supervisory authority.
- That the signature itself (the numeric id, the version, the time) is kept as evidence after erasure, and the reason.

## Erasure

The people who may erase are the administrators of the organisation (for a personal account, its owner). The person asks the maintainers; there is no self-service. The steps are in [`../privacy.md`](../privacy.md#erasure-runbook): find the numeric GitHub id, preview with `GET /api/installations/:installationId/erasure-preview?githubUserId=<id>`, then `POST /api/installations/:installationId/erasures` with the id and the number of rows the preview gave. Erasure deletes the person's `signer_pii` rows for that organisation, and, only when no organisation holds personal data of them any more, replaces the login in `users` by `erased-<id>` and clears the name, the avatar address and the sessions. One audit row records it, with numbers only.

If the maintainers of an organisation are gone, you can run the same function as the database owner:

```sh
docker compose exec -T postgres psql -U cla_owner -d cla -c "select erase_signer_pii(<github id>, <acting github id>, <installations.id>)"
```

The second argument is the numeric id of the person acting, your own; the database cannot check it. The function is the only way to remove a `signer_pii` row: the runtime role has no `delete` or `update` on the table.

**Keep a list of erasures outside the database and outside the backups.** For each, write down the numeric GitHub id of the person and the `installations.id` of the organisation, and nothing else. You need the list in the next section.

What stays after an erasure, and why (the signature core as evidence, the audit rows, copies on GitHub), is in [`../privacy.md`](../privacy.md#what-stays-and-why). Erasure is not revocation and not a ban.

## Backups hold erased data

Erasure changes the live database and nothing else. Every dump and every archived write-ahead log taken before it still holds the person's name and email, and will until it is deleted. So:

- **Bound how long you keep backups, and write the period down.** The daily script in [backup-restore.md](backup-restore.md) keeps 14 days as an example; choose your own and state it in the notice. A person who asked for erasure then has their data gone from the backups within that period.
- **Treat a backup as the personal data it is.** Encrypt it, keep it off the server in a place with restricted access, and delete the expired ones for good.
- **Re-apply the erasures after any restore.** A restore brings back everything that was in the dump, including data you erased since, and loses the audit row of the erasure.

### After a restore

Before the restored platform serves anybody, go through your list of erasures and run each one again: the preview, then the execution (or the function above). Erasing a person who has nothing left is harmless: it reports 0 rows and writes one more audit row. A restore that is only a rehearsal on a scratch machine holds the same data as the backup: delete that machine's volumes when you are done.

## Who can see everything

The application never shows one organisation's data to another, but the database does not know about organisations. Whoever has the owner role (`cla_owner`), the runtime role (`cla_app`), a backup, or access to Docker on the server can read every signature, every `signer_pii` row and every audit row of every organisation. In this stack, a user who may run `docker compose exec` on the server reads the database without a password: the container's local socket trusts its users. Keep that list short, put it in your notice, and tell the maintainers of each organisation who is on it.

Organisations decide what they do with the exports they download; the platform cannot reach them.

## When you stop

Removing the platform does not remove your duties for the backups and exports that remain: [uninstall.md](uninstall.md) lists what to export first and what to delete.
