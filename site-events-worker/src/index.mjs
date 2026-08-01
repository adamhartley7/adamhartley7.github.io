const PRODUCTION_ORIGIN = "https://tokenoptimisationprotocol.org";
const EVENT_PATH = "/v1/homepage-view";
const NTFY_ENDPOINT = "https://ntfy.sh";

function responseHeaders(origin) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Vary": "Origin",
  });
  if (origin === PRODUCTION_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Max-Age", "600");
  }
  return headers;
}

function emptyResponse(status, origin) {
  return new Response(null, { status, headers: responseHeaders(origin) });
}

function validTopic(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(value);
}

async function sendNotification(fetchImpl, env) {
  if (!validTopic(env.NTFY_TOPIC)) {
    throw new Error("notification destination is not configured");
  }
  const response = await fetchImpl(NTFY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      topic: env.NTFY_TOPIC,
      title: "TOP site activity",
      message: "TOP homepage opened",
      tags: ["eyes"],
      priority: 3,
    }),
  });
  if (!response || !response.ok) throw new Error("notification provider rejected the alert");
}

export function createHandler(fetchImpl = globalThis.fetch) {
  return {
    async fetch(request, env, context) {
      const origin = request.headers.get("Origin") || "";
      const url = new URL(request.url);

      if (url.pathname !== EVENT_PATH || url.search) return emptyResponse(404, origin);
      if (origin !== PRODUCTION_ORIGIN) return emptyResponse(403, origin);

      if (request.method === "OPTIONS") return emptyResponse(204, origin);
      if (request.method !== "POST") return emptyResponse(405, origin);

      if (request.headers.has("Content-Type")) return emptyResponse(415, origin);
      if ((await request.arrayBuffer()).byteLength !== 0) return emptyResponse(400, origin);

      if (!env || !env.VIEW_RATE_LIMITER || typeof env.VIEW_RATE_LIMITER.limit !== "function") {
        return emptyResponse(503, origin);
      }
      if (!validTopic(env.NTFY_TOPIC)) return emptyResponse(503, origin);
      if (!context || typeof context.waitUntil !== "function") return emptyResponse(503, origin);

      const rate = await env.VIEW_RATE_LIMITER.limit({ key: "homepage-view" });
      if (!rate || rate.success !== true) return emptyResponse(204, origin);

      context.waitUntil(sendNotification(fetchImpl, env).catch(() => undefined));
      return emptyResponse(204, origin);
    },
  };
}

export default createHandler();
