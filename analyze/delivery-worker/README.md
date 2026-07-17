# TOP analyzer delivery Worker

This is a review-ready Cloudflare Worker for explicit submission of `top.research-safe-usage.v1` and `top.research-safe-usage.v2` reports. It is not deployed by this repository change. `wrangler.jsonc` is the source of truth for the custom domain `submit.tokenoptimisationprotocol.org`; `workers_dev` and preview URLs are disabled. The analyzer integration remains dormant: its endpoint is blank and CSP remains `connect-src 'none'`. Delivery stays fail closed until the Worker, its custom domain, secrets and rate-limit binding are verified, followed by a separate frontend activation review.

The research-safe v1 and v2 top-level schemas remain unchanged. V2 is the exact v1 top-level object plus `timeline`, `session_distributions` and `workflow_shape`. It accepts only the vetted v2 local collector and parser versions for Claude Code or Codex safe-usage exports. Value-model member acceptance is intentionally narrowed during the transition described below.

## Value-model transition contract

The Worker accepts the legacy `top.value-model.v0.1-illustrative` version only as the exact three-field `not_available` object that the dormant transition flow can still produce. It rejects all legacy illustrative scenario outputs. It also accepts `top.value-model.v0.2-self-reported` as exact `not_available`, `not_provided`, or reconciled `self_reported_unverified` shapes. V0.2 accepts finite zero values, preserves a zero net result as `0`, requires a null ratio only when analyzed AI cost is zero, and never combines non-USD self-reported value with USD AI cost. Fields and reasons cannot be mixed across versions.

This Worker is not compatible with the PR9 frontend by itself because that frontend can still produce eligible v0.1 `illustrative_unvalidated` reports. Keep PR9 and PR11 dormant until this Worker is deployed and verified. Then ship the PR9 activation and PR11 v0.2 frontend together in one newly reviewed integration release, or first amend PR9 so it can emit only the accepted legacy `not_available` shape. Do not merge or publish PR9 alone against this Worker.

## Safety boundary

- It accepts requests only from the live custom-domain frontend at `https://tokenoptimisationprotocol.org`. The GitHub Pages origin and every unrelated origin fail closed.
- It accepts JSON only and stops reading after 256 KiB.
- The client submits a strict consent envelope containing one exact research-safe report. Unknown fields, client-supplied recipients, private-content fields, unsupported labels and unreconciled totals fail closed.
- Recipients, sender and the Resend API key come only from Worker secrets. They are not accepted from the browser. The sender secret must use the verified `send.tokenoptimisationprotocol.org` subdomain. `wrangler.jsonc` declares the four secret names under `secrets.required`, without storing their values. Wrangler uses that list for type generation and local-development warnings, but a dry run does not verify that the remote secrets exist.
- The API key must be a Resend `sending_access` key restricted to the verified sender domain.
- The same submission UUID is passed to Resend as an idempotency key.
- The Worker does not log, persist or place the report in KV, D1 or R2. The validated report is attached to one email; the message body contains only a readable aggregate summary.
- Both email bodies include the UTC delivery-request date and an explicit deletion due date 30 calendar days later. They instruct recipients to delete the email and attachment by that date, or sooner after an early deletion request to Adam.
- For v2, the email also contains a concise monthly timeline and structural session-shape summary. The attached JSON remains the exact validated report.
- `report.privacy.network_delivery` records the analyzer's local state when it generated the report. A later email can occur only through the separate explicit-submission consent envelope.
- A successful POST means only `accepted_for_delivery`. It does not mean mailbox delivery.

The deletion date is an operational instruction, not technical deletion enforcement. The Worker keeps no report store and cannot remove copies from recipient mailboxes or processor systems. An early deletion request can cover Adam and Sam's mailbox copies, but it cannot promise early deletion of Resend's processor copy. Resend may retain that copy for its standard 30-day period. Deployment still requires a documented owner and procedure for early requests, due-date deletion and evidence that the procedure ran. This documentation does not claim legal compliance.

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

A live synthetic request is deliberately awkward. It requires `--live`, two different exact confirmation phrases and a new absolute retention-log path outside the repository. The parent folder must already exist. The tool reserves the log before its single request and refuses to overwrite an earlier record:

```powershell
npm run smoke:production -- `
  --live `
  --confirm-synthetic SYNTHETIC-REPORT-ONLY `
  --confirm-send SEND-ONE-PRODUCTION-SMOKE `
  --retention-log "C:\private\top-smoke-retention-YYYY-MM-DD.json"
```

The committed [`scripts/retention-log.template.json`](scripts/retention-log.template.json) documents the private record shape. The live tool materializes it with the synthetic report hash and dates. Keep the actual log outside Git, OneDrive-shared folders and this repository. Its `receipt_id` is the client submission UUID used for idempotency. It is never proof that Resend delivered a message. Even an exact HTTP 202 response leaves `provider_delivery_confirmed` set to `false` and both received-attachment hashes pending.

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
4. **One frontend integration release.** Only after steps 1 to 3 pass, publish one newly reviewed integration release containing both the PR9 endpoint and CSP activation and the PR11 v0.2 self-reported frontend. Verify the exact Pages deployment before continuing. Never publish PR9 alone against this Worker.
5. **Adam's one real self-report.** Only after steps 1 to 4 pass should Adam deliberately submit one reviewed research-safe report through the analyzer. Do not substitute the smoke tool for the analyzer consent flow.

The smoke and attachment-hash tools do not deploy the Worker, change a dashboard, read a credential, discover a recipient, open a mailbox or activate the frontend endpoint. Step 4 is the separate, deliberate frontend activation gate.

## Human setup gates before any deployment

Do not deploy until all of these are decided and documented:

1. Identify the data controller and deletion contact.
2. Approve the purposes, lawful basis, 30-day report-email retention rule and deletion procedure.
3. Decide whether Adam alone or Adam and Sam receive reports. Add Sam only after he agrees to the responsibility.
4. Verify `send.tokenoptimisationprotocol.org` as the sending domain in Resend and create a domain-restricted `sending_access` API key.
5. Review Resend and Cloudflare as processors, including international-transfer disclosures.
6. Confirm the rate-limit namespace is unique within the chosen Cloudflare account.
7. Add an abuse-control decision for public rollout. The current rate limit is suitable only for a small pilot.
8. Review the dormant frontend integration. It displays the exact payload, fixed recipient names, processor notice, explicit purposes, 30-day retention wording, a deliberate Submit button and truthful receipt states. It does not contain recipient addresses or an active endpoint.
9. Set all four required secrets through the approved interactive setup. In the Cloudflare dashboard, verify that the remote secret-name list contains exactly `RESEND_API_KEY`, `RESEND_FROM`, `SUBMISSION_TO` and `SUBMISSION_CC`, without exposing their values. Treat a missing or extra name as a hard stop. `secrets.required` and `wrangler deploy --dry-run` do not replace this remote verification.
10. Deploy using the committed `wrangler.jsonc`, then verify that Cloudflare lists `submit.tokenoptimisationprotocol.org` under the Worker's Domains & Routes and run the strict no-email route, CORS and unsafe-method probes. Do not create a second dashboard-managed route. Keep PR9 and PR11 dormant throughout these checks.
11. Run the zero-network smoke dry run, then exactly one approved synthetic production smoke. Stop unless both recipients' saved attachments match the expected report hash.
12. Only after steps 10 and 11 pass, publish one newly reviewed integration release containing the exact PR9 endpoint and CSP activation plus the PR11 v0.2 frontend. Keep `form-action 'none'`, do not add a second Worker URL, and verify the exact Pages deployment before continuing.
13. Only after step 12 passes, submit Adam's one reviewed real report through the analyzer consent flow.

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
