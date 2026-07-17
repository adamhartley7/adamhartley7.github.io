# TOP analyzer delivery Worker

This is a review-ready Cloudflare Worker for explicit submission of `top.research-safe-usage.v1` and `top.research-safe-usage.v2` reports. It is not deployed by this repository change. `wrangler.jsonc` is the source of truth for the custom domain `submit.tokenoptimisationprotocol.org`; `workers_dev` and preview URLs are disabled. The analyzer integration remains dormant: its endpoint is blank and CSP remains `connect-src 'none'`. Delivery stays fail closed until the Worker, its custom domain, bindings and rate-limit namespace are verified, followed by a separate frontend activation review.

Email delivery is Cloudflare native by default: the Worker sends through the Email Service `send_email` binding (`EMAIL`) using the structured `send()` API, from the fixed sender `reports@tokenoptimisationprotocol.org`, to the two approved recipients configured as non-secret vars. No external email account or API key is required on this path, and sends to verified destination addresses are free on every Workers plan. The earlier Resend integration remains in the code as an explicit fallback: it is used only when `DELIVERY_PROVIDER` is set to `resend`, or when the flag is unset and a `RESEND_API_KEY` secret is present. With no flag and no Resend key, the Worker always uses the Cloudflare binding. An unrecognized `DELIVERY_PROVIDER` value fails closed.

V1 remains unchanged. V2 is the exact v1 top-level object plus `timeline`, `session_distributions` and `workflow_shape`. It accepts only the vetted v2 local collector and parser versions for Claude Code or Codex safe-usage exports.

## Safety boundary

- It accepts requests only from the live custom-domain frontend at `https://tokenoptimisationprotocol.org`. The GitHub Pages origin and every unrelated origin fail closed.
- It accepts JSON only and stops reading after 256 KiB.
- The client submits a strict consent envelope containing one exact research-safe report. Unknown fields, client-supplied recipients, private-content fields, unsupported labels and unreconciled totals fail closed.
- Recipients and sender are fixed server-side and are never accepted from the browser. On the Cloudflare path, `SUBMISSION_TO` and `SUBMISSION_CC` are non-secret vars in `wrangler.jsonc`, each holding exactly one address, and the `send_email` binding's `allowed_destination_addresses` allowlist enforces the same two addresses at the platform layer. The sender is the constant `reports@tokenoptimisationprotocol.org`.
- On the Resend fallback path, recipients, sender and the API key come only from Worker secrets. The sender secret must use the verified `send.tokenoptimisationprotocol.org` subdomain, and the API key must be a Resend `sending_access` key restricted to that domain.
- The submission UUID is passed to Resend as a provider idempotency key. The Cloudflare binding has no provider-side idempotency mechanism, so on that path the same UUID is stamped into the message as the `X-TOP-Idempotency-Key` header and the subject line, making duplicates identifiable in the mailbox. The Worker rate limiter and the analyzer's one-click consent flow bound duplicate submissions; the 409 `idempotency_conflict` response can occur only on the Resend path.
- The Worker does not log, persist or place the report in KV, D1 or R2. The validated report is attached to one email; the message body contains only a readable aggregate summary.
- Both email bodies include the UTC delivery-request date and an explicit deletion due date 30 calendar days later. They instruct recipients to delete the email and attachment by that date, or sooner after an early deletion request to Adam.
- For v2, the email also contains a concise monthly timeline and structural session-shape summary. The attached JSON remains the exact validated report.
- `report.privacy.network_delivery` records the analyzer's local state when it generated the report. A later email can occur only through the separate explicit-submission consent envelope.
- A successful POST means only `accepted_for_delivery`. It does not mean mailbox delivery.

The deletion date is an operational instruction, not technical deletion enforcement. The Worker keeps no report store and cannot remove copies from recipient mailboxes or processor systems. An early deletion request can cover Adam and Sam's mailbox copies, but it cannot promise early deletion of the email processor's copy. On the default path the processor is Cloudflare Email Service; on the fallback path it is Resend, which may retain its copy for its standard 30-day period. Deployment still requires a documented owner and procedure for early requests, due-date deletion and evidence that the procedure ran. This documentation does not claim legal compliance.

If the Resend fallback is ever activated: selecting Resend's Ireland region controls routing and sending only. Resend states that account data, email metadata, logs and API records remain stored in the United States regardless of the sending region.

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

Tests cover strict v1 preservation, v2 exact keys and enums, calendar ordering, cardinality, bucket ranges, cross-section reconciliation, fixed server-side recipients, idempotency, CORS, the 256 KiB limit, JSON-only input, HTML escaping and synthetic 400, 409, 413, 429 and upstream-500 failures. The Cloudflare binding path is tested with an injected `env.EMAIL` mock, exactly as the Resend path injects `fetchImpl`: success with the exact captured message and attachment, binding error codes mapped to truthful 429, 502 and 503 responses, oversized content rejected by the binding, the 256 KiB pre-check firing before the binding is called, fail-closed configuration, and explicit `DELIVERY_PROVIDER` routing. No test sends real email; `wrangler dev` also simulates the binding locally by default and does not send.

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

A live synthetic request is deliberately awkward. It requires `--live`, two different exact confirmation phrases and a new absolute retention-log path outside the repository. The parent folder must already exist. The tool reserves the log before its single request and refuses to overwrite an earlier record:

```powershell
npm run smoke:production -- `
  --live `
  --confirm-synthetic SYNTHETIC-REPORT-ONLY `
  --confirm-send SEND-ONE-PRODUCTION-SMOKE `
  --retention-log "C:\private\top-smoke-retention-YYYY-MM-DD.json"
```

The committed [`scripts/retention-log.template.json`](scripts/retention-log.template.json) documents the private record shape. The live tool materializes it with the synthetic report hash and dates. Keep the actual log outside Git, OneDrive-shared folders and this repository. Its `receipt_id` is the client submission UUID used for idempotency. It is never proof that the email provider delivered a message. Even an exact HTTP 202 response leaves `provider_delivery_confirmed` set to `false` and both received-attachment hashes pending.

A timeout or other transport failure is recorded as `delivery_outcome_unknown`, because the server may already have processed the request. Do not retry automatically. If an HTTP response arrives but the final local log write fails, the tool reports the known response separately and stops without claiming a clean smoke. Reconcile the private record before any further live request.

After the two approved recipients save their received JSON attachments locally, compare both files with the expected hash without granting this tool mailbox access:

```powershell
npm run verify:attachments -- `
  --retention-log "C:\private\top-smoke-retention-YYYY-MM-DD.json" `
  --attachment "C:\Downloads\received-copy-1.json" `
  --attachment "C:\Downloads\received-copy-2.json"
```

The helper reads only the three explicit local paths. It makes zero network calls, stores both observed SHA-256 values in the private log and fails unless both equal `report_sha256`.

### Exact morning order

1. **No-email probes.** Check the pinned route before any POST. These paths return before the Worker reads a report or calls the email provider:

   ```powershell
   curl.exe --silent --show-error --output NUL --write-out "%{http_code}`n" `
     --request OPTIONS `
     --header "Origin: https://tokenoptimisationprotocol.org" `
     --header "Access-Control-Request-Method: POST" `
     https://submit.tokenoptimisationprotocol.org/

   curl.exe --silent --show-error --output NUL --write-out "%{http_code}`n" `
     --request GET `
     --header "Origin: https://tokenoptimisationprotocol.org" `
     https://submit.tokenoptimisationprotocol.org/
   ```

   Expect `204` for the preflight and `405` for GET. Stop if either differs. Neither response proves email delivery.
2. **Synthetic smoke.** Run the zero-network default first. Review the pinned route and hash. Then run one live synthetic request with both exact confirmations and a new private retention-log path. Stop unless the tool records HTTP `202` and `accepted_status: "accepted_for_delivery"`. This is provider acceptance only, not delivery proof.
3. **Attachment hash check.** Save the two received JSON attachments, run `verify:attachments`, and stop unless both hashes match `report_sha256`. Leave `provider_delivery_confirmed: false`; the hash proves attachment identity, not provider delivery telemetry.
4. **Adam's one real self-report.** Only after steps 1 to 3 pass should Adam deliberately submit one reviewed research-safe report through the analyzer. Do not substitute the smoke tool for the analyzer consent flow.

No step here deploys the Worker, changes a dashboard, reads a credential, discovers a recipient, opens a mailbox or activates the frontend endpoint.

## Human setup gates before any deployment

Do not deploy until all of these are decided and documented:

1. Identify the data controller and deletion contact.
2. Approve the purposes, lawful basis, 30-day report-email retention rule and deletion procedure.
3. Decide whether Adam alone or Adam and Sam receive reports. Add Sam only after he agrees to the responsibility.
4. Enable Email Routing for `tokenoptimisationprotocol.org` in the Cloudflare dashboard (Compute, then Email Service, then Email Routing). Before enabling, confirm the domain's existing MX records: enabling Email Routing manages MX, SPF and DKIM on the root domain, so check first if the domain already receives mail through another provider. The routing domain supplies the `from` identity for `reports@tokenoptimisationprotocol.org`.
5. Add `adam2hartley@gmail.com` and `oconns89@tcd.ie` as verified destination addresses under Email Routing. Each recipient must click the Cloudflare verification link. Sends to verified destination addresses are free and exempt from daily and monthly quotas on every plan. Note that Email Sending is public beta as of July 2026; if the first live send fails with `E_SENDER_NOT_VERIFIED`, onboard the domain under Email Sending in the dashboard as well.
6. Review Cloudflare as processor, including international-transfer disclosures. Review Resend only if the fallback path is activated.
7. Confirm the rate-limit namespace is unique within the chosen Cloudflare account.
8. Add an abuse-control decision for public rollout. The current rate limit is suitable only for a small pilot.
9. Review the dormant frontend integration. It displays the exact payload, fixed recipient names, processor notice, explicit purposes, 30-day retention wording, a deliberate Submit button and truthful receipt states. It does not contain recipient addresses or an active endpoint.
10. Deploy using the committed `wrangler.jsonc`, then verify that Cloudflare lists `submit.tokenoptimisationprotocol.org` under the Worker's Domains & Routes and verify its HTTPS and CORS preflight. Do not create a second dashboard-managed route. Then make a separate activation change: set `TOP_DELIVERY_ENDPOINT` to exactly `https://submit.tokenoptimisationprotocol.org/` and change CSP from `connect-src 'none'` to exactly `connect-src https://submit.tokenoptimisationprotocol.org`. Keep `form-action 'none'` and do not add a second Worker URL.
11. Run a synthetic production smoke test before any real participant data.

The default Cloudflare path needs no secrets. `SUBMISSION_TO` and `SUBMISSION_CC` are non-secret vars committed in `wrangler.jsonc`, each holding exactly one address. The Worker fails closed if either is absent or contains a list, and it never returns recipient addresses to the browser. The `send_email` binding allowlist must stay identical to the two vars.

Only if the Resend fallback is approved later, set its secrets interactively and set `DELIVERY_PROVIDER` to `resend`. Never put secret values in this repository or command history:

```powershell
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put RESEND_FROM
```

`RESEND_FROM` must be a display name plus a mailbox on the verified subdomain, for example `TOP Analyzer <reports@send.tokenoptimisationprotocol.org>`. Keep the exact value in the Worker secret rather than frontend code.

## Deliberately absent

- No credentials or API keys. The default path authenticates through the `send_email` binding alone. The two approved recipient addresses are committed as non-secret vars and as the binding allowlist in `wrangler.jsonc`; they are never returned to the browser.
- No active frontend endpoint or permissive network CSP. The future single allowed connection origin is documented but not enabled in this scaffold release.
- No deployment has been performed. The reviewed production custom-domain route is declared in `wrangler.jsonc`.
- No database, webhook or claim of final email delivery.
- No automatic collection on file selection, parsing or report display.
- No `"remote": true` on the `send_email` binding, so `wrangler dev` simulates sends locally and cannot send real email.
