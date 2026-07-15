# TOP Analyzer development checks

The analyzer is a local, static browser tool. It must not transmit usage data, contact details, or visitor notifications automatically.

Run all checks before review:

```powershell
node analyze/test-claude-parser.cjs
node analyze/test-routeb-and-escaping.cjs
node analyze/test-privacy.cjs
```

The parser checks cover duplicate Claude Code usage rows, stable call identities, Route B deduplication, and safe rendering of imported labels. The privacy check rejects browser network primitives, the old relay path, visitor notification code, remote fonts, and the old send button.

The page currently supports local analysis, copying the summary, and downloading it as text. Direct submission stays disabled until consent, retention, deletion, legal responsibility, and a safe server-side collection design are approved.

Removing a client-side access value from this repository does not revoke it at the provider. Provider-side rotation or revocation remains a separate human-approved account action.
