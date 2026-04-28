const TARGET_BASE = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");

const STRIP_HEADERS = new Set([
  "host", "connection", "keep-alive",
  "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade",
  "forwarded", "x-forwarded-host",
  "x-forwarded-proto", "x-forwarded-port",
]);

export default async function handler(req, res) {
  if (!TARGET_BASE) {
    return res.status(500).send("Misconfigured: TARGET_DOMAIN is not set");
  }

  try {
    const pathStart = req.url.indexOf("/", 1);
    const targetUrl = pathStart === -1
      ? TARGET_BASE + "/"
      : TARGET_BASE + req.url.slice(pathStart);

    const out = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (STRIP_HEADERS.has(k)) continue;
      if (k.startsWith("x-vercel-")) continue;
      if (k === "x-real-ip" || k === "x-forwarded-for") continue;
      out[k] = v;
    }
    if (req.headers["x-real-ip"]) {
      out["x-forwarded-for"] = req.headers["x-real-ip"];
    }

    const response = await fetch(targetUrl, {
      method: req.method,
      headers: out,
      body: req.method !== "GET" && req.method !== "HEAD" ? req : undefined,
      redirect: "manual",
    });

    res.status(response.status);
    response.headers.forEach((v, k) => res.setHeader(k, v));
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error("relay error:", err);
    res.status(502).send("Bad Gateway: Tunnel Failed");
  }
}