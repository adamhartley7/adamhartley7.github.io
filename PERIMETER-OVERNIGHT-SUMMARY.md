# TOP perimeter overnight summary

Date: 2026-07-19

Branch: `codex/perimeter-first-run-2026-07-19`

Base inspected: `origin/main` at `211d397`

Scope: tests, fixtures, collector and Delivery Worker boundaries, CI, and this report. Protected implementation files were inspected but not edited.

## Outcome

- Added one synthetic fixture containing no real user data for each of the seven supported sources.
- Exercised every fixture through the real browser file input, parser, local renderer, and visible progress UI. Result: 7 of 7 passed.
- Expanded the fail-first never-zero suite to 15 contracts. Result against the current protected implementation: 0 of 15 passed, which confirms the violations are real before any implementation fix is accepted.
- Replaced the old Cursor and Copilot unknown-row drop assertions with stronger retention contracts in the same parser regressions. Both transition files are deliberately protected and currently fail at their final strengthened assertion.
- Added four fail-first clean-machine acquisition contracts. Result: 0 of 4 passed.
- Made the Delivery Worker test command preload an offline process guard. Result: 102 of 102 Worker tests passed.
- Pinned the analyzer connection boundary. Exactly one pre-existing, user-initiated delivery `fetch` is permitted byte-for-byte, and all other tested connection paths are forbidden. Result: 1 of 1 passed.
- Added the new perimeter files to the Windows CI workflow. Protected contracts remain deliberately red until their owning implementation agents fix the product.

## Single highest-value morning fix

Make the guided seven-source flow the default at the canonical `/analyze/` route, and move the advanced analyzer behind an explicit `?full=1` link.

Today the guided flow is hidden at `analyze/index.html:405`, only activates when `?pilot=1` is present at `analyze/index.html:1840-1844`, and the plain route instead exposes the legacy intake gate at `analyze/index.html:459-474`. This blocks a stranger before source selection, so it has broader impact than any parser-specific issue. I did not make this fix because `analyze/index.html` is protected tonight.

## Ranked stranger audit

There is no production completion telemetry, so the ranking uses affected source reach first, then hard-stop severity. Each suggested implementation fix belongs to the protected owner unless stated otherwise.

| Rank | Sources affected | Verified stop or trust gap | Evidence | One-line suggested fix |
|---:|---|---|---|---|
| 1 | All seven | Plain `/analyze/` does not reveal the guided source chooser and shows the legacy intake gate first. | `analyze/index.html:405`, `459-474`, `1840-1855` | Make guided mode canonical and provide an explicit `?full=1` advanced escape. |
| 2 | All seven | Unknown or source-unpriceable cost does not use the exact word `unpriced`, and some paths expose a false monetary zero. | `analyze/index.html:2552-2555`, `3143`, `3159`, `3837-3844`, `3986`, `5071` | Preserve missing cost as `null`, render exactly `unpriced`, and keep the available usage measure visible. |
| 3 | All seven | The completed-report terminal names remote share and submission actions even though direct delivery is not configured. | `analyze/index.html:1116-1149`, blank endpoint at `4951`, permitted click-bound fetch at `4998` | Hide unavailable remote actions until configured, while keeping local download and copy available and leaving the permitted fetch unchanged. |
| 4 | Cursor, Cursor Composer, GitHub Copilot | Truly unknown model or SKU rows are dropped, so their source-native usage can disappear instead of remaining visible and unpriced. | Cursor recognition and drop at `analyze/index.html:2161-2166`, `2211-2213`; Copilot at `2301-2306`, `2354-2361` | Retain a sanitized unknown label or explicit unrecognized bucket with source-native usage, and set cost to unpriced. |
| 5 | Claude Code, Codex | The recommended collector route hard-stops because the pinned hash does not match the deployed LF bytes. | `analyze/index.html:1696-1698`, mandatory stop at `1784`; contract at `analyze/test-pilot-collector-pin.cjs:12` | Pin the deployed hash `768742c0ce5c992d90f4d15ccaf799accf7e29d8c33fc4060d051061d085354c` and update URL, hash, and version together. |
| 6 | Claude Code, Codex | The recommended route silently requires Node and leaves shell metasyntax in the output path. | `analyze/index.html:426-436`, command at `1774-1787`; contract at `analyze/test-clean-machine-collector-prerequisite.cjs:94` | Disclose Node, preflight with `node --version`, give missing-runtime recovery, and resolve a quoted Downloads path. |
| 7 | Claude Code, Codex | One control starts an asynchronous clipboard copy and opens the folder picker immediately, so clipboard denial or delay can strand the user. | `analyze/index.html:438-442`, `1867-1875`; contracts at `analyze/test-stranger-first-run-contract.cjs:235-269` | Split Copy Address and Choose Folder into independent controls. |
| 8 | Claude Chat, ChatGPT | Any official-name conversation file above the fixed threshold is rejected before content inspection, reading, or progress begins. | fixed limits at `analyze/index.html:4345`, device threshold at `4347-4349`, rejection at `4369-4372`, per-file rejection at `4392`, `4400`; bounded-read contract at `analyze/test-guided-acquisition-contracts.cjs:659` | Parse official conversation exports incrementally with bounded local reads and existing progress updates. |
| 9 | Claude Chat | The chooser promises a browser route, but detailed instructions only describe the desktop app. | promise at `analyze/index.html:413`; instructions at `1501-1510` | Add the complete claude.ai Settings, Privacy, Export Data, email, extraction, and `conversations.json` path. |
| 10 | GitHub Copilot | Acquisition copy contradicts itself about immediate versus emailed delivery and omits the managed-account billing-role path. | `analyze/index.html:418`, `450-452`, `1533-1539`, `1805-1806` | Use one emailed-link explanation everywhere and separate personal from managed-account instructions. |
| 11 | Codex | Guided folder acquisition points only to active sessions even though the collector supports active and archived roots. | `analyze/index.html:416`, `438-442`, `1809`; collector roots at `analyze/collector/top-collector.mjs:447-449` | Deliberately collect both roots and explain that their totals are combined. |
| 12 | Cursor Composer | Composer is supported but is not named in the first source chooser. | chooser at `analyze/index.html:417`; later explanation at `1524-1525` | Rename the first option to `Cursor, including Cursor Composer`. |

## Seven-source clean-machine map

All seven sources are exercisable from a checked-in synthetic fixture through local report rendering. The open-rank column maps each source back to the audit above.

| Source | Fixture | Browser contract | Result | Open ranks |
|---|---|---|---:|---|
| Claude Code | `analyze/fixtures/seven-source/claude-code.jsonl:1` | `analyze/test-seven-source-local-browser.cjs:39` | Pass | 1, 2, 3, 5, 6, 7 |
| Claude Chat | `analyze/fixtures/seven-source/claude-chat.json:1` | `analyze/test-seven-source-local-browser.cjs:54` | Pass | 1, 2, 3, 8, 9 |
| ChatGPT | `analyze/fixtures/seven-source/chatgpt.json:1` | `analyze/test-seven-source-local-browser.cjs:70` | Pass | 1, 2, 3, 8 |
| Codex | `analyze/fixtures/seven-source/codex.jsonl:1` | `analyze/test-seven-source-local-browser.cjs:86` | Pass | 1, 2, 3, 5, 6, 7, 11 |
| Cursor | `analyze/fixtures/seven-source/cursor.csv:1` | `analyze/test-seven-source-local-browser.cjs:101` | Pass | 1, 2, 3, 4 |
| Cursor Composer | `analyze/fixtures/seven-source/cursor-composer.csv:1` | `analyze/test-seven-source-local-browser.cjs:118` | Pass | 1, 2, 3, 4, 12 |
| GitHub Copilot | `analyze/fixtures/seven-source/github-copilot.csv:1` | `analyze/test-seven-source-local-browser.cjs:135` | Pass | 1, 2, 3, 4, 10 |

The integration test validates the seven-file synthetic manifest, fixture containment, existence, and the absence of home paths and email addresses at `analyze/test-seven-source-local-browser.cjs:155-160`, `647-660`. It passes the file to the native browser input at `548-551`, waits for a rendered report and full progress at `562-566`, and asserts the visible progress value at `777`.

The large-file contract uses virtual files whose yielded byte count equals the declared size and whose fully reconstructed content is valid synthetic Claude-style conversation JSON. It therefore proves the preflight and bounded-read boundary without embedding or allocating a real user's export in the repository.

The offline journey begins once the stranger possesses the provider export or local history. It does not prove live provider login, export authorization, actual email delivery, a native folder picker on a fresh Windows install, or the current authenticated Cursor and GitHub billing UI. Those are verification gaps, not asserted product failures.

### Remaining end-to-end gaps

- The seven-source browser journey stops at the local rendered report. It does not submit to the Delivery Worker.
- The Worker transition suite builds Claude Chat at `analyze/delivery-worker/test/index.test.mjs:783-787`.
- The Worker transition suite exercises the live analyzer builders for Cursor and Copilot at `analyze/delivery-worker/test/index.test.mjs:808-840`.
- There is no explicit ChatGPT analyzer-builder-to-Worker test.
- Cursor Composer shares the Worker `cursor_ide` surface with Cursor rather than having a distinct Worker source contract.

## Never-zero audit

The source contracts begin at `analyze/test-never-zero-render.cjs:460` and all fail against the current protected implementation, as required before accepting a fix.

The old Cursor and Copilot drop assertions were replaced by stronger retained-usage, safe-label, and incomplete-cost assertions at the end of the same parser regression files. Their earlier known-model and unknown-SKU checks run first and remain intact. Browser rendering for safe and hostile unknown labels is independently pinned at `analyze/test-never-zero-render.cjs:545`, `581`. CI runs both parser transition files with the protected contracts, so there is no green assertion that requires unknown usage to disappear.

| Source | Current violation | Usage that must remain visible |
|---|---|---|
| Claude Code | Unknown model renders `Not priced`. | Input, output, cache, and reply counts. |
| Claude Chat | Cost renders `Not in export`. | Estimated local token counts and message counts. |
| ChatGPT | Cost renders `Not in export`. | Estimated local token counts and message counts. |
| Codex | Cost renders `Not in files`. | Recorded input, output, cache, reasoning, and event counts. |
| Cursor | Unknown rows can be dropped, and missing or negative cost can surface as a valid zero. | Token and usage-event counts. |
| Cursor Composer | Same parser gaps as Cursor, plus grouped zero leakage. | Composer token and usage-event counts. |
| GitHub Copilot | Unknown rows can be dropped, and missing or negative billed cost can surface as a valid zero. | Requests and AI credits, with token counts explicitly unavailable. |

Additional pinned violations:

- Anthropic Console accepts and nets negative cost at `analyze/index.html:2121-2128`. The contract begins at `analyze/test-never-zero-render.cjs:527`.
- Cursor clamps a negative recorded cost to zero and then treats it as recorded at `analyze/index.html:2207`, `2217`.
- Copilot clamps negative cost to zero and treats it as recorded at `analyze/index.html:2349-2351`, `2367`.
- The visible covered Cursor branch is already distinct at `analyze/index.html:3782-3804`, `3837-3839`, `3931-3939`.
- Research-safe JSON lacks an equivalent subscription-covered state at `analyze/index.html:4851-4871`, `4906`, `4910`, so covered zero and unavailable cost are not distinct there.
- Pilot and cleaned-file surfaces use alternate wording at `analyze/index.html:3143`, `3159`, `5071`.

Required semantic states after the protected fix:

| Meaning | Visible cost | JSON cost |
|---|---|---|
| Unknown or unpriceable | `unpriced` | explicit unavailable status, USD `null` |
| Subscription covered | `plan covered` | status `subscription_covered`, USD `0` |
| Genuine recorded zero outside a plan | truthful source-specific zero label | recorded status, USD `0` |

## Analyzer and Worker network boundaries

### Analyzer

`analyze/test-no-network-ever.cjs` permits only the exact pre-existing expression at `analyze/index.html:4998`. It verifies that this call remains inside `submitResearchSafeReport`, requires consent, is click-bound at `5009`, has a blank endpoint at `4951`, and remains blocked by `connect-src 'none'` at `analyze/index.html:6`. All other tested `fetch`, `XMLHttpRequest`, beacon, WebSocket, and EventSource paths are forbidden. Result: 1 of 1 passed.

### Delivery Worker tests

`analyze/delivery-worker/package.json:6` now preloads `analyze/delivery-worker/test/offline-network-guard.mjs`. The guard blocks global fetch, WebSocket, EventSource, HTTP, HTTPS, HTTP/2, client and socket connect entry points, datagrams, and DNS at lines `23-51`. Its own two contracts are at `analyze/delivery-worker/test/offline-network-guard.test.mjs:8` and `15`.

The Worker suite still uses injected response fixtures even where a production endpoint string is present. Result: 102 of 102 passed without external traffic. This is an application-level process guard, not an operating-system network sandbox, and it does not claim to patch every possible low-level bypass.

## Public hard-rule audit

The single public hard-rule contract fails with three verified categories in protected or out-of-scope files:

- Em-dash or mojibake-equivalent source remains in `forecast/index.html:267`, `496`, `681`, `704`, `786` and visible dashboard copy including `dashboard/index.html:82`.
- Financial-benefit claims remain at `analyze/index.html:4035`, `4117` and `pitch/index.html:305-306`.
- Public accuracy figures remain at `forecast/index.html:164`, `397`, `556-559`, `618`, `pilot/index.html:132-133`, and `pilot/pilot-app.js:384`.

The contract reported no TOP-2 or TOP-3 shipped-label violation. I did not edit any of these implementation files.

## Exact verification counts

| Suite | Passed | Failed | Interpretation |
|---|---:|---:|---|
| Perimeter syntax checks | 11 | 0 | All perimeter and parser-transition CJS files parse. |
| Seven-source browser journey | 7 | 0 | One parser-to-render journey per source. |
| Existing CJS regressions | 37 | 0 | Protected fail-first and parser-transition files excluded by CI design. |
| Delivery Worker | 102 | 0 | Includes two offline-guard tests. |
| Collector scripts | 2 scripts | 0 scripts | Both scripts pass; they do not emit assertion counts. |
| Clean-machine collector prerequisite | 0 | 1 | Expected product gap. |
| Copilot parser transition | 0 | 1 | Expected unknown-row retention gap after all earlier assertions pass. |
| Cursor parser transition | 0 | 1 | Expected unknown-row retention gap after all earlier assertions pass. |
| Guided acquisition | 0 | 4 | Expected product gaps. |
| Never-zero | 0 | 15 | Expected product gaps across all seven sources, hostile labels, and secondary paths. |
| Analyzer connection boundary | 1 | 0 | Exact permitted fetch and no other tested connection path. |
| Collector pin | 0 | 1 | Expected hash mismatch. |
| Public hard rules | 0 | 1 | Expected protected copy violations. |
| Stranger browser | 0 | 2 | Expected canonical-route and Composer-label gaps. |
| Stranger contracts | 0 | 6 | Expected terminal and folder-flow gaps. |
| **Protected contracts total** | **1** | **32** | Deliberately red until protected implementation fixes land. |

## Files built or changed in this final pass

- `.github/workflows/analyzer-perimeter.yml`
- `analyze/fixtures/seven-source/claude-code.jsonl`
- `analyze/fixtures/seven-source/claude-chat.json`
- `analyze/fixtures/seven-source/chatgpt.json`
- `analyze/fixtures/seven-source/codex.jsonl`
- `analyze/fixtures/seven-source/cursor.csv`
- `analyze/fixtures/seven-source/cursor-composer.csv`
- `analyze/fixtures/seven-source/github-copilot.csv`
- `analyze/fixtures/seven-source/manifest.json`
- `analyze/test-guided-acquisition-contracts.cjs`
- `analyze/test-cursor-parser.cjs`
- `analyze/test-copilot-parser.cjs`
- `analyze/test-never-zero-render.cjs`
- `analyze/test-no-network-ever.cjs`
- `analyze/test-seven-source-local-browser.cjs`
- `analyze/delivery-worker/package.json`
- `analyze/delivery-worker/test/offline-network-guard.mjs`
- `analyze/delivery-worker/test/offline-network-guard.test.mjs`
- `PERIMETER-OVERNIGHT-SUMMARY.md`

Protected files `analyze/index.html`, root `index.html`, and everything under `forecast/` were not edited in this pass. No branch was merged and nothing was pushed to `main`.
