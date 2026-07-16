# TOP Analyzer development checks

The analyzer is a local, static browser tool. It must not transmit usage data, contact details, or visitor notifications automatically.

Run all checks before review:

```powershell
node analyze/test-claude-parser.cjs
node analyze/test-routeb-and-escaping.cjs
node analyze/test-privacy.cjs
node analyze/test-openai-parser.cjs
node analyze/test-post-report-flow.cjs
node analyze/test-email-draft.cjs
node analyze/test-direct-submit.cjs
node analyze/test-research-safe-export.cjs
node analyze/test-codex-parser.cjs
node analyze/test-cursor-parser.cjs
node analyze/test-obsidian-vault.cjs
node analyze/collector/test-top-collector.mjs
node analyze/collector/test-top-collector-v2.mjs
```

The command-line collector keeps `top.safe-usage.v1` as its unchanged default. The opt-in `--schema v2` flag adds calendar-month aggregates, logical-session histograms, and a structural workflow-shape summary based only on deduplicated usage-record counts. V2 does not add prompt, reply, code, tool, path, filename, account, project, original-ID, or exact-timestamp fields. Claude Code sessions are joined with run-random HMAC digests that never enter the report. Exact day and time metadata used during local reconciliation is AES-GCM sealed in temporary spools with an ephemeral key that is never written to disk. Codex uses each parsed rollout file as an explicitly labelled session proxy. Elapsed-time buckets are wall-clock spans between the first and last supported usage records, not measured active work time. A partial or invalid timestamp makes the session's elapsed bucket unknown. The v2 synthetic suite covers boundary buckets, cross-file resumed-session deduplication, partial and invalid timestamps, monthly and total reconciliation, safe schema rejection, CLI selection, and privacy sentinels.

An optional user-value estimate should be a separate, explicit post-collector enrichment step rather than inferred collector output. A future schema extension should default to `not_provided`, accept only deliberate user inputs, label every result `self_reported_unvalidated`, allowlist the currency, use exact decimal or integer-minor-unit money arithmetic, state the formulas and provenance, and never infer hours saved, hourly value, or spend from usage history.

The parser checks cover duplicate Claude Code usage rows, stable call identities, cumulative Codex token snapshots, Codex model changes, strict Cursor CSV rows, Route B deduplication, Claude Chat and ChatGPT schema detection, conversation-export scope labels, and safe rendering of imported labels. Cursor accepts exactly one per-request CSV with a timezone-qualified timestamp, bounded model label, recorded cost, and separate input, output, cache-read and cache-write token columns. Missing or ambiguous headers, a combined cache-only column, malformed rows, invalid values, unknown cost, or a second file reject the whole import. No public model rate is applied to Cursor rows. The Cursor Obsidian note uses the shared `top_source: cursor` frontmatter and aggregates only by UTC day and model, without exact times or request IDs. Conversation imports accept only `conversations.json` or numbered variants, switch to the matching reader when the schema is unambiguous, and reject project or arbitrary JSON instead of presenting it as usage. Chat-history estimates are explicitly limited to visible text in the selected files and are not account, subscription, Claude Code, or Codex totals. The Codex parser accepts explicit `rollout-*.jsonl` files or one TOP aggregate `ai-events.jsonl`, processes large rollout files in bounded chunks, and retains only token counters, dates and the active model. It rejects mixing raw and aggregate inputs because that could count the same usage twice. It ignores transcript text, tool output, paths, IDs, account limits and Git details. The privacy check rejects browser network primitives, the old relay path, visitor notification code, remote fonts, old send actions, persistent storage, direct vault writing, and unsupported anonymous-data claims. It also verifies that the intake pause appears before route selection and that each provider has truthful Route A and Route B copy.

Every successful usage report is followed by the optional questionnaire and a personal summary download. The Claude Code and Codex routes put the whole-folder picker before the individual-file fallback. Claude Code accepts the exact `.claude\projects` root and rejects the parent `.claude` folder and `history.jsonl`, which can contain prompt history. The Obsidian route detects when someone selected `.claude\projects` instead of a vault and offers the correct local analysis path without opening the files automatically. If the vault-check safety limits would truncate that recovery path, it refuses to make a partial report and redirects to the dedicated folder route. Codex reports also offer explicit aggregate `ai-events.jsonl` and Obsidian Markdown downloads. These files do not connect a vault to AI memory automatically, and raw rollout transcripts should remain outside synced vaults.

The final step can download or copy the exact reviewed summary and can download or use the device share sheet for one frozen research-safe JSON package. The former arbitrary-recipient email draft is deliberately absent. Direct delivery is fixed to Adam and Sam by the server, never by browser input.

The frontend contains a dormant, configuration-gated direct-submission path. `TOP_DELIVERY_ENDPOINT` is blank in source and CSP remains `connect-src 'none'`, so the checked-in site cannot submit. When a final HTTPS Worker endpoint is reviewed, both the constant and CSP must be changed to that one exact endpoint in the same reviewed change. The Submit button also requires a completed research-safe report, browser support for `crypto.randomUUID`, and explicit consent for `analyzer_validation` plus `forecast_calibration` with an up-to-30-day retention notice. No request runs during file selection, parsing, report display, consent changes or download, and there is no automatic retry or persistent browser storage.

Participant copy names Cloudflare and Resend as processors, warns that unusual usage patterns may still identify someone, and says the participant can ask Adam for early deletion. This is transparent product copy, not a claim of legal compliance. The frontend cannot enforce mailbox deletion, and the direct-delivery deployment remains gated on an operational deletion procedure.

The final step also offers a separate complete research-safe JSON download. It contains collector and parser versions, privacy-safe source, measurement and scope labels, parser coverage where the current parser exposes it, token and activity aggregates, cost and exact per-field applied-rate provenance, strictly sanitized AI-version labels, safe permission-mode counts when available, and enum-only questionnaire selections. Date-like AI-version suffixes are removed before a constrained allowlist is applied. Its value-model scenario is included only for an eligible report, is labelled `illustrative_unvalidated`, includes the algorithm version and assumptions, and must not be treated as measured forecast accuracy. Ineligible reports retain a `not_available` status object without scenario outputs. The file uses a date only and excludes prompts, replies, code, tool output, paths, filenames, project and account identifiers, email addresses, exact timestamps and original IDs. The tester must inspect it and deliberately attach it; TOP does not transmit it.

Removing a client-side access value from this repository does not revoke it at the provider. Provider-side rotation or revocation remains a separate human-approved account action.
