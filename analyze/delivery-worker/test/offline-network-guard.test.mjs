import assert from "node:assert/strict";
import dns from "node:dns";
import http from "node:http";
import http2 from "node:http2";
import net from "node:net";
import test from "node:test";

test("Delivery Worker tests run with the offline network guard installed", () => {
  assert.deepEqual(globalThis.__TOP_OFFLINE_TEST_NETWORK_GUARD__, {
    active: true,
    message: "Delivery Worker tests are offline. Use an injected fixture instead of a network connection.",
  });
});

test("the offline guard fails before fetch, HTTP, or socket traffic can start", () => {
  assert.equal(globalThis.__TOP_OFFLINE_TEST_NETWORK_GUARD__?.active, true,
    "stop before exercising any connection API when the preload is missing");
  const expected = /Delivery Worker tests are offline/;
  assert.throws(() => globalThis.fetch("data:text/plain,offline-fixture"), expected);
  assert.throws(() => http.request("https://submit.tokenoptimisationprotocol.org/"), expected);
  assert.throws(() => http2.connect("https://submit.tokenoptimisationprotocol.org/"), expected);
  assert.throws(() => net.connect(443, "submit.tokenoptimisationprotocol.org"), expected);
  assert.throws(() => new net.Socket().connect(443, "submit.tokenoptimisationprotocol.org"), expected);
  assert.throws(() => dns.resolve4("submit.tokenoptimisationprotocol.org", () => {}), expected);
});
