# TOP analyzer delivery Worker

This is a review-only Cloudflare Worker scaffold for explicit submission of `top.research-safe-usage.v1` reports. It is not deployed and the public analyzer does not call it.

## Safety boundary

- It accepts requests only from `https://adamhartley7.github.io`.
- It accepts JSON only and stops reading after 256 KiB.
- The client submits a strict consent envelope containing one exact research-safe report. Unknown fields, client-supplied recipients, private-content fields, unsupported labels and unreconciled totals fail closed.
- Recipients, sender and the Resend API key come only from Worker secrets. They are not accepted from the browser.
- The API key must be a Resend `sending_access` key restricted to the verified sender domain.
- The same submission UUID is passed to Resend as an idempotency key.
- The Worker does not log, persist or place the report in KV, D1 or R2. The validated report is attached to one email; the message body contains only a readable aggregate summary.
- A successful POST means only `accepted_for_delivery`. It does not mean mailbox delivery.

## Tests

No package install is needed for the test suite:

```powershell
node --test test/*.test.mjs
```

Tests cover strict validation, total reconciliation, fixed server-side recipients, idempotency, CORS, the 256 KiB limit, JSON-only input, HTML escaping and synthetic 400, 409, 413, 429 and upstream-500 failures.

## Human setup gates before any deployment

Do not deploy until all of these are decided and documented:

1. Identify the data controller and deletion contact.
2. Approve the purposes, lawful basis, 30-day report-email retention rule and deletion procedure.
3. Decide whether Adam alone or Adam and Sam receive reports. Add Sam only after he agrees to the responsibility.
4. Verify a sending domain in Resend and create a domain-restricted `sending_access` API key.
5. Review Resend and Cloudflare as processors, including international-transfer disclosures.
6. Confirm the rate-limit namespace is unique within the chosen Cloudflare account.
7. Add an abuse-control decision for public rollout. The current rate limit is suitable only for a small pilot.
8. Integrate the frontend in a separate reviewed change. It must display the exact payload, the consent notice, a deliberate Send button and truthful receipt states.
9. Update the analyzer CSP from `connect-src 'none'` to only the final Worker endpoint. Keep `form-action 'none'`.
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
- No frontend integration.
- No deployment configuration for a production route.
- No database, webhook or claim of final email delivery.
- No automatic collection on file selection, parsing or report display.
