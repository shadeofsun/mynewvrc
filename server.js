import http from "node:http";
import { Readable } from "node:stream";

const PORT = parseInt(process.env.PORT || "8080", 10);
const TARGET_BASE = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");

const STRIP_HEADERS = new Set([
  "host", "connection", "keep-alive",
  "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade",
  "forwarded", "x-forwarded-host",
  "x-forwarded-proto", "x-forwarded-port",
]);

const server = http.createServer(async (nodeReq, nodeRes) => {
  if (!TARGET_BASE) {
    nodeRes.statusCode = 500;
    return nodeRes.end("Misconfigured: TARGET_DOMAIN is not set");
  }

  try {
    const targetUrl = TARGET_BASE + nodeReq.url;

    const out = new Headers();
    let clientIp = null;
    for (const [k, v] of Object.entries(nodeReq.headers)) {
      if (STRIP_HEADERS.has(k)) continue;
      if (k.startsWith("x-vercel-")) continue;
      if (k === "x-real-ip") { clientIp = v; continue; }
      if (k === "x-forwarded-for") { if (!clientIp) clientIp = v; continue; }
      if (Array.isArray(v)) {
        for (const item of v) out.append(k, item);
      } else {
        out.set(k, v);
      }
    }
    if (clientIp) out.set("x-forwarded-for", clientIp);

    const method = nodeReq.method;
    const hasBody = method !== "GET" && method !== "HEAD";

    const init = { method, headers: out, redirect: "manual" };
    if (hasBody) {
      init.body = Readable.toWeb(nodeReq);
      init.duplex = "half";
    }

    const response = await fetch(targetUrl, init);

    nodeRes.statusCode = response.status;
    for (const [k, v] of response.headers) {
      const lk = k.toLowerCase();
      if (lk === "alt-svc") continue; // prevent client switching to HTTP/3
      try { nodeRes.setHeader(k, v); } catch {}
    }

    if (response.body) {
      Readable.fromWeb(response.body).pipe(nodeRes);
    } else {
      nodeRes.end();
    }
  } catch (err) {
    console.error("relay error:", err);
    if (!nodeRes.headersSent) nodeRes.statusCode = 502;
    try { nodeRes.end("Bad Gateway: Tunnel Failed"); } catch {}
  }
});

server.requestTimeout = 0;
server.headersTimeout = 0;
server.timeout = 0;

server.listen(PORT, () => {
  console.log(`[relay] listening on :${PORT}, target=${TARGET_BASE}`);
});
