/*
 * HTTP streaming relay for XHTTP (splithttp) transports.
 *
 * Required env:
 *   TARGET_DOMAIN    e.g. https://cpanel.nx.plus:2096
 * Optional env:
 *   PORT             default 8080
 *   ALLOWED_HOST     Host header must match (e.g. travello.one). empty = any
 *   TARGET_INSECURE  "1" to skip TLS verification on target
 */

import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

const PORT = parseInt(process.env.PORT || "8080", 10);
const TARGET_DOMAIN = (process.env.TARGET_DOMAIN || "").trim();
const ALLOWED_HOST = (process.env.ALLOWED_HOST || "").trim().toLowerCase();
const TARGET_INSECURE = process.env.TARGET_INSECURE === "1";

if (!TARGET_DOMAIN) {
  console.error("FATAL: TARGET_DOMAIN env var is required");
  process.exit(1);
}

const TARGET = new URL(TARGET_DOMAIN);
const TARGET_IS_HTTPS = TARGET.protocol === "https:";
const TARGET_PORT = TARGET.port
  ? parseInt(TARGET.port, 10)
  : (TARGET_IS_HTTPS ? 443 : 80);
const targetClient = TARGET_IS_HTTPS ? https : http;

const agent = TARGET_IS_HTTPS
  ? new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 256,
      maxFreeSockets: 64,
      rejectUnauthorized: !TARGET_INSECURE,
      servername: TARGET.hostname,
    })
  : new http.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 256,
      maxFreeSockets: 64,
    });

const STRIP_REQ = new Set([
  "host", "connection", "keep-alive",
  "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade",
  "forwarded", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port",
  "fastly-ssl", "fastly-client-ip", "fastly-temp-xff",
  "x-timer", "x-varnish",
]);

const STRIP_RES = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade",
  "x-cache", "x-cache-hits", "age",
]);

function clientIpFrom(req) {
  return (
    req.headers["fastly-client-ip"] ||
    (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
    req.socket.remoteAddress ||
    ""
  );
}

const server = http.createServer((req, res) => {
  try { req.socket.setNoDelay(true); } catch {}
  try { res.socket?.setNoDelay(true); } catch {}

  if (ALLOWED_HOST) {
    const h = String(req.headers.host || "").toLowerCase();
    if (h !== ALLOWED_HOST) {
      res.writeHead(421, { "content-type": "text/plain", "cache-control": "no-store" });
      res.end("misdirected\n");
      return;
    }
  }

  const fwd = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (STRIP_REQ.has(k)) continue;
    if (k.startsWith("x-vercel-")) continue;
    fwd[k] = v;
  }
  fwd["host"] = TARGET.host;
  const ip = clientIpFrom(req);
  if (ip) fwd["x-forwarded-for"] = ip;
  fwd["x-forwarded-proto"] = "https";

  const opts = {
    method: req.method,
    host: TARGET.hostname,
    port: TARGET_PORT,
    path: req.url,
    headers: fwd,
    agent,
  };
  if (TARGET_IS_HTTPS) {
    opts.servername = TARGET.hostname;
    opts.rejectUnauthorized = !TARGET_INSECURE;
  }

  const upstream = targetClient.request(opts, (upRes) => {
    const headers = {};
    for (const [k, v] of Object.entries(upRes.headers)) {
      if (STRIP_RES.has(k.toLowerCase())) continue;
      headers[k] = v;
    }
    headers["cache-control"] = "no-store, no-transform";
    headers["pragma"] = "no-cache";
    headers["x-accel-buffering"] = "no";

    res.writeHead(upRes.statusCode || 502, upRes.statusMessage || "", headers);
    if (typeof res.flushHeaders === "function") res.flushHeaders();

    upRes.pipe(res);
    upRes.on("error", () => { try { res.destroy(); } catch {} });
  });

  upstream.on("error", (err) => {
    console.error("upstream error:", err.message);
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain", "cache-control": "no-store" });
    }
    try { res.end("bad gateway\n"); } catch {}
  });

  req.setTimeout(0);
  res.setTimeout(0);

  req.on("aborted", () => { try { upstream.destroy(); } catch {} });
  req.on("error", () => { try { upstream.destroy(); } catch {} });
  res.on("close", () => { try { upstream.destroy(); } catch {} });

  req.pipe(upstream);
});

server.headersTimeout = 0;
server.requestTimeout = 0;
server.keepAliveTimeout = 75000;
server.timeout = 0;

server.listen(PORT, () => {
  console.log(`[relay] listening on :${PORT}`);
  console.log(`[relay] target = ${TARGET_DOMAIN}`);
  if (ALLOWED_HOST) console.log(`[relay] allowed host = ${ALLOWED_HOST}`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`[relay] ${sig} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
