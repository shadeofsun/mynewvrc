import http from "node:http";

const PORT = parseInt(process.env.PORT || "8080", 10);
const TARGET_BASE = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");

const STRIP_HEADERS = new Set([
  "host", "connection", "keep-alive",
  "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade",
  "forwarded", "x-forwarded-host",
  "x-forwarded-proto", "x-forwarded-port",
]);

const server = http.createServer(async (req, res) => {
  if (!TARGET_BASE) {
    res.statusCode = 500;
    return res.end("Misconfigured: TARGET_DOMAIN is not set");
  }

  try {
    const targetUrl = TARGET_BASE + req.url;

    const out = {};
    let clientIp = null;
    for (const [k, v] of Object.entries(req.headers)) {
      if (STRIP_HEADERS.has(k)) continue;
      if (k.startsWith("x-vercel-")) continue;
      if (k === "x-real-ip") { clientIp = v; continue; }
      if (k === "x-forwarded-for") { if (!clientIp) clientIp = v; continue; }
      out[k] = v;
    }
    if (clientIp) out["x-forwarded-for"] = clientIp;

    const method = req.method;
    const hasBody = method !== "GET" && method !== "HEAD";

    let bodyBuffer = null;
    if (hasBody) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      bodyBuffer = Buffer.concat(chunks);
    }

    const response = await fetch(targetUrl, {
      method,
      headers: out,
      body: bodyBuffer,
      redirect: "manual",
    });

    res.statusCode = response.status;

    for (const [k, v] of response.headers) {
      try { res.setHeader(k, v); } catch {}
    }

    const buffer = await response.arrayBuffer();
    res.end(Buffer.from(buffer));
  } catch (err) {
    console.error("relay error:", err);
    res.statusCode = 502;
    res.end("Bad Gateway: Tunnel Failed");
  }
});

server.listen(PORT, () => {
  console.log(`[relay] listening on :${PORT}, target=${TARGET_BASE}`);
});
