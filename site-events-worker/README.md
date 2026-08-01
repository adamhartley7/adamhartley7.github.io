# TOP site-events Worker

This isolated Cloudflare Worker receives a bodyless signal from the public TOP homepage and sends a generic ntfy notification. It is deliberately separate from the TOP Analyzer delivery Worker.

## Privacy boundary

- The browser sends a bodyless `POST` to the fixed `/v1/homepage-view` route.
- The Worker does not read or forward page contents, URLs, query strings, referrers, user-agent strings or files.
- Cloudflare necessarily processes connection metadata to receive the request. The Worker uses one fixed rate-limit key and does not read, log or store the connecting address.
- The ntfy message contains only `TOP homepage opened`.
- The endpoint is public and can be imitated by a determined sender. Origin checks and rate limiting reduce noise, but notifications are not proof of a unique human visitor.

## Local verification

```powershell
npm install
npm test
```

The test command loads an offline network guard before every test.

## First deployment

1. Create a private ntfy topic of 28-64 letters, numbers, underscores or hyphens. ntfy treats an unguessable topic as the password for its free anonymous route, so a longer random value is safer. Do not reuse any topic previously committed to the public dashboard or repository history.
2. Subscribe to the new topic in the ntfy app. Keep it out of chat, source files and screenshots.
3. Store the same topic name as a Worker secret:

   ```powershell
   npx --no-install wrangler secret put NTFY_TOPIC
   ```

4. Deploy the Worker:

   ```powershell
   npm run deploy
   ```

The custom domain is `events.tokenoptimisationprotocol.org`. Observability and preview URLs are disabled in `wrangler.jsonc`. The native rate limiter allows at most 30 accepted alerts per minute per Cloudflare location; GoatCounter remains the analytics source of truth.
