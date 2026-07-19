import dgram from "node:dgram";
import dns from "node:dns";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import tls from "node:tls";

const MESSAGE = "Delivery Worker tests are offline. Use an injected fixture instead of a network connection.";

function blockNetwork() {
  throw new Error(MESSAGE);
}

function patchMethods(target, names) {
  if (!target) return;
  for (const name of names) {
    if (typeof target[name] === "function") target[name] = blockNetwork;
  }
}

globalThis.fetch = blockNetwork;
globalThis.WebSocket = class OfflineWebSocket {
  constructor() { blockNetwork(); }
};
globalThis.EventSource = class OfflineEventSource {
  constructor() { blockNetwork(); }
};

patchMethods(http, ["request", "get"]);
patchMethods(https, ["request", "get"]);
patchMethods(http2, ["connect"]);
patchMethods(http.Agent?.prototype, ["createConnection"]);
patchMethods(https.Agent?.prototype, ["createConnection"]);
patchMethods(net, ["connect", "createConnection"]);
patchMethods(net.Socket?.prototype, ["connect"]);
patchMethods(tls, ["connect"]);
patchMethods(tls.TLSSocket?.prototype, ["connect"]);
patchMethods(dgram, ["createSocket"]);
patchMethods(dgram.Socket?.prototype, ["connect", "send"]);

const dnsMethods = [
  "lookup", "lookupService", "resolve", "resolve4", "resolve6", "resolveAny", "resolveCaa",
  "resolveCname", "resolveMx", "resolveNaptr", "resolveNs", "resolvePtr", "resolveSoa",
  "resolveSrv", "resolveTxt", "reverse",
];
patchMethods(dns, dnsMethods);
patchMethods(dns.promises, dnsMethods);
patchMethods(dns.Resolver?.prototype, dnsMethods);
patchMethods(dns.promises?.Resolver?.prototype, dnsMethods);

syncBuiltinESMExports();

Object.defineProperty(globalThis, "__TOP_OFFLINE_TEST_NETWORK_GUARD__", {
  configurable: false,
  enumerable: false,
  value: Object.freeze({ active: true, message: MESSAGE }),
  writable: false,
});
