/*
 * VLESS + WebSocket relay (origin server, sits behind Fastly CDN).
 *
 * Required env:
 *   TARGET_DOMAIN    e.g. https://cpanel.nx.plus:2096
 * Optional env:
 *   PORT             default 8080
 *   WS_PATH          only this path accepts upgrade (e.g. /cpess). empty = any
 *   ALLOWED_HOST     Host header must match (e.g. myfastlydomain.com). empty = any
 *   TARGET_INSECURE  "1" to skip TLS verification on target
 *   IDLE_TIMEOUT_MS  default 600000
 */

import http from "node:http";
import { URL } from "node:url";
import { WebSocketServer, WebSocket } from "ws";

const PORT = parseInt(process.env.PORT || "8080", 10);
const TARGET_DOMAIN = (process.env.TARGET_DOMAIN || "").trim();
const WS_PATH = (process.env.WS_PATH || "").trim();
const ALLOWED_HOST = (process.env.ALLOWED_HOST || "").trim().toLowerCase();
const TARGET_INSECURE = process.env.TARGET_INSECURE === "1";
const IDLE_TIMEOUT_MS = parseInt(process.env.IDLE_TIMEOUT_MS || "600000", 10);

if (!TARGET_DOMAIN) {
  console.error("FATAL: TARGET_DOMAIN env var is required");
  process.exit(1);
}

const TARGET = new URL(TARGET_DOMAIN);
const TARGET_WS_PROTO = TARGET.protocol === "https:" ? "wss:" : "ws:";
const TARGET_HOST = TARGET.host; // includes port if non-default

// ---- HTTP server: cover/health on plain GETs, upgrade for WS ----
const server = http.createServer((req, res) => {
  // Generic camouflage page so probes look harmless.
  res.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store" });
  res.end("ok\n");
});

// noServer mode lets us inspect the request before completing the handshake.
const wss = new WebSocketServer({
  noServer: true,
  perMessageDeflate: false,
  maxPayload: 64 * 1024 * 1024,
});

server.on("upgrade", (req, socket, head) => {
  try {
    // Path filter
    if (WS_PATH) {
      const pathOnly = (req.url || "").split("?")[0];
      if (pathOnly !== WS_PATH) {
        socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
    }
    // Host header filter (Fastly forwards Host as-is by default)
    if (ALLOWED_HOST) {
      const h = String(req.headers.host || "").toLowerCase();
      if (h !== ALLOWED_HOST) {
        socket.write("HTTP/1.1 421 Misdirected Request\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
    }

    wss.handleUpgrade(req, socket, head, (ws) => bridge(ws, req));
  } catch (err) {
    console.error("upgrade error:", err);
    try { socket.destroy(); } catch {}
  }
});

function clientIpFrom(req) {
  return (
    req.headers["fastly-client-ip"] ||
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket.remoteAddress ||
    ""
  );
}

function bridge(clientWs, req) {
  const targetUrl = `${TARGET_WS_PROTO}//${TARGET_HOST}${req.url}`;
  const ip = clientIpFrom(req);

  const fwdHeaders = {
    "user-agent": req.headers["user-agent"] || "Mozilla/5.0",
  };
  if (ip) fwdHeaders["x-forwarded-for"] = ip;
  // Pass through Sec-WebSocket-Protocol if the client sent one
  const subproto = req.headers["sec-websocket-protocol"];

  const targetWs = new WebSocket(targetUrl, subproto ? subproto.split(",").map(s => s.trim()) : undefined, {
    headers: fwdHeaders,
    servername: TARGET.hostname,           // proper SNI to TARGET
    rejectUnauthorized: !TARGET_INSECURE,
    perMessageDeflate: false,
    handshakeTimeout: 15000,
  });

  // Buffer client frames that arrive before target socket is OPEN
  const pending = [];
  let openedTarget = false;
  let closed = false;
  const closeBoth = (code = 1000, reason = "") => {
    if (closed) return;
    closed = true;
    try { clientWs.close(code, reason); } catch {}
    try { targetWs.close(code, reason); } catch {}
    try { clientWs.terminate?.(); } catch {}
    try { targetWs.terminate?.(); } catch {}
  };

  // Idle timeout — kill stuck sessions
  let idleTimer = setTimeout(() => closeBoth(1001, "idle"), IDLE_TIMEOUT_MS);
  const bumpIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => closeBoth(1001, "idle"), IDLE_TIMEOUT_MS);
  };

  targetWs.on("open", () => {
    openedTarget = true;
    for (const { data, isBinary } of pending) {
      try { targetWs.send(data, { binary: isBinary }); } catch {}
    }
    pending.length = 0;
  });

  targetWs.on("message", (data, isBinary) => {
    bumpIdle();
    if (clientWs.readyState === WebSocket.OPEN) {
      try { clientWs.send(data, { binary: isBinary }); } catch {}
    }
  });

  targetWs.on("close", (code, reason) => closeBoth(code || 1000, reason?.toString?.() || ""));
  targetWs.on("error", (err) => {
    console.error("target ws error:", err.message);
    closeBoth(1011, "target error");
  });

  clientWs.on("message", (data, isBinary) => {
    bumpIdle();
    if (openedTarget && targetWs.readyState === WebSocket.OPEN) {
      try { targetWs.send(data, { binary: isBinary }); } catch {}
    } else {
      pending.push({ data, isBinary });
    }
  });
  clientWs.on("close", (code, reason) => closeBoth(code || 1000, reason?.toString?.() || ""));
  clientWs.on("error", (err) => {
    console.error("client ws error:", err.message);
    closeBoth(1011, "client error");
  });

  // Keepalive ping (some intermediaries drop silent connections)
  const ping = setInterval(() => {
    if (clientWs.readyState === WebSocket.OPEN) {
      try { clientWs.ping(); } catch {}
    }
    if (targetWs.readyState === WebSocket.OPEN) {
      try { targetWs.ping(); } catch {}
    }
  }, 30000);
  const stopPing = () => clearInterval(ping);
  clientWs.on("close", stopPing);
  targetWs.on("close", stopPing);
}

server.headersTimeout = 0;
server.requestTimeout = 0;
server.keepAliveTimeout = 75000;

server.listen(PORT, () => {
  console.log(`[relay] listening on :${PORT}`);
  console.log(`[relay] target = ${TARGET_DOMAIN}  (ws proto: ${TARGET_WS_PROTO})`);
  if (WS_PATH)      console.log(`[relay] ws path filter = ${WS_PATH}`);
  if (ALLOWED_HOST) console.log(`[relay] allowed host = ${ALLOWED_HOST}`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`[relay] ${sig} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
