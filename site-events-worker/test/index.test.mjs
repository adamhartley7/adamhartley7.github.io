import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { createHandler } from "../src/index.mjs";

const ORIGIN = "https://tokenoptimisationprotocol.org";

function request({
  body,
  contentType,
  method = "POST",
  origin = ORIGIN,
  path = "/v1/homepage-view",
  ip = "203.0.113.8",
} = {}) {
  const headers = new Headers();
  if (origin !== null) headers.set("Origin", origin);
  if (typeof contentType === "string") headers.set("Content-Type", contentType);
  if (ip !== null) headers.set("CF-Connecting-IP", ip);
  const result = new Request(`https://events.tokenoptimisationprotocol.org${path}`, {
    method,
    headers,
    body: method === "POST" ? body : undefined,
  });
  if (contentType === null) result.headers.delete("Content-Type");
  return result;
}

function environment(overrides = {}) {
  return {
    NTFY_TOPIC: "private_topic_123456789",
    NTFY_ACCESS_TOKEN: "test-token",
    VIEW_RATE_LIMITER: {
      async limit() { return { success: true }; },
    },
    ...overrides,
  };
}

function context() {
  const pending = [];
  return {
    pending,
    waitUntil(promise) { pending.push(promise); },
  };
}

test("a valid homepage load returns immediately and sends one generic ntfy alert", async () => {
  const notifications = [];
  const rateKeys = [];
  const env = environment({
    VIEW_RATE_LIMITER: {
      async limit(value) { rateKeys.push(value); return { success: true }; },
    },
  });
  const ctx = context();
  const handler = createHandler(async (url, options) => {
    notifications.push({
      url,
      method: options.method,
      body: options.body,
      headers: Object.fromEntries(new Headers(options.headers).entries()),
    });
    return { ok: true };
  });

  const response = await handler.fetch(request(), env, ctx);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(rateKeys, [{ key: "homepage-view" }]);
  assert.equal(ctx.pending.length, 1);
  await Promise.all(ctx.pending);

  assert.deepEqual(notifications, [{
    url: "https://ntfy.sh",
    method: "POST",
    body: JSON.stringify({
      topic: "private_topic_123456789",
      title: "TOP site activity",
      message: "TOP homepage opened",
      tags: ["eyes"],
      priority: 3,
    }),
    headers: {
      authorization: "Bearer test-token",
      "content-type": "application/json",
    },
  }]);
  assert.doesNotMatch(JSON.stringify(notifications), /203\.0\.113\.8|user-agent|referer|query|homepage-load-v1/i,
    "visitor request details must not be forwarded to ntfy");
});

test("the Worker strictly validates route, origin, method, type and body", async () => {
  const handler = createHandler(async () => ({ ok: true }));
  const cases = [
    [request({ path: "/other" }), 404],
    [request({ origin: "https://example.com" }), 403],
    [request({ origin: null }), 403],
    [request({ method: "GET" }), 405],
    [request({ path: "/v1/homepage-view?source=public" }), 404],
    [request({ contentType: "application/json" }), 415],
    [request({ body: "unexpected", contentType: null }), 400],
  ];
  for (const [input, expected] of cases) {
    const ctx = context();
    const response = await handler.fetch(input, environment(), ctx);
    assert.equal(response.status, expected);
    assert.equal(ctx.pending.length, 0);
  }
});

test("preflight is narrow and does not send a notification", async () => {
  const ctx = context();
  const response = await createHandler(async () => ({ ok: true })).fetch(
    request({ method: "OPTIONS", contentType: null }),
    environment(),
    ctx,
  );
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal(response.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
  assert.equal(response.headers.get("Access-Control-Allow-Headers"), null);
  assert.equal(ctx.pending.length, 0);
});

test("rate-limited loads are acknowledged without notifying", async () => {
  let notifications = 0;
  const ctx = context();
  const response = await createHandler(async () => { notifications += 1; return { ok: true }; }).fetch(
    request(),
    environment({ VIEW_RATE_LIMITER: { async limit() { return { success: false }; } } }),
    ctx,
  );
  assert.equal(response.status, 204);
  assert.equal(ctx.pending.length, 0);
  assert.equal(notifications, 0);
});

test("missing bindings and invalid notification destinations fail closed", async () => {
  const handler = createHandler(async () => ({ ok: true }));
  const cases = [
    environment({ VIEW_RATE_LIMITER: undefined }),
    environment({ NTFY_TOPIC: undefined }),
    environment({ NTFY_TOPIC: "short" }),
    environment({ NTFY_TOPIC: "invalid topic with spaces" }),
    environment({ NTFY_ACCESS_TOKEN: undefined }),
  ];
  for (const env of cases) {
    const ctx = context();
    const response = await handler.fetch(request(), env, ctx);
    assert.equal(response.status, 503);
    assert.equal(ctx.pending.length, 0);
  }
});

test("ntfy failure is contained after the browser receives its response", async () => {
  const ctx = context();
  const response = await createHandler(async () => ({ ok: false })).fetch(request(), environment(), ctx);
  assert.equal(response.status, 204);
  assert.equal(ctx.pending.length, 1);
  await assert.doesNotReject(() => Promise.all(ctx.pending));
});

test("tracked source contains no destination, token or logging call", () => {
  const source = fs.readFileSync(new URL("../src/index.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /ntfy\.sh\/[a-z0-9_-]+/i);
  assert.doesNotMatch(source, /console\.(?:log|info|warn|error)|CF-Ray|User-Agent|Referer/i);
  assert.match(source, /NTFY_TOPIC/);
  assert.match(source, /NTFY_ACCESS_TOKEN/);
});
