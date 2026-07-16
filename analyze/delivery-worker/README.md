# TOP analyzer delivery Worker

This is a review-only Cloudflare Worker scaffold for explicit submission of `top.research-safe-usage.v1` and `top.research-safe-usage.v2` reports. It is not deployed. The analyzer contains a dormant client integration, but its endpoint is blank and CSP remains `connect-src 'none'`, so the checked-in site cannot call this Worker.

V1 remains unchanged. V2 is the exact v1 top-level object plus `timeline`, `session_distributions` and `workflow_shape`. It accepts only the vetted v2 local collector and parser versions for Claude Code or Codex safe-usage exports.

## Safety boundary

- It accepts requests only from `https://adamhartley7.github.io`.
- It accepts JSON only and stops reading after 256 KiB.
- The client submits a strict consent envelope containing one exact research-safe report. Unknown fields, client-supplied recipients, private-content fields, unsupported labels and unreconciled totals fail closed.
- Recipients, sender and the Resend API key come only from Worker secrets. They are not accepted from the browser.
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

## Human setup gates before any deployment

Do not deploy until all of these are decided and documented:

1. Identify the data controller and deletion contact.
2. Approve the purposes, lawful basis, 30-day report-email retention rule and deletion procedure.
3. Decide whether Adam alone or Adam and Sam receive reports. Add Sam only after he agrees to the responsibility.
4. Verify a sending domain in Resend and create a domain-restricted `sending_access` API key.
5. Review Resend and Cloudflare as processors, including international-transfer disclosures.
6. Confirm the rate-limit namespace is unique within the chosen Cloudflare account.
7. Add an abuse-control decision for public rollout. The current rate limit is suitable only for a small pilot.
8. Review the dormant frontend integration. It displays the exact payload, fixed recipient names, processor notice, explicit purposes, 30-day retention wording, a deliberate Submit button and truthful receipt states. It does not contain recipient addresses or an active endpoint.
9. Set `TOP_DELIVERY_ENDPOINT` and update analyzer CSP from `connect-src 'none'` to only that same exact Worker endpoint in one reviewed change. Keep `form-action 'none'`.
10. Run a synthetic production smoke test before any real participant data.

Once approved, set secrets interactively. Never put their values in this repository or command history:

```powershell
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put RESEND_FROM
npx wrangler secret put SUBMISSION_TO
```

`SUBMISSION_TO` is required. Run `npx wrangler secret put SUBMISSION_CC` only if a CC recipient has been approved. The Worker never returns recipient addresses to the browser.

## Deliberately absent

- No real credentials or recipient addresses.
- No active frontend endpoint or permissive network CSP.
- No deployment configuration for a production route.
- No database, webhook or claim of final email delivery.
- No automatic collection on file selection, parsing or report display.
