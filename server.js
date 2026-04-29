/*
 * HTTP relay (mirrors the Vercel Edge version) for Xray XHTTP transport.
 *
 * Required env:
 *   TARGET_DOMAIN    e.g. https://cpanel.nx.plus:2096
 * Optional env:
 *   PORT             default 8080
 *   ALLOWED_HOST     Host header must match (e.g. travello.one). empty = any
 *   TARGET_INSECURE  "1" to skip TLS verification on target
 */

import http from "node:http";
import { Readable } from "node:stream";

const PORT = parseInt(process.env.PORT || "8080", 10);
const TARGET_BASE = (process.env.TARGET_DOMAIN || "").trim().replace(/\/$/, "");
const ALLOWED_HOST = (process.env.ALLOWED_HOST || "").trim().toLowerCase();
const TARGET_INSECURE = process.env.TARGET_INSECURE === "1";

if (!TARGET_BASE) {
  console.error("FATAL: TARGET_DOMAIN env var is required");
  process.exit(1);
}
if (TARGET_INSECURE) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const STRIP_REQ = new Set([
  "host", "connection", "keep-alive",
  "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade",
  "forwarded", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port",
  "fastly-ssl", "fastly-temp-xff",
  "x-timer", "x-varnish",
]);

const STRIP_RES = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade",
  "x-cache", "x-cache-hits", "age", "via",
]);

// Heuristic: which requests are streaming downloads (no end), so we MUST stream
// instead of buffering. Everything else (short POSTs in packet-up) can be
// buffered, exactly like the Vercel Edge version did.
function isStreaming(req) {
  // GET/HEAD bodies don't exist; it's the response that streams (down link).
  if (req.method === "GET" || req.method === "HEAD") return true;
  return false;
}

const server = http.createServer(async (req, res) => {
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

  const targetUrl = TARGET_BASE + req.url;

  const out = {};
  let clientIp = null;
  for (const [k, v] of Object.entries(req.headers)) {
    if (STRIP_REQ.has(k)) continue;
    if (k.startsWith("x-vercel-")) continue;
    if (k === "fastly-client-ip") { clientIp = v; continue; }
    if (k === "x-real-ip") { clientIp = v; continue; }
    if (k === "x-forwarded-for") { if (!clientIp) clientIp = v; continue; }
    out[k] = v;
  }
  if (clientIp) out["x-forwarded-for"] = clientIp;
  out["x-forwarded-proto"] = "https";

  const method = req.method;
  const hasBody = method !== "GET" && method !== "HEAD";

  // Buffer the request body fully (matches Vercel api/index.js behavior).
  let bodyBuffer = null;
  if (hasBody) {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      bodyBuffer = Buffer.concat(chunks);
    } catch (err) {
      console.error("read body error:", err?.message || err);
      try { res.destroy(); } catch {}
      return;
    }
  }

  let upstream;
  try {
    upstream = await fetch(targetUrl, {
      method,
      headers: out,
      body: bodyBuffer,
      redirect: "manual",
    });
  } catch (err) {
    console.error("upstream error:", err?.message || err);
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain", "cache-control": "no-store" });
    }
    try { res.end("bad gateway\n"); } catch {}
    return;
  }

  // Forward status + headers, scrub hop-by-hop and Fastly cache markers.
  for (const [k, v] of upstream.headers) {
    if (STRIP_RES.has(k.toLowerCase())) continue;
    try { res.setHeader(k, v); } catch {}
  }
  res.setHeader("cache-control", "no-store, no-transform, private, max-age=0");
  res.setHeader("pragma", "no-cache");
  res.setHeader("x-accel-buffering", "no");
  res.setHeader("surrogate-control", "no-store, max-age=0");
  res.writeHead(upstream.status);
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  if (!upstream.body) { res.end(); return; }

  if (isStreaming(req)) {
    // GETs (download stream): pipe progressively.
    const nodeReadable = Readable.fromWeb(upstream.body);
    nodeReadable.on("error", () => { try { res.destroy(); } catch {} });
    res.on("close", () => { try { nodeReadable.destroy(); } catch {} });
    nodeReadable.pipe(res);
  } else {
    // POSTs: buffer full response then send (matches Vercel relay).
    try {
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.end(buf);
    } catch (err) {
      console.error("read response error:", err?.message || err);
      try { res.destroy(); } catch {}
    }
  }
});

server.headersTimeout = 0;
server.requestTimeout = 0;
server.keepAliveTimeout = 75000;
server.timeout = 0;

server.listen(PORT, () => {
  console.log(`[relay] listening on :${PORT}`);
  console.log(`[relay] target = ${TARGET_BASE}`);
  if (ALLOWED_HOST) console.log(`[relay] allowed host = ${ALLOWED_HOST}`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`[relay] ${sig} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
