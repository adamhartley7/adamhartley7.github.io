# TOP Analyzer development checks

The analyzer is a local, static browser tool. It must not transmit usage data, contact details, or visitor notifications automatically.

Run all checks before review:

```powershell
node analyze/test-claude-parser.cjs
node analyze/test-routeb-and-escaping.cjs
node analyze/test-privacy.cjs
node analyze/test-openai-parser.cjs
node analyze/test-post-report-flow.cjs
```

The parser checks cover duplicate Claude Code usage rows, stable call identities, Route B deduplication, ChatGPT conversation exports, and safe rendering of imported labels. The privacy check rejects browser network primitives, the old relay path, visitor notification code, remote fonts, old send actions, and unsupported anonymous-data claims. It also verifies that the intake pause appears before route selection and that each provider has truthful Route A and Route B copy.

Every successful usage report is followed by the optional questionnaire and a personal summary download. Direct submission stays disabled until consent, retention, deletion, legal responsibility, and a safe server-side collection design are approved.

Removing a client-side access value from this repository does not revoke it at the provider. Provider-side rotation or revocation remains a separate human-approved account action.
