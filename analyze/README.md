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
node analyze/test-codex-parser.cjs
node analyze/test-obsidian-vault.cjs
```

The parser checks cover duplicate Claude Code usage rows, stable call identities, cumulative Codex token snapshots, Codex model changes, Route B deduplication, Claude Chat and ChatGPT schema detection, conversation-export scope labels, and safe rendering of imported labels. Conversation imports accept only `conversations.json` or numbered variants, switch to the matching reader when the schema is unambiguous, and reject project or arbitrary JSON instead of presenting it as usage. Chat-history estimates are explicitly limited to visible text in the selected files and are not account, subscription, Claude Code, or Codex totals. The Codex parser accepts explicit `rollout-*.jsonl` files or one TOP aggregate `ai-events.jsonl`, processes large rollout files in bounded chunks, and retains only token counters, dates and the active model. It rejects mixing raw and aggregate inputs because that could count the same usage twice. It ignores transcript text, tool output, paths, IDs, account limits and Git details. The privacy check rejects browser network primitives, the old relay path, visitor notification code, remote fonts, old send actions, persistent storage, direct vault writing, and unsupported anonymous-data claims. It also verifies that the intake pause appears before route selection and that each provider has truthful Route A and Route B copy.

Every successful usage report is followed by the optional questionnaire and a personal summary download. The Claude Code and Codex routes put the whole-folder picker before the individual-file fallback. Claude Code accepts the exact `.claude\projects` root and rejects the parent `.claude` folder and `history.jsonl`, which can contain prompt history. The Obsidian route detects when someone selected `.claude\projects` instead of a vault and offers the correct local analysis path without opening the files automatically. If the vault-check safety limits would truncate that recovery path, it refuses to make a partial report and redirects to the dedicated folder route. Codex reports also offer explicit aggregate `ai-events.jsonl` and Obsidian Markdown downloads. These files do not connect a vault to AI memory automatically, and raw rollout transcripts should remain outside synced vaults.

The final step can download, copy, or open the exact reviewed summary in a user-addressed email draft. It never sends automatically and never claims delivery. Recipient addresses remain browser-local and are not stored in source. Reliable direct submission remains disabled until consent, retention, deletion, legal responsibility, server-side recipients, and a safe receiving service are approved.

Removing a client-side access value from this repository does not revoke it at the provider. Provider-side rotation or revocation remains a separate human-approved account action.
