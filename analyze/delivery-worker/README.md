# TOP analyzer delivery Worker

This is a review-ready Cloudflare Worker for explicit submission of `top.research-safe-usage.v1` and `top.research-safe-usage.v2` reports. It is not deployed by this repository change. `wrangler.jsonc` is the source of truth for the custom domain `submit.tokenoptimisationprotocol.org`; `workers_dev` and preview URLs are disabled. The analyzer integration remains dormant: its endpoint is blank and CSP remains `connect-src 'none'`. Delivery stays fail closed until the Worker, its custom domain, secrets and rate-limit binding are verified, followed by a separate frontend activation review.

The research-safe v1 and v2 top-level schemas remain unchanged. V2 is the exact v1 top-level object plus `timeline`, `session_distributions` and `workflow_shape`. It accepts only the vetted v2 local collector and parser versions for Claude Code or Codex safe-usage exports. Value-model member acceptance is intentionally narrowed during the transition described below.

## Value-model transition contract

The Worker accepts the legacy `top.value-model.v0.1-illustrative` version only as the exact three-field `not_available` object that the dormant transition flow can still produce. It rejects all legacy illustrative scenario outputs. It accepts `top.value-model.v0.2-self-reported` only as exact `not_provided` or reconciled `self_reported_unverified` shapes. V0.2 `not_available` is rejected so legacy and self-reported states cannot be mixed. V0.2 accepts finite zero values, preserves a zero net result as `0`, requires a null ratio only when analyzed AI cost is zero, and never combines non-USD self-reported value with USD AI cost.

This Worker is not compatible with the PR9 frontend by itself because that frontend can still produce eligible v0.1 `illustrative_unvalidated` reports. Raw PR11 can also emit v0.2 `not_available`, which this locked backend contract correctly rejects. Keep PR9 and PR11 dormant until this Worker is deployed and verified. The combined frontend integration must normalize every v0.2 status-only result to exact `not_provided` with reason `user_did_not_enter_both_value_inputs`, or emit a reconciled `self_reported_unverified` object. Then ship the PR9 activation and normalized PR11 frontend together in one newly reviewed integration release. Do not merge or publish either raw branch alone against this Worker.

## Safety boundary

- It accepts requests only from the live custom-domain frontend at `https://tokenoptimisationprotocol.org`. The GitHub Pages origin and every unrelated origin fail closed.
- It accepts JSON only and stops reading after 256 KiB.
- The client submits a strict consent envelope containing one exact research-safe report. Unknown fields, client-supplied recipients, private-content fields, unsupported labels and unreconciled totals fail closed.
- Recipients, sender and the Resend API key come only from four interactive Worker secrets: `RESEND_API_KEY`, `RESEND_FROM`, `SUBMISSION_TO` and `SUBMISSION_CC`. They are not accepted from the browser. The sender secret must use the verified `send.tokenoptimisationprotocol.org` subdomain. `wrangler.jsonc` intentionally does not declare `secrets.required`, because Wrangler 4.111 dry runs ignore that unsupported top-level key. The README and operator record are the source of truth for the required secret names. Only the Cloudflare dashboard can verify their remote presence.
- The API key must be a Resend `sending_access` key restricted to the verified sender domain.
- The same submission UUID is passed to Resend as an idempotency key.
- Every Resend request includes the stable non-secret `User-Agent: TOP-Analyzer-Delivery/1.0` header. This avoids provider-side bot filtering without exposing a secret.
- The Worker does not log, persist or place the report in KV, D1 or R2. The validated report is attached to one email; the message body contains only a readable aggregate summary.
- Both email bodies include the UTC delivery-request date and an explicit deletion due date 30 calendar days later. They instruct recipients to delete the email and attachment by that date, or sooner after an early deletion request to Adam.
- For v2, the email also contains a concise monthly timeline and structural session-shape summary. The attached JSON remains the exact validated report.
- `report.privacy.network_delivery` records the analyzer's local state when it generated the report. A later email can occur only through the separate explicit-submission consent envelope.
- A successful POST requires exact HTTP `202` from the Worker and a nonempty safe Resend `provider_message_id`. That ID records provider acceptance only. It does not prove mailbox delivery.

The deletion date is an operational instruction, not technical deletion enforcement. The Worker keeps no report store and cannot remove copies from recipient mailboxes or processor systems. The private retention log separately records Adam's mailbox deletion, Sam's mailbox deletion, and early-deletion request and completion evidence. The 30-day procedure applies only to each recipient mailbox's report email and attachment. It does not cover Resend account data, message metadata, logs or API records. This documentation does not claim legal compliance.

Selecting Resend's Ireland region controls routing and sending only. Resend states that account data, email metadata, logs and API records remain stored in the United States regardless of the sending region.

## Exact v2 additions

The frontend must preserve these collector field names. The Worker maps their aggregate totals to the existing research-safe names such as `cache_write_tokens`, `cache_read_tokens` and `reasoning_tokens` during reconciliation.

```text
timeline: {
  status: "available",
  granularity: "calendar_month",
  timestamp_basis: "source_date_prefix_not_timezone_normalized",
  periods: [{
    period,
    input_tokens,
    cache_write_input_tokens,
    cache_read_input_tokens,
    output_tokens,
    reasoning_output_tokens,
    usage_records,
    total_tokens,
    active_days,
    logical_sessions_started
  }]
}

session_distributions: {
  status: "available",
  session_definition,
  thresholds_version: "top.session-buckets.v1",
  elapsed_time_basis: "wall_clock_span_between_first_and_last_supported_usage_record",
  logical_sessions_analyzed,
  usage_records_per_session: {
    zero, one, two_to_four, five_to_nineteen, twenty_plus
  },
  total_tokens_per_session: {
    under_10k, ten_to_49k, fifty_to_199k,
    two_hundred_to_999k, one_million_plus
  },
  elapsed_time_per_session: {
    under_10m, ten_to_59m, one_to_3h,
    four_to_11h, twelve_h_plus, unknown
  }
}

workflow_shape: {
  status: "available",
  algorithm_version: "top.workflow-shape.v1",
  basis: "deduplicated_usage_record_count_only",
  sessions: {
    single_exchange, short_multi_exchange,
    sustained, high_iteration, unclassified
  }
}
```

`session_definition` is `deduplicated_logical_session` for Claude Code and `codex_rollout_file_proxy` for Codex. V2 does not accept semantic prompt categories, prompt text, code, paths or original identifiers.

## Tests

No package install is needed for the test suite:

```powershell
node --test test/*.test.mjs
```

Tests cover strict v1 preservation, v2 exact keys and enums, calendar ordering, cardinality, bucket ranges, cross-section reconciliation, fixed server-side recipients, idempotency, CORS, the 256 KiB limit, JSON-only input, HTML escaping and synthetic 400, 409, 413, 429 and upstream-500 failures.

## Morning production-smoke gate

The smoke tool contains no secret, recipient address or personal report content. Its report is a fixed synthetic `top.research-safe-usage.v1` shape that the same Worker validator checks. The endpoint and Origin are constants, not command-line options:

```text
endpoint: https://submit.tokenoptimisationprotocol.org/
Origin:   https://tokenoptimisationprotocol.org
```

Default execution is a dry run. It validates and hashes the synthetic report, prints a client submission UUID preview and makes zero network calls:

```powershell
Set-Location C:\path\to\adamhartley7.github.io\analyze\delivery-worker
npm run smoke:production
```

A live synthetic request is deliberately awkward. It requires `--live`, two different exact confirmation phrases and a new absolute retention-log path outside the repository. The parent folder must already exist. The tool reserves the private log and an operator-account-wide consumed-attempt guard before its single request. The guard defaults to `%USERPROFILE%\.top-production-smoke-attempt.json`, so it covers only the current Windows operator account, not the whole machine. The manual deployment record must name the one approved Windows operator account, and `whoami` must match it before the dry run or live attempt. Do not run the smoke from another Windows account. If the guard exists, every later invocation under that approved account makes zero POST requests, even if given a new retention-log path. Never delete or bypass the guard to retry an unknown, rejected or malformed outcome.

```powershell
npm run smoke:production -- `
  --live `
  --confirm-synthetic SYNTHETIC-REPORT-ONLY `
  --confirm-send SEND-ONE-PRODUCTION-SMOKE `
  --retention-log "C:\private\top-smoke-retention-YYYY-MM-DD.json"
```

The committed [`scripts/retention-log.template.json`](scripts/retention-log.template.json) documents the private record shape. The live tool materializes it with the synthetic report hash and dates. Keep the actual log outside Git, OneDrive-shared folders and this repository. Its `receipt_id` is the client submission UUID used for idempotency. It is never proof that Resend delivered a message. Exact acceptance requires HTTP `202` plus a nonempty Resend `provider_message_id`, which the tool records. Even then, `provider_delivery_confirmed` remains `false` and both received-attachment hashes remain pending.

A timeout or other transport failure is recorded as `delivery_outcome_unknown`, because the server may already have processed the request. The operator-account guard remains consumed. Do not retry. A non-202 response, malformed 202, missing provider ID, or post-response local logging failure also consumes the single attempt and requires stopping for a new reviewed plan.

After the two approved recipients save their received JSON attachments locally, compare both files with the expected hash without granting this tool mailbox access:

```powershell
npm run verify:attachments -- `
  --retention-log "C:\private\top-smoke-retention-YYYY-MM-DD.json" `
  --attachment "C:\Downloads\received-copy-1.json" `
  --attachment "C:\Downloads\received-copy-2.json"
```

The helper reads only the three explicit local paths. It hashes the exact received attachment bytes, makes zero network calls, stores Adam's and Sam's observed SHA-256 values in the private log, and fails unless both equal `report_sha256`. Verification is one-shot. Its first result is terminal: a match cannot be repeated, and a mismatch can never be replaced by a later match. A mismatch requires stopping and preserving the evidence.

After mailbox deletion or an early-deletion event, update the same private record without mailbox access or network calls:

```powershell
npm run record:retention -- `
  --retention-log "C:\private\top-smoke-retention-YYYY-MM-DD.json" `
  --event adam-mailbox-deleted `
  --at "2026-08-16T09:00:00.000Z" `
  --evidence-reference "adam-mailbox-delete-2026-08-16"
```

Supported events are `adam-mailbox-deleted`, `sam-mailbox-deleted`, `early-deletion-requested` and `early-deletion-completed`. Early-deletion completion requires both recipient mailbox deletions to have been recorded first. Evidence references are short opaque labels only, never addresses, paths or report contents.

### Separate real-submission retention register

The synthetic smoke log is never reused for real reports. Before Adam's real submission, prepare a private path outside Git, this repository and shared OneDrive folders for the separate [`scripts/real-submission-retention-register.template.json`](scripts/real-submission-retention-register.template.json) contract. Immediately after each real submission receives exact HTTP `202` and a nonempty `provider_message_id`, create one entry using only the safe client receipt UUID, provider message ID, report hash and request timestamp:

```powershell
npm run record:real-retention -- `
  --register "C:\private\top-real-submission-retention.json" `
  --event accepted `
  --receipt-id "<client-submission-uuid>" `
  --provider-message-id "<resend-provider-message-id>" `
  --report-sha256 "<64-character-lowercase-sha256>" `
  --request-at "2026-07-17T09:00:00.000Z"
```

The register supports many real submissions. Each entry stores only the safe receipt ID, provider ID, report hash, request and deletion dates, Adam and Sam mailbox-deletion status and timestamps, and early-deletion status and timestamps. It never stores report content or addresses. The tool makes no network request and never accesses a mailbox. Use the same event names as the synthetic retention recorder to update deletion evidence for one `--receipt-id`.

Before any pilot, verify Adam's entry exists and the whole register remains valid:

```powershell
npm run record:real-retention -- `
  --register "C:\private\top-real-submission-retention.json" `
  --event verify-entry `
  --receipt-id "<client-submission-uuid>"
```

Creating and verifying the real-submission register entry are hard gates. An accepted real report is not operationally complete until its entry exists. The four-person pilot cannot start if Adam's entry is absent or invalid.

## Exact release order

Do not reorder or combine these gates:

1. **Human approvals and named responsibility.** Document the data controller, deletion contact, purposes, lawful basis, 30-day report-email procedure, early-deletion procedure and abuse-control decision. Sam must explicitly accept responsibility for receiving, protecting and deleting his report-email copies before `SUBMISSION_CC` is configured.
2. **Resend domain and key.** Verify only `send.tokenoptimisationprotocol.org` for sending. Create a Resend API key in `Sending access` mode, restricted to that verified domain. The Ireland dispatch region affects sending route only. It does not relocate Resend account data, email metadata, logs or API records from the United States.
3. **Cloudflare secrets and bindings.** Set exactly four secrets interactively: `RESEND_API_KEY`, `RESEND_FROM`, `SUBMISSION_TO` and `SUBMISSION_CC`. Confirm `RESEND_FROM` is a mailbox on `send.tokenoptimisationprotocol.org`, both recipient secrets each contain one approved address, `SUBMIT_RATE_LIMITER` is present with the reviewed namespace, and the only public route is the custom domain `submit.tokenoptimisationprotocol.org`. There must be no `EMAIL` binding, Cloudflare Email Service binding, committed recipient variable, Workers.dev URL or preview URL.
4. **Dormant Worker deployment.** Deploy the reviewed Worker while the frontend endpoint remains blank and CSP remains `connect-src 'none'`. Record the exact source commit SHA and Cloudflare deployment ID in the manual deployment attestation. An unknown or mismatched identifier is an abort.
5. **PR19 no-email probes.** Run the committed four-request no-email probe. It uses only `OPTIONS` and `PATCH`, never `POST`, never a body and never provider delivery. Stop unless all four status and CORS checks match exactly.
6. **Zero-network dry run.** Run `npm run smoke:production` without live flags. Confirm the pinned endpoint, Origin, synthetic v0.2 `not_provided` value shape, hash and `Network calls: 0`.
7. **Exactly one synthetic attempt.** Confirm `whoami` exactly matches the approved Windows operator account in the deployment record. With the private retention path prepared, run the live smoke once. The operator-account-wide guard is consumed before the request. A timeout, non-202, malformed 202, missing provider ID, or local-record failure is a hard stop with no retry. Do not switch Windows accounts to bypass it.
8. **Provider acceptance and two mailbox receipts.** Require exact Worker HTTP `202`, `accepted_status: "accepted_for_delivery"`, a nonempty safe Resend `provider_message_id`, and receipt of the email in both approved inboxes. Provider acceptance is not mailbox delivery proof.
9. **Exact-byte attachment verification.** Save Adam's and Sam's received JSON attachments as two distinct local files. Run `verify:attachments` and require both exact byte hashes to equal `report_sha256`. Record both observed hashes in the private retention log. Any mismatch is an abort.
10. **Combined normalized frontend release only.** Only after steps 1 to 9 pass, create one newly reviewed integration release containing both the PR9 endpoint and CSP activation and the PR11 v0.2 self-reported frontend. Add and test the hard normalization gate: raw PR11 v0.2 `not_available` must become exact `not_provided` with reason `user_did_not_enter_both_value_inputs`, while completed inputs must produce reconciled `self_reported_unverified`. Never publish either raw branch alone. Keep `form-action 'none'` and allow only the one reviewed Worker origin.
11. **Pages verification.** Verify the exact deployed Pages source, active endpoint, CSP, consent display, recipient labels and truthful receipt states. On any mismatch, revert the endpoint to blank and CSP to `connect-src 'none'`.
12. **Adam's one real report and immediate register entry.** Adam reviews the exact research-safe payload and deliberately submits it through the analyzer consent flow. Do not use the smoke tool as a substitute. Immediately after exact HTTP `202` with a nonempty provider message ID, create Adam's privacy-safe real-submission retention entry. Stop if the entry cannot be created and validated.
13. **Four-person uncoached pilot.** First run `verify-entry` for Adam's real receipt and require a valid register. Only then test with Adam, Sam, Fionn and Cullen without coaching. Create one separate register entry immediately after each accepted pilot submission. Record friction and failures. Do not expand outreach until all four can complete the flow, understand what is and is not shared, and have valid retention entries.

### Abort and rollback rules

- Before frontend activation, any unknown or failed gate leaves the frontend dormant.
- Once the approved operator account's smoke guard exists, never delete, rename, switch accounts or otherwise bypass it to retry. Unknown means consumed.
- If a Worker deployment or no-email probe differs from the reviewed commit, stop and restore the last known dormant Worker deployment.
- If either mailbox copy is absent or either exact-byte hash differs, do not activate the frontend.
- If frontend deployment verification fails, restore a blank endpoint and `connect-src 'none'` before further testing.
- If an accepted real or pilot submission lacks a valid privacy-safe retention entry, stop the pilot and do not solicit another submission.
- A Resend provider ID, client receipt UUID, HTTP 202 or matching attachment hash must never be described as proof of mailbox delivery by itself.

The smoke, no-email probe, attachment-hash and retention-event tools do not deploy the Worker, change a dashboard, read a credential, discover a recipient, open a mailbox or activate the frontend endpoint.

Once approved, set secrets interactively. Never put their values in this repository or command history:

```powershell
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put RESEND_FROM
npx wrangler secret put SUBMISSION_TO
npx wrangler secret put SUBMISSION_CC
```

`SUBMISSION_TO` and `SUBMISSION_CC` are both required for the approved Adam-and-Sam delivery. Each secret must contain exactly one address. The Worker fails closed if either is absent or contains a list, and it never returns recipient addresses to the browser.

`RESEND_FROM` must be a display name plus a mailbox on the verified subdomain, for example `TOP Analyzer <reports@send.tokenoptimisationprotocol.org>`. Keep the exact value in the Worker secret rather than frontend code.

## Deliberately absent

- No real credentials or recipient addresses.
- No active frontend endpoint or permissive network CSP. The future single allowed connection origin is documented but not enabled in this scaffold release.
- No deployment has been performed. The reviewed production custom-domain route is declared in `wrangler.jsonc`.
- No database, webhook or claim of final email delivery.
- No automatic collection on file selection, parsing or report display.
