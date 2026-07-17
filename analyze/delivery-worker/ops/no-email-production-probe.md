# No-email production probe

## Purpose

This operator check verifies only the public route's CORS and method guard. It cannot submit a report or trigger an email. Every live probe request is `OPTIONS` or `PATCH`. There is no `POST`, request body, report payload or email-provider call.

The probe is pinned to:

- endpoint: `https://submit.tokenoptimisationprotocol.org/`
- production origin: `https://tokenoptimisationprotocol.org`
- retired origin: `https://adamhartley7.github.io`
- unrelated test origin: `https://unrelated.example`

The live sequence is exactly four requests, in order:

1. `OPTIONS` with the production origin, expecting status `204` and the exact production `Access-Control-Allow-Origin` value.
2. `OPTIONS` with the retired GitHub origin, expecting status `403` and no `Access-Control-Allow-Origin` header.
3. `OPTIONS` with the unrelated origin, expecting status `403` and no `Access-Control-Allow-Origin` header.
4. `PATCH` with the production origin, expecting status `405` and the exact production `Access-Control-Allow-Origin` value.

The tool stops on the first mismatch. It never uses `POST`, never supplies a request body, never includes report data, and never reads a response body.

## Default safe check

From `analyze/delivery-worker`:

```powershell
node scripts/no-email-production-probe.mjs
```

This is a zero-network dry run. Confirm that the evidence summary says:

- `result` is `dry_run_only`
- `network_calls` is `0`
- `post_requests_made` is `false`
- `report_data_present` is `false`
- `email_submission_attempted` is `false`

## Live no-email probe

Run this only after the dashboard deployment record below has been completed manually:

```powershell
node scripts/no-email-production-probe.mjs --live --confirm RUN-FOUR-NO-EMAIL-PRODUCTION-PROBES
```

The exact confirmation is deliberate. There is no endpoint, method, origin, or request-body override.

Passing output is a content-free JSON evidence summary with `result: pass` and `network_calls: 4`. A failure returns non-zero, records only which public check failed, and stops without running later checks.

## Manual dashboard deployment record

Record public identifiers and configuration names only. Never paste secret values, API keys, recipient addresses, dashboard screenshots containing values, or copied environment contents into this file, a PR, an issue, or chat.

- Verification date and time (UTC): `____________________`
- Cloudflare deployment ID: `____________________`
- Deployed source commit SHA: `____________________`
- Approved Windows operator account from `whoami` (account name only, not an email): `____________________`
- Current `whoami` exactly matches the approved operator account before smoke dry run or live attempt: `yes / no`
- Architecture confirmed as Cloudflare Worker plus Resend only: `yes / no`
- No Cloudflare Email Service or `EMAIL` binding present: `yes / no`
- No dashboard plaintext recipient variables or committed recipient addresses present: `yes / no`
- Resend sending domain verified exactly as `send.tokenoptimisationprotocol.org`: `yes / no`
- Resend API key mode confirmed as `Sending access`: `yes / no`
- Resend API key restricted to `send.tokenoptimisationprotocol.org`: `yes / no`
- Resend Ireland dispatch limitation reviewed, account data, metadata, logs and API records remain in the United States: `yes / no`
- Custom domain route confirmed as `submit.tokenoptimisationprotocol.org`: `yes / no`
- Worker route configuration confirmed as custom domain: `yes / no`
- Required Worker secret name present, value not copied: `RESEND_API_KEY` (`yes / no`)
- Required Worker secret name present, value not copied: `RESEND_FROM` (`yes / no`)
- Required Worker secret name present, value not copied: `SUBMISSION_TO` (`yes / no`)
- Required Worker secret name present, value not copied: `SUBMISSION_CC` (`yes / no`)
- Exactly those four secret names are present for delivery, with no extra delivery-provider binding: `yes / no`
- Rate-limit binding name confirmed as `SUBMIT_RATE_LIMITER`: `yes / no`
- Rate-limit binding type and namespace confirmed in dashboard, values not copied: `yes / no`
- Operator initials: `____________________`

Stop if any item is unknown or does not match the reviewed deployment. Do not run the live probe as a substitute for recording the deployed source commit, deployment ID, bindings, route, Resend restriction or exact four secret names.

## Evidence limits

A passing probe proves only that four public HTTP guards responded with the expected status and CORS header behavior at that moment. It does not prove that:

- the email provider is configured;
- a report can be accepted;
- any mailbox received an email;
- retention or deletion was completed;
- the deployed Worker source matches a local branch unless the dashboard source commit was recorded separately.

Keep the evidence summary with the manual dashboard record. It contains no report, prompt, code, email address, or recipient data.
